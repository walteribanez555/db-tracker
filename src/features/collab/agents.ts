// Agentes de Claude Code conectados por MCP: participantes con kind 'agent' + su presencia (awareness).
import { useMemo } from 'react'

import { useCollabStore, type AwarenessState, type Participant } from '@/collab'
import { useProjectStore } from '@/store/project'

export interface AgentView {
  participant: Participant
  /** Qué está haciendo (set_status). null = inactivo. */
  status: string | null
  /** Rama en la que trabaja (nombre si se conoce). */
  branch: string | null
}

/** El servidor puede publicar el texto de set_status aparte (status) o en editing.label. */
type AgentAwareness = AwarenessState & { status?: string | null }

export const isAgent = (p: { kind: string }) => p.kind === 'agent'

/** Agentes de la lista dada (o de la sesión) con su estado y rama. Pendientes primero. */
export function useAgents(participants?: Participant[]): AgentView[] {
  const fromStore = useCollabStore((s) => s.participants)
  const peers = useCollabStore((s) => s.peers)
  const branches = useProjectStore((s) => s.project.branches)
  const list = participants ?? fromStore
  return useMemo(() => {
    const states = Object.values(peers) as AgentAwareness[]
    return list
      .filter(isAgent)
      .map((p) => {
        const st = states.find((s) => s.user?.id === p.id) ?? states.find((s) => s.user?.kind === 'agent' && s.user.name === p.name)
        const status = (st?.status || st?.editing?.label || '').trim() || null
        const branch = st?.branchId ? (branches.find((b) => b.id === st.branchId)?.name ?? st.branchId) : null
        return { participant: p, status, branch }
      })
      .sort((a, b) =>
        a.participant.status !== b.participant.status
          ? a.participant.status === 'pending'
            ? -1
            : 1
          : a.participant.joinedAt.localeCompare(b.participant.joinedAt),
      )
  }, [list, peers, branches])
}

export const agentes = (n: number) => `${n} ${n === 1 ? 'agente' : 'agentes'}`
