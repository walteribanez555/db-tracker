// Enlace Monaco ↔ Y.Text con cursores y selecciones remotas por awareness.
//
// Es un port de `MonacoBinding` de y-monaco 0.1.6 (MIT, Kevin Jahns) con dos cambios:
// 1. Usa la instancia de Monaco de loadMonaco() en vez de importar 'monaco-editor/esm/vs/editor/editor.api.js':
//    con monaco-editor 0.57 ese import no resuelve (su mapa de "exports" lo convierte en esm/vs/esm/vs/…),
//    y además evitaría cargar una segunda copia de Monaco en desarrollo.
// 2. La selección de texto va en el campo de awareness TEXT_SELECTION_FIELD (en el contrato, `selection` es la
//    selección del lienzo) y el listener de selección del editor se libera al destruir el enlace.
// Las clases CSS son las de y-monaco: yRemoteSelection-<clientID> y yRemoteSelectionHead-<clientID>.
import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { loadMonaco, type MonacoApi } from './monaco'

/** Campo de awareness con la selección de texto ({ anchor, head } como posiciones relativas de Yjs). */
export const TEXT_SELECTION_FIELD = 'textSelection'

let monacoApi: MonacoApi | null = null

/** Monaco listo para enlazar textos compartidos. */
export function loadMonacoWithYjs(): Promise<MonacoApi> {
  return loadMonaco().then((m) => (monacoApi = m))
}

interface RelativeSelection {
  start: Y.RelativePosition
  end: Y.RelativePosition
  direction: number
}

type Editor = MonacoEditor.IStandaloneCodeEditor
type Model = MonacoEditor.ITextModel

/** Exclusión mutua síncrona (como lib0/mutex): evita el eco Monaco → Yjs → Monaco. */
function createMutex() {
  let token = true
  return (fn: () => void) => {
    if (!token) return
    token = false
    try {
      fn()
    } finally {
      token = true
    }
  }
}

class SharedTextBinding {
  private readonly doc: Y.Doc
  private readonly mux = createMutex()
  private savedSelection: RelativeSelection | null = null
  private decorations: string[] = []
  private disposables: IDisposable[] = []
  private destroyed = false
  private readonly monaco: MonacoApi
  private readonly ytext: Y.Text
  private readonly model: Model
  private readonly editor: Editor
  private readonly awareness: Awareness | null

  constructor(monaco: MonacoApi, ytext: Y.Text, model: Model, editor: Editor, awareness: Awareness | null) {
    this.monaco = monaco
    this.ytext = ytext
    this.model = model
    this.editor = editor
    this.awareness = awareness
    this.doc = ytext.doc!
    this.doc.on('beforeAllTransactions', this.beforeTransaction)
    ytext.observe(this.ytextObserver)

    const value = ytext.toString()
    if (model.getValue() !== value) model.setValue(value)

    this.disposables.push(
      model.onDidChangeContent((event) => {
        // Monaco → Yjs (de derecha a izquierda para no desplazar offsets).
        this.mux(() => {
          this.doc.transact(() => {
            ;[...event.changes]
              .sort((a, b) => b.rangeOffset - a.rangeOffset)
              .forEach((change) => {
                ytext.delete(change.rangeOffset, change.rangeLength)
                ytext.insert(change.rangeOffset, change.text)
              })
          }, this)
        })
      }),
      model.onWillDispose(() => this.destroy()),
    )

    if (awareness) {
      this.disposables.push(editor.onDidChangeCursorSelection(this.publishSelection))
      awareness.on('change', this.renderDecorations)
      this.renderDecorations()
    }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.disposables.forEach((d) => d.dispose())
    this.ytext.unobserve(this.ytextObserver)
    this.doc.off('beforeAllTransactions', this.beforeTransaction)
    if (this.awareness) {
      this.awareness.off('change', this.renderDecorations)
      if (this.awareness.getLocalState() !== null) this.awareness.setLocalStateField(TEXT_SELECTION_FIELD, null)
    }
    if (!this.model.isDisposed()) this.decorations = this.editor.deltaDecorations(this.decorations, [])
  }

  /** Guarda la selección local en posiciones relativas antes de cada transacción (remota o no). */
  private beforeTransaction = () => {
    this.mux(() => {
      this.savedSelection = null
      const sel = this.editor.getSelection()
      if (!sel || this.editor.getModel() !== this.model) return
      this.savedSelection = {
        start: Y.createRelativePositionFromTypeIndex(this.ytext, this.model.getOffsetAt(sel.getStartPosition())),
        end: Y.createRelativePositionFromTypeIndex(this.ytext, this.model.getOffsetAt(sel.getEndPosition())),
        direction: sel.getDirection(),
      }
    })
  }

  /** Yjs → Monaco. */
  private ytextObserver = (event: Y.YTextEvent) => {
    this.mux(() => {
      const { monaco, model } = this
      let index = 0
      for (const op of event.delta) {
        if (op.retain !== undefined) index += op.retain
        else if (op.insert !== undefined) {
          const pos = model.getPositionAt(index)
          const text = typeof op.insert === 'string' ? op.insert : ''
          model.applyEdits([{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text }])
          index += text.length
        } else if (op.delete !== undefined) {
          const pos = model.getPositionAt(index)
          const end = model.getPositionAt(index + op.delete)
          model.applyEdits([{ range: new monaco.Range(pos.lineNumber, pos.column, end.lineNumber, end.column), text: '' }])
        }
      }
      const saved = this.savedSelection
      if (saved) {
        const start = Y.createAbsolutePositionFromRelativePosition(saved.start, this.doc)
        const end = Y.createAbsolutePositionFromRelativePosition(saved.end, this.doc)
        if (start && end && start.type === this.ytext && end.type === this.ytext) {
          const s = model.getPositionAt(start.index)
          const e = model.getPositionAt(end.index)
          this.editor.setSelection(monaco.Selection.createWithDirection(s.lineNumber, s.column, e.lineNumber, e.column, saved.direction))
        }
      }
    })
    this.renderDecorations()
  }

  private publishSelection = () => {
    const { awareness, model, editor } = this
    if (!awareness || this.destroyed || editor.getModel() !== model || awareness.getLocalState() === null) return
    const sel = editor.getSelection()
    if (!sel) return
    let anchor = model.getOffsetAt(sel.getStartPosition())
    let head = model.getOffsetAt(sel.getEndPosition())
    if (sel.getDirection() === this.monaco.SelectionDirection.RTL) [anchor, head] = [head, anchor]
    awareness.setLocalStateField(TEXT_SELECTION_FIELD, {
      anchor: Y.createRelativePositionFromTypeIndex(this.ytext, anchor),
      head: Y.createRelativePositionFromTypeIndex(this.ytext, head),
    })
  }

  /** Selecciones y cursores de los demás como decoraciones de Monaco. */
  private renderDecorations = () => {
    const { awareness, model, editor, monaco } = this
    if (!awareness || this.destroyed || model.isDisposed() || editor.getModel() !== model) return
    const next: MonacoEditor.IModelDeltaDecoration[] = []
    awareness.getStates().forEach((state, clientId) => {
      const sel = state[TEXT_SELECTION_FIELD] as { anchor?: Y.RelativePosition; head?: Y.RelativePosition } | null | undefined
      if (clientId === this.doc.clientID || !sel?.anchor || !sel.head) return
      const anchor = Y.createAbsolutePositionFromRelativePosition(sel.anchor, this.doc)
      const head = Y.createAbsolutePositionFromRelativePosition(sel.head, this.doc)
      if (!anchor || !head || anchor.type !== this.ytext || head.type !== this.ytext) return
      const forward = anchor.index < head.index
      const start = model.getPositionAt(forward ? anchor.index : head.index)
      const end = model.getPositionAt(forward ? head.index : anchor.index)
      const headClass = `yRemoteSelectionHead yRemoteSelectionHead-${clientId}`
      next.push({
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        options: {
          className: `yRemoteSelection yRemoteSelection-${clientId}`,
          afterContentClassName: forward || anchor.index === head.index ? headClass : null,
          beforeContentClassName: forward || anchor.index === head.index ? null : headClass,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      })
    })
    this.decorations = editor.deltaDecorations(this.decorations, next)
  }
}

/** Enlaza el modelo del editor con el Y.Text. Requiere loadMonacoWithYjs() resuelto. */
export function bindSharedText(ytext: Y.Text, ed: Editor, awareness: Awareness | null): { destroy: () => void } | null {
  const model = ed.getModel()
  if (!monacoApi || !model || !ytext.doc) return null
  return new SharedTextBinding(monacoApi, ytext, model, ed, awareness)
}

/** CSS de cursores y selecciones remotas (color y nombre de cada participante). */
export function remoteCursorCss(peers: { clientId: number; name: string; color: string }[]): string {
  const safe = (s: string) => s.replace(/[\\"\n\r<>]/g, ' ').slice(0, 40)
  return peers
    .map(({ clientId, name, color }) => {
      const c = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#2563eb'
      return `.yRemoteSelection-${clientId}{background-color:${c}33}
.yRemoteSelectionHead-${clientId}{position:absolute;height:100%;box-sizing:border-box;border-left:2px solid ${c}}
.yRemoteSelectionHead-${clientId}::after{content:"${safe(name)}";position:absolute;left:-2px;top:-1.15em;padding:0 4px;border-radius:3px 3px 3px 0;background:${c};color:#fff;font:600 10px/1.15em system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:10}`
    })
    .join('\n')
}
