import { ChevronDown } from 'lucide-react'

import type { CollabRole, Participant, ParticipantAction } from '@/collab'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { ROLE_LABEL } from '../activity'
import { KIND_LABEL } from '../lib/identity'
import { PeerAvatar } from './Avatars'

interface Props {
  participants: Participant[]
  meId: string | null
  /** Anfitrión: aprobar, rechazar, cambiar rol y expulsar. */
  canManage?: boolean
  busyId?: string | null
  onAction?: (id: string, action: ParticipantAction) => void
}

function Row({ p, isMe, children }: { p: Participant; isMe: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex min-h-11 items-center gap-3 py-2 animate-in fade-in duration-200 motion-reduce:animate-none">
      <PeerAvatar name={p.name} color={p.color} kind={p.kind} className="size-7 text-[11px]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {p.name}
          {isMe && <span className="font-normal text-muted-foreground"> (tú)</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {KIND_LABEL[p.kind]}
          {p.address && <span className="font-mono"> · {p.address}</span>}
        </div>
      </div>
      {children}
    </li>
  )
}

/** Lista de participantes en texto plano: anfitrión, pendientes y activos. */
export function ParticipantList({ participants, meId, canManage = false, busyId, onAction }: Props) {
  const pending = participants.filter((p) => p.status === 'pending')
  const active = participants
    .filter((p) => p.status === 'active')
    .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.joinedAt.localeCompare(b.joinedAt)))
  const act = (id: string, action: ParticipantAction) => onAction?.(id, action)

  return (
    <div className="space-y-3">
      {canManage && pending.length > 0 && (
        <section aria-label="Esperando aprobación">
          <h4 className="text-xs font-medium text-amber-700 dark:text-amber-400">Esperando aprobación · {pending.length}</h4>
          <ul className="divide-y">
            {pending.map((p) => (
              <Row key={p.id} p={p} isMe={false}>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="ghost" size="sm" className="max-sm:h-11" disabled={busyId === p.id} onClick={() => act(p.id, { action: 'reject' })}>
                    Rechazar
                  </Button>
                  <Button size="sm" className="max-sm:h-11" disabled={busyId === p.id} onClick={() => act(p.id, { action: 'approve' })}>
                    Aceptar
                  </Button>
                </div>
              </Row>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Participantes">
        <h4 className="text-xs font-medium text-muted-foreground">En la sesión · {active.length}</h4>
        {active.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Todavía no hay nadie.</p>
        ) : (
          <ul className="divide-y">
            {active.map((p) => (
              <Row key={p.id} p={p} isMe={p.id === meId}>
                {p.role === 'owner' || !canManage ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABEL[p.role]}</span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="max-sm:h-11 text-muted-foreground" disabled={busyId === p.id}>
                          {ROLE_LABEL[p.role]}
                          <ChevronDown data-icon="inline-end" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuRadioGroup
                          value={p.role}
                          onValueChange={(role) => act(p.id, { action: 'set-role', role: role as Exclude<CollabRole, 'owner'> })}
                        >
                          <DropdownMenuRadioItem value="editor">Editor</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="viewer">Solo lectura</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn('max-sm:h-11 text-destructive hover:text-destructive')}
                      disabled={busyId === p.id}
                      onClick={() => act(p.id, { action: 'kick' })}
                    >
                      Expulsar
                    </Button>
                  </div>
                )}
              </Row>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
