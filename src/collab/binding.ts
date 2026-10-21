// Puente entre el store zustand (useProjectStore) y el documento Yjs compartido.
//
// Local → Yjs: una suscripción al store compara el estado anterior con el nuevo y escribe solo lo que cambió
// (por entidad y campo, con diff de texto en Y.Text) dentro de una transacción con origin LOCAL_ORIGIN.
// Así cualquier ruta que modifique el store (acciones, setState directos, deshacer/rehacer) se sincroniza.
// Los cambios que solo mueven posiciones (arrastre en el lienzo) se agrupan con un throttle corto.
//
// Yjs → local: observadores sobre las raíces marcan qué cambió (meta, ramas, versiones, borrador de la rama
// actual) en transacciones ajenas (proveedor, IndexedDB, y-monaco); un microtask aplica todo con un solo
// `set`, reutilizando los objetos que no cambiaron para no re-renderizar de más. Durante ese `set` la
// suscripción local se ignora (sin rebotes).
//
// La rama actual es local: se publica en awareness. checkoutBranch carga el borrador compartido de la rama
// (gancho setSharedDraftResolver del store) o, si no existe, lo crea desde la cabeza.
import * as Y from 'yjs'

import { setCollabUndo, setCollabUndoAvailability } from './undo-bridge'

import { setSharedDraftResolver, useProjectStore, type ProjectState } from '@/store/project'
import type { Schema } from '@/types/schema'

import {
  COLLECTIONS,
  createDraft,
  deepEqual,
  headDraft,
  readBranches,
  readDraft,
  readMeta,
  readVersions,
  rootMaps,
  writeBranches,
  writeDraft,
  writeMeta,
  writeVersions,
} from './doc'

/** Origin de las transacciones que nacen en el store local (el binding las ignora al observar). */
export const LOCAL_ORIGIN = Symbol('db-tracker:collab-local')

/** Agrupación de los cambios de posición mientras se arrastra. */
export const POSITION_THROTTLE_MS = 60

export interface BindingOptions {
  /** true con rol viewer: las ediciones locales se revierten. */
  isReadOnly: () => boolean
  /** Se llama al bloquear una edición en solo lectura (aviso). */
  onBlocked?: () => void
  /** La rama actual cambió (para publicarla en awareness). */
  onBranchChange?: (branchId: string) => void
}

type Flags = { meta: boolean; branches: boolean; versions: boolean; draft: boolean }
const noFlags = (): Flags => ({ meta: false, branches: false, versions: false, draft: false })

type Entity = { id: string } & Record<string, unknown>

/** Reutiliza los elementos que no cambiaron (por id) y el array completo si nada cambió. */
function shareList<T extends { id: string }>(prev: T[] | undefined, next: T[]): T[] {
  if (!prev) return next
  const byId = new Map(prev.map((x) => [x.id, x]))
  let same = prev.length === next.length
  const out = next.map((item, i) => {
    const old = byId.get(item.id)
    const keep = old !== undefined && (old === item || deepEqual(old, item)) ? old : item
    if (keep !== prev[i]) same = false
    return keep
  })
  return same ? prev : out
}

function shareDraft(prev: Schema, next: Schema): Schema {
  const out: Record<string, unknown> = { ...next }
  let same = prev.dialect === next.dialect
  for (const c of COLLECTIONS) {
    const a = (prev as unknown as Record<string, Entity[] | undefined>)[c]
    const b = (next as unknown as Record<string, Entity[] | undefined>)[c]
    if (b === undefined) {
      if (a !== undefined) same = false
      continue
    }
    const shared = shareList(a, b)
    out[c] = shared
    if (shared !== a) same = false
  }
  return same ? prev : (out as unknown as Schema)
}

const withoutPosition = (e: Entity) => ('position' in e ? { ...e, position: null } : e)

/** true si entre a y b solo cambiaron posiciones (o nada). */
function onlyPositions(a: Schema, b: Schema): boolean {
  if (a.dialect !== b.dialect) return false
  for (const c of COLLECTIONS) {
    const la = (a as unknown as Record<string, Entity[] | undefined>)[c]
    const lb = (b as unknown as Record<string, Entity[] | undefined>)[c]
    if (la === lb) continue
    if (!la || !lb || la.length !== lb.length) return false
    for (let i = 0; i < la.length; i++) {
      if (la[i] === lb[i]) continue
      if (la[i].id !== lb[i].id || !deepEqual(withoutPosition(la[i]), withoutPosition(lb[i]))) return false
    }
  }
  return true
}

export class StoreBinding {
  readonly doc: Y.Doc
  private opts: BindingOptions
  private branchId = ''
  /** Último borrador (y base) que el documento y el store tienen en común. */
  private syncedDraft: Schema | null = null
  private syncedBase: string | null = null
  /** Último borrador local de la rama actual (puede ir por delante de syncedDraft con el throttle). */
  private lastLocalDraft: Schema | null = null
  private applying = false
  private flags = noFlags()
  private scheduled = false
  private throttle: ReturnType<typeof setTimeout> | null = null
  private resolved: { branchId: string; schema: Schema } | null = null
  private unsubscribe: (() => void) | null = null
  private destroyed = false
  /** Deshacer/rehacer solo de los cambios propios (origin LOCAL_ORIGIN). */
  private undoManager: Y.UndoManager | null = null

  constructor(doc: Y.Doc, opts: BindingOptions) {
    this.doc = doc
    this.opts = opts
  }

  get currentBranchId() {
    return this.branchId
  }

  /**
   * Empieza a sincronizar. El documento ya debe tener el proyecto (sembrado o recibido).
   * `branchId`: rama inicial (si no existe en el documento, la primera).
   */
  mount(branchId: string) {
    const { branches, drafts, meta, versions } = rootMaps(this.doc)
    this.branchId = branches.has(branchId) ? branchId : (readBranches(this.doc)[0]?.id ?? branchId)
    if (!drafts.has(this.branchId) && !this.opts.isReadOnly()) {
      this.doc.transact(() => createDraft(this.doc, this.branchId, headDraft(this.doc, this.branchId)), LOCAL_ORIGIN)
    }

    meta.observe(this.onMeta)
    branches.observeDeep(this.onBranches)
    versions.observe(this.onVersions)
    drafts.observeDeep(this.onDrafts)

    // Documento → store (todo).
    this.flags = { meta: true, branches: true, versions: true, draft: true }
    this.flushRemote()

    this.unsubscribe = useProjectStore.subscribe(this.onStore)
    setSharedDraftResolver(this.resolve)

    this.undoManager = new Y.UndoManager(drafts, { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 500 })
    const refresh = () =>
      setCollabUndoAvailability((this.undoManager?.undoStack.length ?? 0) > 0, (this.undoManager?.redoStack.length ?? 0) > 0)
    this.undoManager.on('stack-item-added', refresh)
    this.undoManager.on('stack-item-popped', refresh)
    this.undoManager.on('stack-cleared', refresh)
    setCollabUndo({
      undo: () => {
        if (this.opts.isReadOnly()) return
        this.flush()
        this.undoManager?.undo()
      },
      redo: () => {
        if (this.opts.isReadOnly()) return
        this.flush()
        this.undoManager?.redo()
      },
    })
    this.opts.onBranchChange?.(this.branchId)
  }

  destroy() {
    if (this.destroyed) return
    if (!this.opts.isReadOnly()) this.flushLocal()
    this.destroyed = true
    this.unsubscribe?.()
    setSharedDraftResolver(null)
    setCollabUndo(null)
    this.undoManager?.destroy()
    this.undoManager = null
    if (this.throttle) clearTimeout(this.throttle)
    const { branches, drafts, meta, versions } = rootMaps(this.doc)
    meta.unobserve(this.onMeta)
    branches.unobserveDeep(this.onBranches)
    versions.unobserve(this.onVersions)
    drafts.unobserveDeep(this.onDrafts)
  }

  /** Y.Text del SQL de una vista o del cuerpo de una función en el borrador de la rama actual. */
  getText(kind: 'view-definition' | 'function-body', id: string): Y.Text | null {
    const ydraft = rootMaps(this.doc).drafts.get(this.branchId)
    const map = ydraft?.get(kind === 'view-definition' ? 'views' : 'functions')
    const entity = map instanceof Y.Map ? map.get(id) : undefined
    const text = entity instanceof Y.Map ? entity.get(kind === 'view-definition' ? 'definition' : 'body') : undefined
    return text instanceof Y.Text ? text : null
  }

  /** Envía ya los cambios de posición pendientes del throttle. */
  flush() {
    if (!this.destroyed && !this.opts.isReadOnly()) this.flushLocal()
  }

  /* ───────────────────────── Yjs → store ───────────────────────── */

  private mark(key: keyof Flags) {
    this.flags[key] = true
    if (this.scheduled || this.destroyed) return
    this.scheduled = true
    queueMicrotask(() => this.flushRemote())
  }

  private onMeta = (e: Y.YMapEvent<unknown>) => {
    if (e.transaction.origin !== LOCAL_ORIGIN) this.mark('meta')
  }
  private onBranches = (_events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    if (tr.origin !== LOCAL_ORIGIN) this.mark('branches')
  }
  private onVersions = (e: Y.YMapEvent<string>) => {
    if (e.transaction.origin !== LOCAL_ORIGIN) this.mark('versions')
  }
  private onDrafts = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN) return
    const drafts = rootMaps(this.doc).drafts
    for (const e of events) {
      if (e.target === drafts ? (e as Y.YMapEvent<unknown>).keysChanged.has(this.branchId) : e.path[0] === this.branchId) {
        this.mark('draft')
        return
      }
    }
  }

  private flushRemote() {
    this.scheduled = false
    if (this.destroyed) return
    // Lo local pendiente (posiciones) entra antes en el documento para no pisarlo al leer.
    if (!this.opts.isReadOnly()) this.flushLocal()
    const f = this.flags
    this.flags = noFlags()
    const state = useProjectStore.getState()
    let project = state.project
    const patch: Partial<ProjectState> = {}

    if (f.meta) {
      const m = readMeta(this.doc)
      if (m.projectId && (m.projectId !== project.id || m.name !== project.name || m.dialect !== project.dialect)) {
        project = { ...project, id: m.projectId, name: m.name, dialect: m.dialect }
      }
    }
    if (f.branches) {
      const branches = shareList(project.branches, readBranches(this.doc))
      if (branches !== project.branches) project = { ...project, branches }
    }
    if (f.versions) {
      const versions = shareList(project.versions, readVersions(this.doc))
      if (versions !== project.versions) project = { ...project, versions }
    }
    // Otro participante borró la rama en la que estaba: se pasa a la primera.
    if (project.branches.length && !project.branches.some((b) => b.id === this.branchId)) {
      this.branchId = (project.branches.find((b) => b.name === 'main') ?? project.branches[0]).id
      if (!rootMaps(this.doc).drafts.has(this.branchId) && !this.opts.isReadOnly()) {
        this.doc.transact(() => createDraft(this.doc, this.branchId, headDraft(this.doc, this.branchId)), LOCAL_ORIGIN)
      }
      f.draft = true
      this.opts.onBranchChange?.(this.branchId)
    }
    if (project.currentBranchId !== this.branchId) project = { ...project, currentBranchId: this.branchId }
    if (project !== state.project) patch.project = project

    if (f.draft) {
      const ydraft = rootMaps(this.doc).drafts.get(this.branchId)
      const next = ydraft ? readDraft(ydraft) : headDraft(this.doc, this.branchId)
      const draft = shareDraft(state.draft, next.schema)
      if (draft !== state.draft) patch.draft = draft
      if (next.baseVersionId !== state.baseVersionId) patch.baseVersionId = next.baseVersionId
    }

    if (Object.keys(patch).length) this.applyToStore(patch)
    const after = useProjectStore.getState()
    this.syncedDraft = this.lastLocalDraft = after.draft
    this.syncedBase = after.baseVersionId
  }

  private applyToStore(patch: Partial<ProjectState>) {
    this.applying = true
    try {
      useProjectStore.setState(patch)
    } finally {
      this.applying = false
    }
  }

  /** Gancho de checkoutBranch: borrador compartido de la rama (o null si no tiene). */
  private resolve = (branchId: string) => {
    const ydraft = rootMaps(this.doc).drafts.get(branchId)
    if (!ydraft) return null
    const { schema, baseVersionId } = readDraft(ydraft)
    this.resolved = { branchId, schema }
    return { schema, versionId: baseVersionId }
  }

  /* ───────────────────────── store → Yjs ───────────────────────── */

  private onStore = (state: ProjectState, prev: ProjectState) => {
    if (this.applying || this.destroyed) return
    if (this.opts.isReadOnly()) {
      this.blockReadOnly(state, prev)
      return
    }
    const switched = state.project.currentBranchId !== this.branchId
    // Lo pendiente pertenece a la rama anterior; el historial de deshacer también.
    if (switched) {
      this.flushLocal()
      this.undoManager?.clear()
    }

    const p = state.project
    const q = prev.project
    const metaChanged = p.id !== q.id || p.name !== q.name || p.dialect !== q.dialect
    if (metaChanged || p.branches !== q.branches || p.versions !== q.versions) {
      this.doc.transact(() => {
        if (metaChanged) writeMeta(this.doc, p)
        if (p.versions !== q.versions) writeVersions(this.doc, p.versions, true)
        if (p.branches !== q.branches) writeBranches(this.doc, p.branches)
      }, LOCAL_ORIGIN)
    }

    if (switched) {
      this.switchBranch(state)
      return
    }

    if (state.baseVersionId !== this.syncedBase) {
      const ydraft = rootMaps(this.doc).drafts.get(this.branchId)
      if (ydraft) this.doc.transact(() => ydraft.set('baseVersionId', state.baseVersionId), LOCAL_ORIGIN)
      this.syncedBase = state.baseVersionId
    }

    if (state.draft !== prev.draft) {
      this.lastLocalDraft = state.draft
      if (this.syncedDraft && onlyPositions(prev.draft, state.draft)) {
        this.throttle ??= setTimeout(() => this.flushLocal(), POSITION_THROTTLE_MS)
      } else this.flushLocal()
    }
  }

  private flushLocal() {
    if (this.throttle) {
      clearTimeout(this.throttle)
      this.throttle = null
    }
    const next = this.lastLocalDraft
    if (!next || next === this.syncedDraft) return
    const prev = this.syncedDraft
    const base = this.syncedBase
    this.doc.transact(() => {
      const ydraft = rootMaps(this.doc).drafts.get(this.branchId)
      if (ydraft) writeDraft(ydraft, { schema: next, baseVersionId: base }, prev ? { schema: prev, baseVersionId: base } : null)
      else createDraft(this.doc, this.branchId, { schema: next, baseVersionId: base })
    }, LOCAL_ORIGIN)
    this.syncedDraft = next
  }

  private switchBranch(state: ProjectState) {
    const target = state.project.currentBranchId
    const { branches, drafts } = rootMaps(this.doc)
    const resolved = this.resolved
    this.resolved = null
    if (!branches.has(target)) {
      // Rama que no existe en el documento compartido: se vuelve a la anterior.
      this.revertBranch(state)
      return
    }
    this.branchId = target
    const fromShared = resolved?.branchId === target && resolved.schema === state.draft
    if (!fromShared) {
      // Rama sin borrador compartido (se crea desde la cabeza) o checkoutVersion (carga esa versión en el borrador compartido).
      this.doc.transact(() => {
        const draft = { schema: state.draft, baseVersionId: state.baseVersionId }
        const ydraft = drafts.get(target)
        if (ydraft) writeDraft(ydraft, draft, null)
        else createDraft(this.doc, target, draft)
      }, LOCAL_ORIGIN)
    }
    this.syncedDraft = this.lastLocalDraft = state.draft
    this.syncedBase = state.baseVersionId
    this.opts.onBranchChange?.(target)
  }

  private revertBranch(state: ProjectState) {
    this.applyToStore({
      project: { ...state.project, currentBranchId: this.branchId },
      draft: this.syncedDraft ?? state.draft,
      baseVersionId: this.syncedBase,
    })
  }

  /** Solo lectura: se permite cambiar de rama (es local); cualquier otra edición compartida se revierte. */
  private blockReadOnly(state: ProjectState, prev: ProjectState) {
    let blocked = false
    const patch: Partial<ProjectState> = {}
    const p = state.project
    const q = prev.project
    let project = p
    if (p.id !== q.id || p.name !== q.name || p.dialect !== q.dialect || p.branches !== q.branches || p.versions !== q.versions) {
      project = { ...p, id: q.id, name: q.name, dialect: q.dialect, branches: q.branches, versions: q.versions }
      blocked = true
    }
    if (p.currentBranchId !== this.branchId) {
      const resolved = this.resolved
      this.resolved = null
      if (rootMaps(this.doc).branches.has(p.currentBranchId)) {
        this.branchId = p.currentBranchId
        // checkoutVersion no puede reescribir el borrador compartido: se muestra el borrador de la rama.
        if (!(resolved?.branchId === p.currentBranchId && resolved.schema === state.draft)) {
          const ydraft = rootMaps(this.doc).drafts.get(this.branchId)
          const d = ydraft ? readDraft(ydraft) : headDraft(this.doc, this.branchId)
          patch.draft = d.schema
          patch.baseVersionId = d.baseVersionId
          if (resolved === null && ydraft) blocked = true
        }
        this.opts.onBranchChange?.(this.branchId)
      } else {
        project = { ...project, currentBranchId: this.branchId }
        patch.draft = this.syncedDraft ?? prev.draft
        patch.baseVersionId = this.syncedBase
        blocked = true
      }
    } else if (state.draft !== prev.draft || state.baseVersionId !== prev.baseVersionId) {
      patch.draft = prev.draft
      patch.baseVersionId = prev.baseVersionId
      blocked = true
    }
    if (project !== p) patch.project = project
    if (Object.keys(patch).length) this.applyToStore(patch)
    const after = useProjectStore.getState()
    this.syncedDraft = this.lastLocalDraft = after.draft
    this.syncedBase = after.baseVersionId
    if (blocked) this.opts.onBlocked?.()
  }
}
