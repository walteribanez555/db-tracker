import { ChevronDown, Link2, LogIn, LogOut, Share2, Users } from 'lucide-react'
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
import { collabApi } from '../api'
import { STATUS_LABEL, TONE_DOT, statusTone, useActiveParticipants } from '../hooks'
import { copyText } from '../lib/clipboard'
import { joinAsHost, stopSharing } from '../lib/host'
import { isLoopbackOrigin } from '../lib/identity'
import { buildJoinLink, useJoinContext } from '../lib/join'
import { usePresencePublisher } from '../presence/usePresencePublisher'
import { AvatarStack } from './Avatars'
import { JoinDialog } from './JoinDialog'
import { LeaveDialog, type LeaveReason } from './LeaveDialog'
import { ParticipantList } from './ParticipantList'
import { ShareDialog } from './ShareDialog'

const personas = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`

/** Tras recargar la ventana del anfitrión: si el servidor sigue compartiendo, vuelve a conectarse como owner. */
function useHostAutoRejoin() {
  useEffect(() => {
    if (!isLoopbackOrigin()) return
    let alive = true
    collabApi
      .status()
      .then((st) => {
        if (alive && st.session && useCollabStore.getState().status === 'idle') return joinAsHost(st.session)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
}

/** Cabecera: indicador de sesión (avatares, estado, menú) o los botones "Compartir" y "Unirse". */
export function CollabHeader({ className }: { className?: string }) {
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
  const [leaving, setLeaving] = useState(false)
  // Fin de sesión o expulsión de un invitado: preguntar si se queda con una copia (hasta que elija).
  const forced: LeaveReason | null = !isHost && (status === 'kicked' || status === 'ended') ? status : null
  const leave: LeaveReason | null = forced ?? (leaving ? 'leave' : null)

  const inSession = status !== 'idle' && status !== 'rejected' && !(isHost && status === 'ended')
  const count = active.length || peerCount + 1
  const tone = statusTone(status)
  const host = active.find((p) => p.role === 'owner')

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
        : `${isHost ? 'Compartiendo' : 'En sesión'} · ${personas(count)}`

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
              <span className="hidden whitespace-nowrap sm:inline">{label}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="space-y-0.5 py-2 font-normal">
              <span className="block truncate text-sm font-medium text-foreground">{session?.projectName ?? 'Sesión compartida'}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {isHost ? 'Eres el anfitrión' : `Anfitrión: ${host?.name ?? session?.hostName ?? '—'}`} · {personas(count)}
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
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void exit()} className="max-sm:min-h-11">
              <LogOut />
              {isHost ? 'Dejar de compartir' : 'Salir'}
            </DropdownMenuItem>
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

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
      <JoinDialog open={joinOpen} onOpenChange={setJoinOpen} />
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
