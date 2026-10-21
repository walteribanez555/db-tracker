// API pública del cliente de colaboración. La UI (src/features/collab/**) solo importa desde aquí.
// Este módulo es ligero: Yjs, y-protocols e y-indexeddb se cargan bajo demanda al unirse (./session).
import { useMemo } from 'react'
import type { Awareness } from 'y-protocols/awareness'

import { useProjectStore } from '@/store/project'

import type { AwarenessState, ClientKind, CollabRole } from './protocol'
import type { CollabSession } from './session'
import { getDefaultColor, useCollabStore } from './store'

export * from './protocol'
export {
  COLLAB_COLORS,
  COLLAB_NAME_KEY,
  colorFor,
  detectKind,
  getClientId,
  getDefaultColor,
  getDefaultName,
  saveDefaultName,
  useCollabStore,
  type CollabState,
  type ConnectionStatus,
} from './store'
export { BACKUP_KEY, hasProjectBackup, restoreProjectBackup } from './backup'
export {
  getSharedBenchmarks,
  MAX_ACTIVITY,
  useActivity,
  useSharedBenchmarks,
  type SharedBenchmark,
} from './feed'

export interface JoinOptions {
  /** Base http(s) del anfitrión, p. ej. "http://192.168.1.24:47123" ('' = mismo origen). */
  baseUrl: string
  sessionId: string
  secret: string
  name: string
  color?: string
  kind?: ClientKind
  /**
   * Qué hacer con el proyecto local al entrar:
   * - 'adopt-remote' (invitado): el documento compartido reemplaza la vista local mientras dure la sesión;
   *   el proyecto local se guarda aparte y se restaura al salir (o se conserva una copia si se elige).
   * - 'seed-from-local' (anfitrión): si el documento está vacío, se siembra con el proyecto local.
   */
  mode: 'adopt-remote' | 'seed-from-local'
}

let session: CollabSession | null = null
/** Cola: joinSession/leaveSession se ejecutan de uno en uno (evita dos sesiones enlazadas al mismo store). */
let queue: Promise<unknown> = Promise.resolve()
const serialize = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn)
  queue = run.catch(() => undefined)
  return run
}

/** Conecta a una sesión. Resuelve cuando hay respuesta (welcome / pending / rejected). */
export function joinSession(options: JoinOptions): Promise<void> {
  return serialize(async () => {
    if (session) {
      const previous = session
      session = null
      await previous.leave(false)
    }
    const { CollabSession } = await import('./session')
    const { me } = useCollabStore.getState()
    const current = new CollabSession({
      baseUrl: options.baseUrl,
      sessionId: options.sessionId,
      secret: options.secret,
      name: options.name.trim() || me.name || 'Invitado',
      color: options.color ?? me.color ?? getDefaultColor(),
      kind: options.kind ?? me.kind,
      mode: options.mode,
    })
    session = current
    try {
      await current.start()
    } catch (error) {
      if (session === current) session = null
      await current.leave(false)
      useCollabStore.setState({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  })
}

/** Sale de la sesión. keepCopy: conserva el proyecto compartido como proyecto local. */
export function leaveSession(options: { keepCopy: boolean } = { keepCopy: false }): Promise<void> {
  return serialize(async () => {
    const current = session
    session = null
    if (current) await current.leave(options.keepCopy)
  })
}

/** Reintenta la conexión ya (sin esperar al backoff). */
export function reconnectSession(): void {
  session?.reconnect()
}

/** Publica en awareness el cursor (coordenadas del lienzo), la selección, la ruta o lo que se edita. */
export function updatePresence(patch: Partial<Omit<AwarenessState, 'user'>>): void {
  session?.updatePresence(patch)
}

/** Y.Text compartido para enlazar Monaco (y-monaco) con el SQL de una vista o el cuerpo de una función. */
export function getSharedText(kind: 'view-definition' | 'function-body', id: string): unknown | null {
  return session?.binding?.getText(kind, id) ?? null
}

/** Awareness de y-protocols de la sesión activa (o null). */
export function getAwareness(): Awareness | null {
  return session?.awareness ?? null
}

/** Secreto de la sesión a partir de joinUrl (va en el hash: …#s=SECRETO). */
export function secretFromJoinUrl(joinUrl: string): string {
  const hash = joinUrl.includes('#') ? joinUrl.slice(joinUrl.indexOf('#') + 1) : ''
  return new URLSearchParams(hash).get('s') ?? ''
}

/* ───────────────────────── Hooks ───────────────────────── */

const ACTIVE = new Set(['connected', 'reconnecting', 'offline'])

/** true mientras hay una sesión en curso (conectada o reconectando). */
export const useIsCollaborating = (): boolean => useCollabStore((s) => ACTIVE.has(s.status))

export interface Peer {
  /** clientID de Yjs (clave de awareness). */
  clientId: number
  id: string
  name: string
  color: string
  kind: ClientKind
  role: CollabRole
  branchId: string
  route: string
  cursor: AwarenessState['cursor']
  selection: AwarenessState['selection']
  editing: AwarenessState['editing'] | null
}

/** Participantes remotos con su presencia (ruta, cursor, selección, rama y edición). */
export function usePeers(): Peer[] {
  const peers = useCollabStore((s) => s.peers)
  return useMemo(
    () =>
      Object.entries(peers).map(([clientId, s]) => ({
        clientId: Number(clientId),
        id: s.user.id,
        name: s.user.name,
        color: s.user.color,
        kind: s.user.kind,
        role: s.user.role,
        branchId: s.branchId,
        route: s.route,
        cursor: s.cursor ?? null,
        selection: s.selection ?? null,
        editing: s.editing ?? null,
      })),
    [peers],
  )
}

/** getSharedText reactivo: se recalcula al montar el binding, cambiar de rama o crear/borrar la entidad. */
export function useSharedText(kind: 'view-definition' | 'function-body', id: string | null | undefined): unknown | null {
  const epoch = useCollabStore((s) => s.bindingEpoch)
  const status = useCollabStore((s) => s.status)
  const exists = useProjectStore((s) =>
    id ? (kind === 'view-definition' ? s.draft.views.some((v) => v.id === id) : s.draft.functions.some((f) => f.id === id)) : false,
  )
  // `epoch` invalida el resultado al montar el binding o cambiar de rama.
  return useMemo(() => (epoch > 0 && status !== 'idle' && id && exists ? getSharedText(kind, id) : null), [kind, id, exists, epoch, status])
}
