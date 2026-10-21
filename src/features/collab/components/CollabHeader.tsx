import { Bot, ChevronDown, Link2, LogIn, LogOut, MoreHorizontal, Share2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useCollabStore } from '@/collab'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { useActivityTracker } from '../activity'
import { agentes, isAgent } from '../agents'
import { collabApi } from '../api'
import { STATUS_LABEL, TONE_DOT, statusTone, useActiveParticipants } from '../hooks'
import { copyText } from '../lib/clipboard'
import { claimLocalSession, isJoiningAsHost, joinAsHost, stopSharing } from '../lib/host'
import { isLoopbackOrigin } from '../lib/identity'
import { buildJoinLink, useJoinContext } from '../lib/join'
import { usePresencePublisher } from '../presence/usePresencePublisher'
import { AgentsDialog } from './AgentsDialog'
import { AvatarStack } from './Avatars'
import { JoinDialog } from './JoinDialog'
import { LeaveDialog, type LeaveReason } from './LeaveDialog'
import { ParticipantList } from './ParticipantList'
import { ShareDialog } from './ShareDialog'

const personas = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`

const AGENT_POLL_MS = 3000

/**
 * Tras recargar la ventana del anfitrión: si el servidor sigue compartiendo, vuelve a conectarse como owner.
 * Además, mientras no hay sesión, sondea si un agente abrió una sesión LOCAL (session_open por MCP) y se une
 * como anfitriona para sembrar el proyecto: el servidor espera a que la app lo haga.
 */
function useHostAutoRejoin() {
  useEffect(() => {
    if (!isLoopbackOrigin()) return
    let alive = true
    collabApi
      .status()
      .then((st) => {
        if (alive && st.session && useCollabStore.getState().status === 'idle' && !isJoiningAsHost()) return joinAsHost(st.session)
      })
      .catch(() => undefined)

    let failedFor: string | null = null
    let unavailable = false
    const poll = async () => {
      const { status } = useCollabStore.getState()
      if (unavailable || status !== 'idle' || isJoiningAsHost() || document.visibilityState !== 'visible') return
      const st = await collabApi.status().catch((err: unknown) => {
        // Servidor sin colaboración: no se insiste.
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'unavailable') unavailable = true
        return null
      })
      const session = st?.session
      if (!alive || !session || session.network !== 'local' || session.id === failedFor) return
      if (useCollabStore.getState().status !== 'idle' || isJoiningAsHost()) return
      try {
        const claimed = await claimLocalSession(session)
        if (useCollabStore.getState().status !== 'idle' || isJoiningAsHost()) return
        await joinAsHost(claimed)
        toast('Un agente de Claude Code abrió una sesión local', { description: 'Esta ventana es la anfitriona: verás sus cambios en tiempo real.' })
      } catch {
        failedFor = session.id
      }
    }
    const timer = setInterval(() => void poll(), AGENT_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
}

/**
 * Cabecera: indicador de sesión (avatares, estado, menú) o los botones "Compartir", "Unirse" y "Agentes".
 * compact (móvil): sin textos; solo avatares, punto de estado y un menú con todas las acciones.
 */
export function CollabHeader({ className, compact = false }: { className?: string; compact?: boolean }) {
  useActivityTracker()
  usePresencePublisher()
  useHostAutoRejoin()

  const status = useCollabStore((s) => s.status)
  const isHost = useCollabStore((s) => s.isHost)
  const session = useCollabStore((s) => s.session)
  const meId = useCollabStore((s) => s.me.participantId)
  const participants = useCollabStore((s) => s.participants)
  const peerCount = useCollabStore((s) => Object.keys(s.peers).length)
  const active = useActiveParticipants()
  const [shareOpen, setShareOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // Fin de sesión o expulsión de un invitado: preguntar si se queda con una copia (hasta que elija).
  const forced: LeaveReason | null = !isHost && (status === 'kicked' || status === 'ended') ? status : null
  const leave: LeaveReason | null = forced ?? (leaving ? 'leave' : null)

  const inSession = status !== 'idle' && status !== 'rejected' && !(isHost && status === 'ended')
  const agentCount = active.filter(isAgent).length
  const count = active.length ? active.length - agentCount : peerCount + 1
  const who = agentCount ? `${personas(count)} · ${agentes(agentCount)}` : personas(count)
  const tone = statusTone(status)
  const host = active.find((p) => p.role === 'owner')
  // Los agentes se conectan por loopback: solo el equipo anfitrión puede configurarlos.
  const canAgents = isLoopbackOrigin() && (!inSession || isHost)
  const agentsLabel = agentCount ? `Agentes · ${agentCount}` : 'Agentes'

  const copyLink = async () => {
    let link: string | null = null
    if (isHost) link = (await collabApi.status().catch(() => null))?.session?.joinUrl ?? null
    else {
      const ctx = useJoinContext.getState().ctx
      link = ctx ? buildJoinLink(ctx) : null
    }
    if (link && (await copyText(link))) toast('Enlace copiado')
    else toast.error('No se pudo copiar el enlace.')
  }

  const exit = async () => {
    if (!isHost) return setLeaving(true)
    try {
      await stopSharing()
      toast('Has dejado de compartir el proyecto')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo dejar de compartir.')
    }
  }

  const label =
    status === 'pending'
      ? 'Esperando aprobación'
      : status === 'connecting'
        ? 'Conectando…'
        : `${isHost ? 'Compartiendo' : 'En sesión'} · ${who}`

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {inSession ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${label}. ${STATUS_LABEL[status]}`}
              className="inline-flex h-8 items-center gap-2 rounded-md px-1.5 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted max-sm:h-11"
            >
              {active.length > 0 && <AvatarStack people={active} />}
              <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
              <span className={cn('hidden whitespace-nowrap', !compact && 'sm:inline')}>{label}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="space-y-0.5 py-2 font-normal">
              <span className="block truncate text-sm font-medium text-foreground">{session?.projectName ?? 'Sesión compartida'}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {isHost ? 'Eres el anfitrión' : `Anfitrión: ${host?.name ?? session?.hostName ?? '—'}`} · {who}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn('size-1.5 rounded-full', TONE_DOT[tone])} aria-hidden />
                {STATUS_LABEL[status]}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void copyLink()} className="max-sm:min-h-11">
              <Link2 />
              Copiar enlace
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => (isHost ? setShareOpen(true) : setPeopleOpen(true))} className="max-sm:min-h-11">
              <Users />
              Ver participantes
            </DropdownMenuItem>
            {canAgents && (
              <DropdownMenuItem onSelect={() => setAgentsOpen(true)} className="max-sm:min-h-11">
                <Bot />
                Conectar agentes
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void exit()} className="max-sm:min-h-11">
              <LogOut />
              {isHost ? 'Dejar de compartir' : 'Salir'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Colaboración" className="max-sm:size-11">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {isLoopbackOrigin() && (
              <DropdownMenuItem onSelect={() => setShareOpen(true)} className="min-h-11">
                <Share2 />
                Compartir
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setJoinOpen(true)} className="min-h-11">
              <LogIn />
              Unirse
            </DropdownMenuItem>
            {canAgents && (
              <DropdownMenuItem onSelect={() => setAgentsOpen(true)} className="min-h-11">
                <Bot />
                Conectar agentes
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          {isLoopbackOrigin() && (
            <Button variant="outline" size="sm" onClick={() => setShareOpen(true)} className="max-sm:h-11">
              <Share2 />
              Compartir
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setJoinOpen(true)} className="max-sm:h-11">
            <LogIn />
            Unirse
          </Button>
        </>
      )}
      {/* En sesión el acceso queda a la vista (como anfitrión); compacto, va en el menú. */}
      {canAgents && !compact && (
        <Button variant="ghost" size="sm" onClick={() => setAgentsOpen(true)} aria-label={`Conectar agentes${agentCount ? ` (${agentes(agentCount)})` : ''}`} className="max-sm:h-11">
          <Bot />
          <span className={cn(inSession && 'hidden md:inline')}>{agentsLabel}</span>
        </Button>
      )}

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
      <JoinDialog open={joinOpen} onOpenChange={setJoinOpen} />
      <AgentsDialog open={agentsOpen} onOpenChange={setAgentsOpen} />
      <LeaveDialog reason={leave} onOpenChange={(o) => !o && setLeaving(false)} />
      <Dialog open={peopleOpen} onOpenChange={setPeopleOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Participantes</DialogTitle>
            <DialogDescription>{session?.projectName ?? 'Sesión compartida'}</DialogDescription>
          </DialogHeader>
          <ParticipantList participants={participants} meId={meId} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
