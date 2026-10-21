import { useReactFlow } from '@xyflow/react'
import { ChevronRight, Eye, KeyRound, Link2, MoreHorizontal, Plus, StickyNote, X, Zap } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { isActionMenuGesture, useLongPress } from '@/components/flow/use-action-menu'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { Table } from '@/types/schema'

import { CANVAS_SELECTOR } from '../../hooks/useCanvasActions'
import { useKeyboardOffset } from '../../hooks/useVisualViewport'
import { addColumnTo } from '../../lib/actions'
import { TABLE_WIDTH } from '../../lib/constants'
import { fkColumnIdsByTable, relationLabel } from '../../lib/relations'
import type { FlowEdge, FlowNode, MenuTarget } from '../../lib/types'
import { IndexesPanel } from './IndexesPanel'
import { MobileColumnEditor } from './MobileColumnEditor'
import { NoteInspector } from './NoteInspector'
import { InspectorChromeContext } from './chrome'
import { RelationInspector } from './RelationInspector'
import { TableRelations } from './TableInspector'
import { TriggerInspector } from './TriggerInspector'
import { ViewInspector } from './ViewInspector'

/** Posiciones de la hoja: media altura (al menos ~300 px en pantallas bajas) y ampliada. */
type Snap = 'half' | 'full'
const FULL = 0.9
const HALF_CSS = 'max(50%, min(300px, 62%))'
/** Fracción del lienzo que tapa la hoja (misma fórmula que `HALF_CSS`). */
const sheetFraction = (snap: Snap, canvasHeight: number) =>
  snap === 'full' ? FULL : Math.max(0.5, Math.min(300 / Math.max(canvasHeight, 1), 0.62))

const TAB_FADE = 'animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none'
const HIDDEN_CHROME = { hideHeader: true }

type OpenMenu = (target: MenuTarget, x: number, y: number) => void

/** Centra el nodo en la parte del lienzo que queda libre entre la barra flotante y la hoja. */
function useCenterAbove() {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  return useCallback(
    (id: string, snap: Snap) => {
      const node = rf.getNode(id)
      const canvasEl = document.querySelector(CANVAS_SELECTOR)
      const canvas = canvasEl?.getBoundingClientRect()
      if (!node || !canvas || node.hidden) return
      const toolbar = canvasEl?.querySelector('[role="toolbar"]')?.getBoundingClientRect()
      const top = toolbar ? Math.max(0, toolbar.bottom - canvas.top) : 0
      const bottom = canvas.height * (1 - sheetFraction(snap, canvas.height))
      const w = node.measured?.width ?? TABLE_WIDTH
      const h = node.measured?.height ?? 120
      const pad = 16
      const visibleH = bottom - top
      const fitZoom = Math.min((canvas.width - pad * 2) / w, (visibleH - pad * 2) / h)
      const current = rf.getZoom()
      const zoom = Math.max(0.4, Math.min(current < 0.6 ? 0.9 : current, fitZoom, 1.2))
      // setCenter lleva el punto al centro del lienzo: se compensa para que el nodo quede en el centro
      // de la franja visible o, si no cabe, con su cabecera arriba.
      const targetY = h * zoom > visibleH - pad * 2 ? top + pad + (h * zoom) / 2 : (top + bottom) / 2
      const cx = node.position.x + w / 2
      const cy = node.position.y + h / 2 + (canvas.height / 2 - targetY) / zoom
      void rf.setCenter(cx, cy, { zoom, duration: 300 })
    },
    [rf],
  )
}

/** Gesto del asa y la cabecera: arrastrar hacia arriba amplía; hacia abajo reduce o cierra. */
function useHandleDrag(snap: Snap, setSnap: (s: Snap) => void, onClose: () => void) {
  const [dy, setDy] = useState(0)
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button:not([data-handle])')) return
    const startY = e.clientY
    const id = e.pointerId
    const move = (ev: PointerEvent) => ev.pointerId === id && setDy(ev.clientY - startY)
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setDy(0)
      if (ev.type === 'pointercancel') return
      const d = ev.clientY - startY
      if (d < -40) setSnap('full')
      else if (d > 40 && snap === 'full') setSnap('half')
      else if (d > 60) onClose()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  return { dy, handlers: { onPointerDown } }
}

function ColumnsList({ table, onEdit, onMenu }: { table: Table; onEdit: (columnId: string) => void; onMenu: OpenMenu }) {
  const relations = useProjectStore((s) => s.draft.relations)
  const fkIds = useMemo(() => fkColumnIdsByTable(relations).get(table.id) ?? [], [relations, table.id])
  // Pulsación larga sobre una fila: reemite Ctrl + clic derecho, que abre el menú de la columna.
  const longPress = useLongPress()
  if (!table.columns.length) return <p className="px-4 py-4 text-sm text-muted-foreground">Sin columnas todavía.</p>
  return (
    <ul {...longPress}>
      {table.columns.map((column) => (
        <li key={column.id} className="border-b last:border-b-0">
          <button
            type="button"
            data-column-id={column.id}
            onClick={() => onEdit(column.id)}
            // Pulsación larga (o Ctrl + clic derecho): menú de acciones de la columna.
            onContextMenu={(e: ReactMouseEvent) => {
              e.preventDefault()
              if (isActionMenuGesture(e)) onMenu({ kind: 'table', id: table.id, columnId: column.id }, e.clientX, e.clientY)
            }}
            className="flex h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted/70"
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {column.pk ? (
                <KeyRound className="size-3.5 text-amber-600 dark:text-amber-400" aria-label="clave primaria" />
              ) : fkIds.includes(column.id) ? (
                <Link2 className="size-3.5 text-sky-600 dark:text-sky-400" aria-label="clave foránea" />
              ) : null}
            </span>
            <span className={cn('min-w-0 flex-1 truncate font-mono text-sm', column.pk && 'font-semibold')}>
              {column.name}
              {!column.nullable && !column.pk && <span className="ml-0.5 text-muted-foreground">*</span>}
            </span>
            <span className="max-w-[40%] shrink-0 truncate font-mono text-xs text-muted-foreground">{column.type}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

function TableBody({ table, onMenu, onSnap }: { table: Table; onMenu: OpenMenu; onSnap: (snap: Snap) => void }) {
  const relations = useProjectStore((s) => s.draft.relations)
  const [tab, setTab] = useState('columns')
  const [editing, setEditingState] = useState<string | null>(null)
  // Editar una columna amplía la hoja; al volver, recupera la media altura (y el nodo visible).
  const setEditing = (columnId: string | null) => {
    setEditingState(columnId)
    onSnap(columnId ? 'full' : 'half')
  }
  const relationCount = relations.filter((r) => r.sourceTableId === table.id || r.targetTableId === table.id).length
  const fkIds = useMemo(() => fkColumnIdsByTable(relations).get(table.id) ?? [], [relations, table.id])
  const column = editing ? table.columns.find((c) => c.id === editing) : undefined

  if (column)
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <MobileColumnEditor table={table} column={column} isFk={fkIds.includes(column.id)} onBack={() => setEditing(null)} />
      </div>
    )

  const add = () => {
    const created = addColumnTo(table.id)
    if (created) setEditing(created.id)
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
      <div className="shrink-0 border-b px-4">
        <TabsList variant="line" className="h-11 w-full justify-start gap-5 p-0">
          <TabsTrigger value="columns" className="flex-none px-0 text-sm">
            Columnas <span className="text-muted-foreground tabular-nums">{table.columns.length}</span>
          </TabsTrigger>
          <TabsTrigger value="indexes" className="flex-none px-0 text-sm">
            Índices <span className="text-muted-foreground tabular-nums">{table.indexes.length}</span>
          </TabsTrigger>
          <TabsTrigger value="relations" className="flex-none px-0 text-sm">
            Relaciones <span className="text-muted-foreground tabular-nums">{relationCount}</span>
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="columns" className={cn('flex min-h-0 flex-col', TAB_FADE)}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ColumnsList table={table} onEdit={setEditing} onMenu={onMenu} />
        </div>
        <div className="shrink-0 border-t px-4 py-2">
          <Button variant="outline" className="h-11 w-full" onClick={add}>
            <Plus />
            Agregar columna
          </Button>
        </div>
      </TabsContent>
      <TabsContent value="indexes" className={cn('min-h-0 overflow-y-auto overscroll-contain', TAB_FADE)}>
        <IndexesPanel table={table} />
      </TabsContent>
      <TabsContent value="relations" className={cn('min-h-0 overflow-y-auto overscroll-contain', TAB_FADE)}>
        <TableRelations table={table} />
      </TabsContent>
    </Tabs>
  )
}

interface Resolved {
  key: string
  target: MenuTarget
  nodeId?: string
  icon: ReactNode
  title: string
  meta: string
  body: ReactNode
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Móvil: inspector como hoja inferior sobre el lienzo (no modal). Cabecera con asa, nombre, conteos,
 * cerrar y menú de acciones; para tablas, pestañas Columnas / Índices / Relaciones con filas de 52 px.
 * Al seleccionar, centra el nodo en la parte del lienzo que queda visible por encima.
 */
export function MobileInspectorSheet({ onOpenMenu }: { onOpenMenu: OpenMenu }) {
  const selection = useProjectStore((s) => s.selection)
  const draft = useProjectStore((s) => s.draft)
  const setSelection = useProjectStore((s) => s.setSelection)
  const [snap, setSnap] = useState<Snap>('half')
  const sheetRef = useRef<HTMLElement>(null)
  const keyboard = useKeyboardOffset(sheetRef, selection !== null)
  const centerAbove = useCenterAbove()
  const close = useCallback(() => setSelection(null), [setSelection])
  const { dy, handlers } = useHandleDrag(snap, setSnap, close)

  const resolved = useMemo<Resolved | null>(() => {
    if (!selection) return null
    const key = `${selection.kind}:${selection.id}`
    switch (selection.kind) {
      case 'table': {
        const table = draft.tables.find((t) => t.id === selection.id)
        if (!table) return null
        const rels = draft.relations.filter((r) => r.sourceTableId === table.id || r.targetTableId === table.id).length
        return {
          key,
          nodeId: table.id,
          target: { kind: 'table', id: table.id },
          icon: <span className="size-2.5 shrink-0 rounded-full" style={{ background: table.color }} />,
          title: table.name,
          meta: [plural(table.columns.length, 'columna', 'columnas'), plural(table.indexes.length, 'índice', 'índices'), plural(rels, 'relación', 'relaciones')].join(' · '),
          body: null,
        }
      }
      case 'view': {
        const view = draft.views.find((v) => v.id === selection.id)
        if (!view) return null
        return {
          key,
          nodeId: view.id,
          target: { kind: 'view', id: view.id },
          icon: <Eye className="size-4 shrink-0" style={{ color: view.color }} />,
          title: view.name,
          meta: [view.materialized ? 'Vista materializada' : 'Vista', plural(view.columns.length, 'columna', 'columnas'), plural(view.sourceIds.length, 'origen', 'orígenes')].join(' · '),
          body: <ViewInspector key={view.id} view={view} />,
        }
      }
      case 'trigger': {
        const trigger = draft.triggers.find((t) => t.id === selection.id)
        if (!trigger) return null
        const table = draft.tables.find((t) => t.id === trigger.tableId)
        return {
          key,
          nodeId: trigger.id,
          target: { kind: 'trigger', id: trigger.id },
          icon: <Zap className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />,
          title: trigger.name,
          meta: [trigger.timing, trigger.events.join(', ') || 'sin eventos', table ? `en ${table.name}` : null, trigger.enabled === false ? 'desactivado' : null]
            .filter(Boolean)
            .join(' · '),
          body: <TriggerInspector key={trigger.id} trigger={trigger} />,
        }
      }
      case 'note': {
        const note = draft.notes.find((n) => n.id === selection.id)
        if (!note) return null
        return {
          key,
          nodeId: note.id,
          target: { kind: 'note', id: note.id },
          icon: <StickyNote className="size-4 shrink-0 text-muted-foreground" />,
          title: note.text.split('\n')[0] || 'Nota sin texto',
          meta: `Nota · ${plural(note.text.length, 'carácter', 'caracteres')}`,
          body: <NoteInspector key={note.id} note={note} />,
        }
      }
      case 'relation': {
        const relation = draft.relations.find((r) => r.id === selection.id)
        if (!relation) return null
        const l = relationLabel(draft, relation)
        return {
          key,
          target: { kind: 'relation', id: relation.id },
          icon: <Link2 className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />,
          title: `${l.source} → ${l.target}`,
          meta: `Relación ${relation.cardinality} · ${l.sourceColumn} → ${l.targetColumn}`,
          body: <RelationInspector key={relation.id} relation={relation} />,
        }
      }
      default:
        return null
    }
  }, [selection, draft])

  // Cada selección nueva entra a media altura y centra su nodo por encima de la hoja.
  const key = resolved?.key ?? null
  const nodeId = resolved?.nodeId
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    if (key) setSnap('half')
  }
  useEffect(() => {
    if (!nodeId || snap !== 'half') return
    // Tras pintar la hoja (y después de cualquier encuadre de quien seleccionó).
    const t = setTimeout(() => centerAbove(nodeId, 'half'), 60)
    return () => clearTimeout(t)
  }, [key, nodeId, snap, centerAbove])

  // Con el teclado en pantalla, el campo con foco de la hoja se desplaza a la vista.
  const open = resolved !== null
  useEffect(() => {
    if (!open) return
    let t: ReturnType<typeof setTimeout>
    const reveal = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const el = document.activeElement
        if (el instanceof HTMLElement && sheetRef.current?.contains(el) && ['INPUT', 'TEXTAREA'].includes(el.tagName))
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }, 120)
    }
    window.visualViewport?.addEventListener('resize', reveal)
    window.addEventListener('resize', reveal)
    return () => {
      clearTimeout(t)
      window.visualViewport?.removeEventListener('resize', reveal)
      window.removeEventListener('resize', reveal)
    }
  }, [open])

  if (!resolved) return null

  const table = selection?.kind === 'table' ? draft.tables.find((t) => t.id === selection.id) : undefined
  const height = snap === 'full' ? `${FULL * 100}%` : HALF_CSS

  return (
    <section
      ref={sheetRef}
      data-mobile-inspector
      aria-label={`Inspector: ${resolved.title}`}
      className="nokey absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden rounded-t-xl border-t bg-background transition-[height,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] animate-in slide-in-from-bottom-8 fade-in-0 motion-reduce:transition-none motion-reduce:animate-none"
      style={{
        height,
        maxHeight: `calc(100% - ${keyboard}px - 8px)`,
        bottom: keyboard,
        transform: dy ? `translateY(${Math.max(dy, -40)}px)` : undefined,
        transitionDuration: dy ? '0ms' : undefined,
      }}
    >
      {/* Asa + cabecera: arrastrable para ampliar, reducir o cerrar. */}
      <div className="shrink-0 touch-none border-b select-none" {...handlers}>
        <button
          type="button"
          data-handle
          onClick={() => setSnap(snap === 'half' ? 'full' : 'half')}
          aria-label={snap === 'half' ? 'Ampliar el inspector' : 'Reducir el inspector'}
          className="flex h-5 w-full items-center justify-center"
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </button>
        <div className="flex items-center gap-1 pr-1 pb-1 pl-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              {resolved.icon}
              <h2 className="min-w-0 truncate font-mono text-base font-semibold">{resolved.title}</h2>
            </div>
            <p className="truncate text-xs text-muted-foreground tabular-nums">{resolved.meta}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground"
            aria-label="Más acciones"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              onOpenMenu(resolved.target, r.left, r.bottom)
            }}
          >
            <MoreHorizontal className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-11 text-muted-foreground" aria-label="Cerrar inspector" onClick={close}>
            <X className="size-5" />
          </Button>
        </div>
      </div>

      {table ? (
        <TableBody key={table.id} table={table} onMenu={onOpenMenu} onSnap={setSnap} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <InspectorChromeContext.Provider value={HIDDEN_CHROME}>{resolved.body}</InspectorChromeContext.Provider>
        </div>
      )}
    </section>
  )
}
