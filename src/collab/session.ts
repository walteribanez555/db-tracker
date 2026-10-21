// Sesión de colaboración: documento Yjs + awareness + persistencia IndexedDB + proveedor WebSocket + binding.
// Se carga bajo demanda desde index.ts (Yjs no entra en el bundle principal).
import { toast } from 'sonner'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { useProjectStore } from '@/store/project'

import {
  backupLocalProject,
  clearCollabPersist,
  COLLAB_PERSIST_KEY,
  discardProjectBackup,
  PROJECT_PERSIST_KEY,
  restoreProjectBackup,
  setPersistKey,
} from './backup'
import { LOCAL_ORIGIN, StoreBinding } from './binding'
import { createDraft, docToProject, headDraft, isDocEmpty, readDraft, readMeta, rootMaps, writeBranches, writeProjectToDoc, writeVersions } from './doc'
import type { AwarenessState, ClientKind, CollabRole, ControlMessage } from './protocol'
import { SyncProvider, syncUrl, type ProviderStatus } from './provider'
import { getClientId, initialCollabState, saveDefaultName, useCollabStore } from './store'

export interface SessionOptions {
  baseUrl: string
  sessionId: string
  secret: string
  name: string
  color: string
  kind: ClientKind
  mode: 'adopt-remote' | 'seed-from-local'
  /** Pruebas: implementación de WebSocket y persistencia. */
  WebSocketImpl?: typeof WebSocket
  persistence?: boolean
}

const PEERS_THROTTLE_MS = 50
const CURSOR_THROTTLE_MS = 40
const BLOCKED_TOAST_EVERY_MS = 4000

type Presence = Partial<Omit<AwarenessState, 'user'>>

export class CollabSession {
  readonly doc = new Y.Doc()
  readonly awareness: Awareness
  readonly options: SessionOptions
  binding: StoreBinding | null = null
  private provider: SyncProvider | null = null
  private persistence: IndexeddbPersistence | null = null
  private role: CollabRole | null = null
  private participantId: string | null = null
  private readonly clientId = getClientId()
  private peersTimer: ReturnType<typeof setTimeout> | null = null
  private cursorTimer: ReturnType<typeof setTimeout> | null = null
  private pendingPresence: Presence = {}
  private lastBlockedToast = 0
  private waitingForContent: (() => void) | null = null
  private adopted = false
  private closed = false

  constructor(options: SessionOptions) {
    this.options = options
    this.awareness = new Awareness(this.doc)
  }

  get readOnly() {
    return this.role === 'viewer'
  }

  /** Conecta. Resuelve con la primera respuesta del servidor (welcome / pending / rejected…). */
  async start(): Promise<void> {
    const { name, color, kind } = this.options
    saveDefaultName(name)
    useCollabStore.setState({
      ...initialCollabState(),
      status: 'connecting',
      me: { participantId: null, name, color, kind, role: null },
      bindingEpoch: useCollabStore.getState().bindingEpoch + 1,
    })

    if (this.options.persistence !== false && typeof indexedDB !== 'undefined') {
      try {
        this.persistence = new IndexeddbPersistence(`db-tracker:collab:${this.options.sessionId}`, this.doc)
        await Promise.race([this.persistence.whenSynced, new Promise((r) => setTimeout(r, 1500))])
      } catch {
        this.persistence = null
      }
    }

    this.awareness.setLocalState({
      user: this.awarenessUser(),
      branchId: useProjectStore.getState().project.currentBranchId,
      route: typeof location !== 'undefined' ? location.pathname : '/',
      cursor: null,
      selection: null,
      editing: null,
    } satisfies AwarenessState)
    this.awareness.on('change', this.onAwarenessChange)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }
      this.provider = new SyncProvider({
        url: syncUrl(this.options.baseUrl, this.options.sessionId),
        doc: this.doc,
        awareness: this.awareness,
        WebSocketImpl: this.options.WebSocketImpl,
        hello: () => ({ secret: this.options.secret, name, color, kind, clientId: this.clientId }),
        canWrite: () => !this.readOnly,
        onStatus: this.onProviderStatus,
        onSynced: this.onSynced,
        onControl: (msg) => {
          this.onControl(msg)
          if (msg.t !== 'participants' && msg.t !== 'role' && msg.t !== 'error') settle(resolve)
        },
        onConnectError: (error) =>
          settle(() => reject(new Error(`No se pudo conectar con la sesión (${syncUrl(this.options.baseUrl, this.options.sessionId)}): ${error.message}`))),
      })
    })
  }

  /** Sale: cierra la conexión y, si era invitado, restaura el proyecto local o se queda con la copia. */
  async leave(keepCopy: boolean): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.waitingForContent) this.doc.off('update', this.waitingForContent)
    this.binding?.destroy()
    this.binding = null
    this.provider?.destroy()
    this.provider = null
    this.awareness.off('change', this.onAwarenessChange)
    if (this.peersTimer) clearTimeout(this.peersTimer)
    if (this.cursorTimer) clearTimeout(this.cursorTimer)
    this.awareness.destroy()
    if (this.persistence) {
      try {
        await this.persistence.clearData()
      } catch {
        // la copia local de la sesión se quedará huérfana; no afecta al proyecto
      }
      this.persistence = null
    }
    this.doc.destroy()

    if (this.adopted) {
      setPersistKey(PROJECT_PERSIST_KEY)
      if (keepCopy) {
        discardProjectBackup()
        // Fuerza la escritura del proyecto compartido en la clave normal (persist escribe en cada set).
        useProjectStore.setState((s) => ({ project: { ...s.project, github: undefined } }))
      } else if (!restoreProjectBackup()) {
        // Sin copia (no debería pasar): se recarga lo persistido en la clave normal, que no se tocó.
        await useProjectStore.persist.rehydrate()
      }
      clearCollabPersist()
    }

    const { me } = useCollabStore.getState()
    useCollabStore.setState({
      ...initialCollabState(),
      me: { ...me, participantId: null, role: null },
      bindingEpoch: useCollabStore.getState().bindingEpoch + 1,
    })
  }

  reconnect() {
    this.provider?.reconnect()
  }

  /* ─────────────── Presencia ─────────────── */

  updatePresence(patch: Presence) {
    if (this.closed) return
    Object.assign(this.pendingPresence, patch)
    const onlyCursor = Object.keys(patch).every((k) => k === 'cursor')
    if (onlyCursor) {
      this.cursorTimer ??= setTimeout(this.flushPresence, CURSOR_THROTTLE_MS)
      return
    }
    this.flushPresence()
  }

  private flushPresence = () => {
    if (this.cursorTimer) clearTimeout(this.cursorTimer)
    this.cursorTimer = null
    const patch = this.pendingPresence
    this.pendingPresence = {}
    const current = this.awareness.getLocalState()
    if (!current || this.closed) return
    const changed = Object.entries(patch).some(([k, v]) => JSON.stringify(current[k]) !== JSON.stringify(v))
    if (changed) this.awareness.setLocalState({ ...current, ...patch })
  }

  private awarenessUser(): AwarenessState['user'] {
    const { name, color, kind } = this.options
    return { id: this.participantId ?? this.clientId, name, color, kind, role: this.role ?? 'editor' }
  }

  private onAwarenessChange = () => {
    this.peersTimer ??= setTimeout(() => {
      this.peersTimer = null
      if (this.closed) return
      const peers: Record<number, AwarenessState> = {}
      this.awareness.getStates().forEach((state, clientId) => {
        if (clientId !== this.doc.clientID && (state as Partial<AwarenessState>).user) peers[clientId] = state as AwarenessState
      })
      useCollabStore.setState({ peers })
    }, PEERS_THROTTLE_MS)
  }

  /* ─────────────── Control y estado ─────────────── */

  private onProviderStatus = (status: ProviderStatus) => {
    if (this.closed) return
    const current = useCollabStore.getState().status
    if (current === 'rejected' || current === 'kicked' || current === 'ended') return
    if (status === 'reconnecting' || status === 'offline') useCollabStore.setState({ status })
    else if (status === 'connecting' && current !== 'pending') useCollabStore.setState({ status: 'connecting' })
  }

  private onControl(msg: ControlMessage) {
    if (this.closed) return
    switch (msg.t) {
      case 'pending':
        useCollabStore.setState({ status: 'pending' })
        break
      case 'welcome': {
        this.participantId = msg.participantId
        this.setRole(msg.role)
        useCollabStore.setState((s) => ({
          status: 'connected',
          session: msg.session,
          isHost: msg.role === 'owner',
          error: null,
          me: { ...s.me, participantId: msg.participantId, role: msg.role },
        }))
        break
      }
      case 'role':
        this.setRole(msg.role)
        useCollabStore.setState((s) => ({ isHost: msg.role === 'owner', me: { ...s.me, role: msg.role } }))
        if (msg.role === 'viewer') toast.info('Ahora tienes acceso de solo lectura')
        else toast.success('Ahora puedes editar el proyecto compartido')
        break
      case 'participants':
        useCollabStore.setState({ participants: msg.list })
        break
      case 'rejected':
        useCollabStore.setState({ status: 'rejected', error: msg.reason || 'El anfitrión rechazó la solicitud' })
        break
      case 'kicked':
        this.binding?.flush()
        useCollabStore.setState({ status: 'kicked', error: 'El anfitrión te sacó de la sesión' })
        break
      case 'ended':
        this.binding?.flush()
        useCollabStore.setState({ status: 'ended', error: null })
        break
      case 'error':
        useCollabStore.setState({ error: msg.message })
        break
      case 'hello':
        break
    }
  }

  private setRole(role: CollabRole) {
    const wasViewer = this.role === 'viewer'
    this.role = role
    useCollabStore.setState({ readOnly: role === 'viewer' })
    const state = this.awareness.getLocalState()
    if (state) this.awareness.setLocalState({ ...state, user: this.awarenessUser() })
    // Pasa de lector a editor: su rama puede no tener aún borrador compartido.
    if (wasViewer && role !== 'viewer' && this.binding) {
      const branchId = this.binding.currentBranchId
      if (!rootMaps(this.doc).drafts.has(branchId)) {
        this.doc.transact(() => createDraft(this.doc, branchId, headDraft(this.doc, branchId)), LOCAL_ORIGIN)
      }
    }
  }

  /* ─────────────── Montaje del binding ─────────────── */

  private onSynced = () => {
    if (this.closed || this.binding || this.waitingForContent) return
    if (this.options.mode === 'seed-from-local') this.seedAndMount()
    else if (isDocEmpty(this.doc)) {
      // El anfitrión aún no sembró el documento: se espera a que llegue el proyecto.
      this.waitingForContent = () => {
        if (isDocEmpty(this.doc)) return
        this.doc.off('update', this.waitingForContent!)
        this.waitingForContent = null
        this.adoptAndMount()
      }
      this.doc.on('update', this.waitingForContent)
    } else this.adoptAndMount()
  }

  private newBinding() {
    return new StoreBinding(this.doc, {
      isReadOnly: () => this.readOnly,
      onBlocked: () => {
        const now = Date.now()
        if (now - this.lastBlockedToast < BLOCKED_TOAST_EVERY_MS) return
        this.lastBlockedToast = now
        toast.warning('Solo lectura', { description: 'Tu rol en esta sesión no permite modificar el proyecto compartido.' })
      },
      onBranchChange: (branchId) => {
        this.updatePresence({ branchId })
        useCollabStore.setState((s) => ({ bindingEpoch: s.bindingEpoch + 1 }))
      },
    })
  }

  /**
   * Anfitrión: siembra el documento con el proyecto local si está vacío. Si ya tiene contenido (sala persistida)
   * y es el mismo proyecto, el documento manda y solo se añaden versiones, ramas y borrador que falten.
   * Si es OTRO proyecto (p. ej. una segunda ventana local con otro proyecto), no se mezcla nada: se adopta
   * como un invitado, protegiendo el proyecto local con la copia de seguridad.
   */
  private seedAndMount() {
    const s = useProjectStore.getState()
    const branchId = s.project.currentBranchId
    if (!isDocEmpty(this.doc) && readMeta(this.doc).projectId && readMeta(this.doc).projectId !== s.project.id) {
      this.adoptAndMount()
      return
    }
    if (!this.readOnly) {
      if (isDocEmpty(this.doc)) {
        writeProjectToDoc(this.doc, s.project, { [branchId]: { schema: s.draft, baseVersionId: s.baseVersionId } }, LOCAL_ORIGIN)
      } else {
        // Sesión persistida: el documento manda; se añaden versiones, ramas y borrador que falten.
        this.doc.transact(() => {
          const { versions, drafts } = rootMaps(this.doc)
          writeVersions(this.doc, s.project.versions.filter((v) => !versions.has(v.id)))
          writeBranches(this.doc, s.project.branches.filter((b) => !rootMaps(this.doc).branches.has(b.id)), false)
          if (!drafts.has(branchId)) createDraft(this.doc, branchId, { schema: s.draft, baseVersionId: s.baseVersionId })
        }, LOCAL_ORIGIN)
      }
    }
    this.binding = this.newBinding()
    this.binding.mount(branchId)
  }

  /** Invitado: guarda el proyecto local aparte y muestra el compartido (en un solo set). */
  private adoptAndMount() {
    if (this.closed) return
    backupLocalProject()
    setPersistKey(COLLAB_PERSIST_KEY)
    this.adopted = true
    const { project } = docToProject(this.doc)
    const branchId = this.initialBranch(project.branches.map((b) => b.id)) ?? project.currentBranchId
    const ydraft = rootMaps(this.doc).drafts.get(branchId)
    const draft = ydraft ? readDraft(ydraft) : headDraft(this.doc, branchId)
    const local = useProjectStore.getState().project
    useProjectStore.setState({
      // Las conexiones remotas son locales (sin contraseñas) y GitHub no se comparte.
      project: { ...project, currentBranchId: branchId, connections: local.connections, github: undefined },
      draft: draft.schema,
      baseVersionId: draft.baseVersionId,
      selection: null,
    })
    this.binding = this.newBinding()
    this.binding.mount(branchId)
  }

  /** Rama del anfitrión si se conoce por awareness; si no, main o la primera. */
  private initialBranch(ids: string[]): string | undefined {
    let hostBranch: string | undefined
    this.awareness.getStates().forEach((state) => {
      const s = state as Partial<AwarenessState>
      if (s.user?.role === 'owner' && s.branchId && ids.includes(s.branchId)) hostBranch = s.branchId
    })
    if (hostBranch) return hostBranch
    const { branches } = rootMaps(this.doc)
    return ids.find((id) => branches.get(id)?.get('name') === 'main') ?? ids[0]
  }
}
