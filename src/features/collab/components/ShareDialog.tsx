import { Check, Copy } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useCollabStore, type Participant, type ParticipantAction, type SessionInfo } from '@/collab'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useProjectStore } from '@/store/project'

import { CollabApiError, collabApi, type CollabStatus } from '../api'
import { copyText } from '../lib/clipboard'
import { hostDisplayName, joinAsHost, joinedTo, stopSharing } from '../lib/host'
import { isLoopbackOrigin, useCollabPrefs } from '../lib/identity'
import { ParticipantList } from './ParticipantList'

type Load = { kind: 'loading' } | { kind: 'unavailable'; message: string } | { kind: 'ready' }

const POLL_MS = 2500

type StatusResult = { ok: true; status: CollabStatus } | { ok: false; message: string }

async function fetchStatus(): Promise<StatusResult> {
  try {
    return { ok: true, status: await collabApi.status() }
  } catch (err) {
    const unavailable = err instanceof CollabApiError && (err.code === 'unavailable' || err.status === 404)
    return {
      ok: false,
      message: unavailable
        ? 'Este servidor no tiene la colaboración en red. Actualiza DB Tracker o, en desarrollo, reinicia la API con npm run dev:api.'
        : 'No se pudo contactar con el servidor local. Comprueba que la API está en marcha (npm run dev:api).',
    }
  }
}

const fmtCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`

export function ShareDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        {open && <ShareBody onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ShareBody({ onClose }: { onClose: () => void }) {
  const projectName = useProjectStore((s) => s.project.name)
  const name = useCollabPrefs((s) => s.name)
  const setName = useCollabPrefs((s) => s.setName)
  const isHost = useCollabStore((s) => s.isHost)
  const status = useCollabStore((s) => s.status)
  const storeParticipants = useCollabStore((s) => s.participants)
  const meId = useCollabStore((s) => s.me.participantId)
  const [load, setLoad] = useState<Load>(() =>
    isLoopbackOrigin()
      ? { kind: 'loading' }
      : { kind: 'unavailable', message: 'Solo el equipo que tiene el proyecto puede compartirlo. Desde aquí puedes unirte a una sesión.' },
  )
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [polled, setPolled] = useState<Participant[]>([])
  const [approveEach, setApproveEach] = useState(true)
  const [localApisOnly, setLocalApisOnly] = useState(true)
  const [busy, setBusy] = useState<'share' | 'stop' | 'settings' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const apply = useCallback((res: StatusResult) => {
    if (!res.ok) return setLoad({ kind: 'unavailable', message: res.message })
    const st = res.status
    setSession(st.session)
    setPolled(st.participants)
    if (st.session) {
      setApproveEach(!st.session.autoApprove)
      setLocalApisOnly(!st.session.shareRemoteApis)
    }
    setLoad({ kind: 'ready' })
  }, [])
  const refresh = useCallback(() => fetchStatus().then(apply), [apply])

  // Estado inicial y, mientras se comparte, sondeo ligero de participantes (por si el WebSocket aún no los trae).
  useEffect(() => {
    if (!isLoopbackOrigin()) return
    let alive = true
    void fetchStatus().then((r) => alive && apply(r))
    return () => {
      alive = false
    }
  }, [apply])
  useEffect(() => {
    if (!session) return
    const t = setInterval(() => void fetchStatus().then(apply), POLL_MS)
    return () => clearInterval(t)
  }, [session, apply])

  const connectedAsHost = isHost && status !== 'idle'
  const participants = connectedAsHost && storeParticipants.length ? storeParticipants : polled
  const agentsActive = participants.some((p) => p.kind === 'agent' && p.status === 'active')

  const share = async () => {
    setBusy('share')
    setError(null)
    try {
      // Con una sesión local de agentes abierta, el servidor la amplía a la red sin cortar a nadie.
      const s = await collabApi.share({
        network: 'lan',
        projectName,
        hostName: hostDisplayName(),
        autoApprove: !approveEach,
        shareRemoteApis: !localApisOnly,
      })
      setSession(s)
      void refresh()
      try {
        if (!joinedTo(s.id)) await joinAsHost(s)
      } catch (err) {
        setError(`La sesión está abierta, pero esta ventana no pudo conectarse: ${err instanceof Error ? err.message : 'error desconocido'}.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo empezar a compartir.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Con la sesión abierta, repetir POST /share con el mismo proyecto actualiza los ajustes en caliente
   * (activar la aprobación automática además acepta a los pendientes). Sin sesión solo cambia el formulario.
   */
  const changeSetting = async (patch: { approveEach?: boolean; localApisOnly?: boolean }) => {
    const prev = { approveEach, localApisOnly }
    const next = { ...prev, ...patch }
    setApproveEach(next.approveEach)
    setLocalApisOnly(next.localApisOnly)
    if (!session) return
    setBusy('settings')
    setError(null)
    try {
      const s = await collabApi.share({
        // Sin `network` el servidor entiende 'lan': una sesión local de agentes se abriría a la red.
        network: session.network ?? 'lan',
        projectName: session.projectName,
        hostName: session.hostName,
        port: session.network === 'local' ? undefined : session.port,
        autoApprove: !next.approveEach,
        shareRemoteApis: !next.localApisOnly,
      })
      setSession(s)
      void refresh()
    } catch (err) {
      setApproveEach(prev.approveEach)
      setLocalApisOnly(prev.localApisOnly)
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la opción.')
    } finally {
      setBusy(null)
    }
  }

  const stop = async () => {
    setBusy('stop')
    setError(null)
    try {
      // Con agentes conectados se cierra solo la red: la sesión sigue en este equipo para ellos.
      if (session && agentsActive) {
        setSession(await collabApi.share({ network: 'local', projectName: session.projectName, hostName: session.hostName }))
        void refresh()
        toast('Ya no compartes en la red', { description: 'Los agentes de Claude Code siguen conectados en este equipo.' })
        return
      }
      await stopSharing()
      setSession(null)
      setPolled([])
      toast('Has dejado de compartir el proyecto')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo dejar de compartir.')
    } finally {
      setBusy(null)
    }
  }

  const onAction = async (id: string, action: ParticipantAction) => {
    setBusyId(id)
    try {
      await collabApi.participant(id, action)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo completar la acción.')
    } finally {
      setBusyId(null)
    }
  }

  const copyLink = async () => {
    if (!session) return
    if (await copyText(session.joinUrl)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else toast.error('No se pudo copiar. Selecciona el enlace y cópialo a mano.')
  }

  // Una sesión 'local' (solo agentes MCP en este equipo) no cuenta como compartir en la red.
  const sharing = session !== null && session.network !== 'local'

  return (
    <>
      <DialogHeader>
        <DialogTitle>Compartir sesión</DialogTitle>
        <DialogDescription>Otras personas de tu red local podrán ver y editar «{projectName}» en tiempo real.</DialogDescription>
      </DialogHeader>

      {load.kind === 'loading' && <p className="py-6 text-sm text-muted-foreground">Comprobando el servidor…</p>}

      {load.kind === 'unavailable' && (
        <div className="space-y-1 py-2" role="status">
          <p className="text-sm font-medium">La colaboración en red no está disponible</p>
          <p className="text-sm text-muted-foreground">{load.message}</p>
        </div>
      )}

      {load.kind === 'ready' && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="collab-host-name" className="text-xs text-muted-foreground">
              Tu nombre
            </Label>
            <Input
              id="collab-host-name"
              value={name}
              placeholder="Anfitrión"
              maxLength={40}
              disabled={sharing}
              onChange={(e) => setName(e.target.value)}
              className="max-sm:h-11"
            />
          </div>

          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Compartir en la red local</span>
              <span className="block text-xs text-muted-foreground">
                {sharing
                  ? 'Escuchando en la red. Cualquiera con el código o el enlace puede pedir entrada.'
                  : session
                    ? 'Ahora solo hay una sesión local para agentes. Compartir la abre también a tu red, sin cortar a nadie.'
                    : 'Abre este proyecto a los equipos de tu red.'}
              </span>
            </span>
            <Switch
              checked={sharing}
              disabled={busy !== null}
              onCheckedChange={(on) => void (on ? share() : stop())}
              aria-label="Compartir en la red local"
              className="mt-0.5"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {sharing && session && (
            <div className="space-y-4 animate-in fade-in duration-200 motion-reduce:animate-none">
              <Separator />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="text-xs text-muted-foreground">Código</div>
                  <div className="font-mono text-3xl font-semibold tracking-[0.2em] select-all" aria-label={`Código ${session.code.split('').join(' ')}`}>
                    {fmtCode(session.code)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Dirección{' '}
                    {session.addresses.length ? (
                      session.addresses.map((a, i) => (
                        <span key={a} className="font-mono text-foreground">
                          {i > 0 && ', '}
                          {a}:{session.port}
                        </span>
                      ))
                    ) : (
                      <span>sin red local detectada</span>
                    )}
                  </div>
                </div>
                {session.qrSvg && (
                  <div
                    role="img"
                    aria-label="Código QR del enlace para unirse"
                    className="size-28 shrink-0 rounded-md bg-white p-1.5 [&>svg]:size-full"
                    // El SVG lo genera nuestro propio servidor (qrcode) a partir de joinUrl.
                    dangerouslySetInnerHTML={{ __html: session.qrSvg }}
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="collab-join-url" className="text-xs text-muted-foreground">
                  Enlace
                </Label>
                <div className="flex gap-2">
                  <Input id="collab-join-url" readOnly value={session.joinUrl} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs max-sm:h-11" />
                  <Button variant="outline" onClick={() => void copyLink()} className="max-sm:h-11">
                    {copied ? <Check /> : <Copy />}
                    {copied ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400">La conexión no está cifrada: compártela solo en redes de confianza.</p>
              </div>
            </div>
          )}

          <Separator />
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={approveEach}
                disabled={busy !== null}
                onCheckedChange={(v) => void changeSetting({ approveEach: v === true })}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm">Aprobar a cada invitado</span>
                <span className="block text-xs text-muted-foreground">
                  Tú decides quién entra. Con esta opción basta el código para pedir entrada; sin ella, hace falta el enlace o el QR.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={localApisOnly}
                disabled={busy !== null}
                onCheckedChange={(v) => void changeSetting({ localApisOnly: v === true })}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm">Las bases de datos remotas y GitHub siguen siendo solo de este equipo</span>
                <span className="block text-xs text-muted-foreground">Las contraseñas y el token nunca viajan por la sesión.</span>
              </span>
            </label>
            {sharing && <p className="text-xs text-muted-foreground">Los cambios se aplican al momento, sin cortar la sesión. Si quitas la aprobación, entra quien esté esperando.</p>}
          </div>

          {session && (
            <>
              <Separator />
              <ParticipantList participants={participants} meId={meId} canManage busyId={busyId} onAction={(id, a) => void onAction(id, a)} />
            </>
          )}
        </div>
      )}

      <DialogFooter className="sm:justify-between">
        {sharing ? (
          <Button variant="destructive" disabled={busy !== null} onClick={() => void stop()} className="max-sm:h-11">
            {busy === 'stop' ? 'Cerrando…' : 'Dejar de compartir'}
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Button onClick={onClose} className="max-sm:h-11">
          Listo
        </Button>
      </DialogFooter>
    </>
  )
}
