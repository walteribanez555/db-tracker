// Selectores de la UI sobre el store del cliente de colaboración (src/collab).
import { useMemo } from 'react'
import { useLocation } from 'react-router'
import { useShallow } from 'zustand/react/shallow'

import { useCollabStore, type AwarenessState, type ConnectionStatus, type Participant } from '@/collab'
import { useProjectStore } from '@/store/project'

/** Estados en los que hay (o se intenta mantener) una sesión. */
const IN_SESSION: ConnectionStatus[] = ['connecting', 'pending', 'connected', 'reconnecting', 'offline']

export const useCollabStatus = () => useCollabStore((s) => s.status)

/** true mientras este cliente está en una sesión (anfitrión o invitado), aunque esté reconectando. */
export const useIsCollaborating = () => useCollabStore((s) => IN_SESSION.includes(s.status) && s.status !== 'pending')

/** Invitado con rol "Solo lectura". */
export const useIsReadOnly = () => useCollabStore((s) => s.me.role === 'viewer' && IN_SESSION.includes(s.status))

/** Participantes activos, el anfitrión primero. */
export function useActiveParticipants(): Participant[] {
  const list = useCollabStore((s) => s.participants)
  return useMemo(
    () => list.filter((p) => p.status === 'active').sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.joinedAt.localeCompare(b.joinedAt))),
    [list],
  )
}

export type StatusTone = 'ok' | 'wait' | 'down'

export function statusTone(status: ConnectionStatus): StatusTone {
  if (status === 'connected') return 'ok'
  if (status === 'connecting' || status === 'pending' || status === 'reconnecting') return 'wait'
  return 'down'
}

export const TONE_DOT: Record<StatusTone, string> = {
  ok: 'bg-emerald-500',
  wait: 'bg-amber-500 animate-pulse motion-reduce:animate-none',
  down: 'bg-red-500',
}

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: 'Sin sesión',
  connecting: 'Conectando…',
  pending: 'Esperando aprobación',
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  offline: 'Sin conexión',
  rejected: 'Solicitud rechazada',
  kicked: 'Expulsado de la sesión',
  ended: 'Sesión terminada',
}

export interface PeerHere {
  key: number
  state: AwarenessState
}

/** Peers (awareness) que están en la misma ruta y rama que yo, sin incluirme. */
export function usePeersHere(): PeerHere[] {
  const { pathname } = useLocation()
  const branchId = useProjectStore((s) => s.project.currentBranchId)
  const myId = useCollabStore((s) => s.me.participantId)
  const peers = useCollabStore(useShallow((s) => s.peers))
  const live = useIsCollaborating()
  return useMemo(
    () =>
      !live
        ? []
        : Object.entries(peers)
        .filter(([, st]) => st?.user && st.user.id !== myId && st.route === pathname && st.branchId === branchId)
        .map(([k, st]) => ({ key: Number(k), state: st })),
    [live, peers, myId, pathname, branchId],
  )
}
