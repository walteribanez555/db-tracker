// "Conectar agentes": permite que Claude Code trabaje en este proyecto por MCP (docs/arquitectura/agentes-mcp.md).
import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useCollabStore, type Participant, type ParticipantAction } from '@/collab'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { agentes, useAgents, type AgentView } from '../agents'
import { CollabApiError, collabApi, mcpApi, type CollabStatus, type McpInfo } from '../api'
import { copyText } from '../lib/clipboard'
import { enableAgents, setAgentApproval, stopSharing, type HostSessionInfo } from '../lib/host'
import { isLoopbackOrigin } from '../lib/identity'
import { PeerAvatar } from './Avatars'
import { CopyBlock } from './CopyBlock'

const POLL_MS = 2500
const DEFAULT_MCP_URL = 'http://127.0.0.1:8787/mcp'
const REPO_PLACEHOLDER = '/ruta/a/db-tracker'


type Load = { kind: 'loading' } | { kind: 'unavailable'; message: string } | { kind: 'ready' }

export function AgentsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* En móvil, a pantalla completa (la variante la aporta DialogContent). */}
      <DialogContent mobileLayout="fullscreen" className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        {open && <AgentsBody onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

const unavailableMessage = (err: unknown) =>
  err instanceof CollabApiError && (err.code === 'unavailable' || err.status === 404)
    ? 'Este servidor aún no expone MCP. Actualiza DB Tracker o, en desarrollo, reinicia la API con npm run dev:api.'
    : 'No se pudo contactar con el servidor local. Comprueba que la API está en marcha (npm run dev:api).'

function AgentsBody({ onClose }: { onClose: () => void }) {
  const isHost = useCollabStore((s) => s.isHost)
  const status = useCollabStore((s) => s.status)
  const storeParticipants = useCollabStore((s) => s.participants)

  const [load, setLoad] = useState<Load>(() =>
    isLoopbackOrigin() ? { kind: 'loading' } : { kind: 'unavailable', message: 'Los agentes solo se conectan desde el equipo que tiene el proyecto.' },
  )
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [session, setSession] = useState<HostSessionInfo | null>(null)
  const [polled, setPolled] = useState<Participant[]>([])
  const [approveEach, setApproveEach] = useState(false)
  const [busy, setBusy] = useState<'toggle' | 'approval' | 'rotate' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Un solo estado de token para la conexión y las instrucciones (Mostrar afecta a ambas).
  const tk = useToken(info)

  const applyStatus = useCallback((st: CollabStatus) => {
    const s = st.session as HostSessionInfo | null
    setSession(s)
    setPolled(st.participants)
    if (s && typeof s.autoApproveAgents === 'boolean') setApproveEach(!s.autoApproveAgents)
  }, [])
  const refreshStatus = useCallback(() => collabApi.status().then(applyStatus), [applyStatus])

  useEffect(() => {
    if (!isLoopbackOrigin()) return
    let alive = true
    Promise.all([mcpApi.info(), collabApi.status()])
      .then(([i, st]) => {
        if (!alive) return
        applyStatus(st)
        setInfo(i)
        setLoad({ kind: 'ready' })
      })
      .catch((err: unknown) => alive && setLoad({ kind: 'unavailable', message: unavailableMessage(err) }))
    return () => {
      alive = false
    }
  }, [applyStatus])

  // Mientras hay sesión, sondeo ligero (agentes que entran o piden aprobación aunque esta ventana no esté unida).
  useEffect(() => {
    if (!session) return
    const t = setInterval(() => void refreshStatus().catch(() => undefined), POLL_MS)
    return () => clearInterval(t)
  }, [session, refreshStatus])

  const connectedAsHost = isHost && status !== 'idle'
  const participants = connectedAsHost && storeParticipants.length ? storeParticipants : polled
  const agents = useAgents(participants)
  const enabled = session !== null
  const lan = session?.network !== undefined ? session.network === 'lan' : session !== null

  const toggle = async (on: boolean) => {
    setBusy('toggle')
    setError(null)
    try {
      if (on) {
        const s = await enableAgents({ approveEach })
        setSession(s)
        void refreshStatus().catch(() => undefined)
      } else {
        await stopSharing()
        setSession(null)
        setPolled([])
        toast('Los agentes ya no pueden conectarse')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la opción.')
      void refreshStatus().catch(() => undefined)
    } finally {
      setBusy(null)
    }
  }

  const changeApproval = async (next: boolean) => {
    const prev = approveEach
    setApproveEach(next)
    if (!session) return
    setBusy('approval')
    setError(null)
    try {
      setSession(await setAgentApproval(session, next))
    } catch (err) {
      setApproveEach(prev)
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la opción.')
    } finally {
      setBusy(null)
    }
  }

  const onAction = async (id: string, action: ParticipantAction) => {
    setBusyId(id)
    try {
      await collabApi.participant(id, action)
      await refreshStatus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo completar la acción.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Conectar agentes</DialogTitle>
        <DialogDescription>
          Claude Code trabaja en este proyecto por MCP. Cada agente aparece como un participante más: ves lo que edita, en qué rama y qué hace.
        </DialogDescription>
      </DialogHeader>

      {load.kind === 'loading' && <p className="py-6 text-sm text-muted-foreground">Comprobando el servidor…</p>}

      {load.kind === 'unavailable' && (
        <div className="space-y-1 py-2" role="status">
          <p className="text-sm font-medium">Los agentes no están disponibles</p>
          <p className="text-sm text-muted-foreground">{load.message}</p>
        </div>
      )}

      {load.kind === 'ready' && info && (
        <div className="min-w-0 space-y-4 animate-in fade-in duration-200 motion-reduce:animate-none">
          {info.simulated && import.meta.env.DEV && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Desarrollo: respuestas simuladas, el servidor aún no expone /api/mcp. El token y la URL no son reales.
            </p>
          )}

          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Permitir agentes de Claude Code</span>
              <span className="block text-xs text-muted-foreground">
                {!enabled
                  ? 'Abre una sesión solo en este equipo, sin red. Esta ventana es la anfitriona.'
                  : lan
                    ? 'Los agentes usan la sesión que ya compartes en la red. Para cerrarla, deja de compartir.'
                    : 'Sesión local activa: solo este equipo. No se expone nada en la red.'}
              </span>
            </span>
            <Switch
              checked={enabled}
              disabled={busy !== null || (enabled && lan)}
              onCheckedChange={(on) => void toggle(on)}
              aria-label="Permitir agentes de Claude Code"
              className="mt-0.5"
            />
          </label>

          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox checked={approveEach} disabled={busy !== null} onCheckedChange={(v) => void changeApproval(v === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm">Aprobar cada agente nuevo</span>
              <span className="block text-xs text-muted-foreground">Cada nombre de agente que se conecte por primera vez espera tu aprobación aquí.</span>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Separator />
          <Connection info={info} tk={tk} onInfo={setInfo} busy={busy === 'rotate'} setBusy={(b) => setBusy(b ? 'rotate' : null)} />

          <Separator />
          <Instructions info={info} tk={tk} />

          <Separator />
          <AgentList agents={agents} enabled={enabled} busyId={busyId} onAction={(id, a) => void onAction(id, a)} />
        </div>
      )}

      <DialogFooter>
        <Button onClick={onClose} className="max-sm:h-11">
          Listo
        </Button>
      </DialogFooter>
    </>
  )
}

/* ───────────────────────── URL y token ───────────────────────── */

const mask = (hint: string) => `${'•'.repeat(12)}${hint.replace(/^[.…]+/, '')}`

/** Token completo bajo demanda (no se pide hasta Mostrar o Copiar). */
function useToken(info: McpInfo | null) {
  const [fetched, setFetched] = useState<{ for: McpInfo | null; token: string } | null>(null)
  const [revealed, setRevealed] = useState(false)
  // Tras regenerar llega otro `info`: el token pedido para el anterior deja de valer.
  const token = info?.token ?? (fetched && fetched.for === info ? fetched.token : null)
  const get = useCallback(async () => {
    if (token) return token
    const t = await mcpApi.token(info)
    if (t) setFetched({ for: info, token: t })
    else toast.error('El servidor no entrega el token completo a esta ventana.')
    return t
  }, [token, info])
  const shown = revealed && token ? token : mask(info?.tokenHint || '')
  return { get, shown, revealed, setRevealed, token }
}

type TokenApi = ReturnType<typeof useToken>

function Connection({
  info,
  tk,
  onInfo,
  busy,
  setBusy,
}: {
  info: McpInfo
  tk: TokenApi
  onInfo: (i: McpInfo) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const [confirming, setConfirming] = useState(false)

  const reveal = async () => {
    if (tk.revealed) return tk.setRevealed(false)
    if (await tk.get()) tk.setRevealed(true)
  }
  const copyToken = async () => {
    const t = await tk.get()
    if (t && (await copyText(t))) toast('Token copiado')
  }
  const rotate = async () => {
    setBusy(true)
    try {
      const r = await mcpApi.rotate(info.simulated)
      const next = await mcpApi.info().catch(() => ({ ...info, token: r.token, tokenHint: r.tokenHint ?? info.tokenHint }))
      onInfo({ ...next, token: next.token ?? r.token })
      setConfirming(false)
      tk.setRevealed(false)
      toast.success('Token regenerado', { description: 'Actualízalo en Claude Code: los agentes con el anterior ya no pueden conectarse.' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo regenerar el token.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Conexión MCP" className="min-w-0 space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">URL MCP</Label>
        <CopyBlock display={info.mcpUrl} value={info.mcpUrl} label="URL MCP" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Token</Label>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2">
          <code
            className={cn('min-w-0 flex-1 truncate font-mono text-xs max-sm:basis-full', !tk.revealed && 'tracking-wider text-muted-foreground')}
            aria-label={tk.revealed ? 'Token' : 'Token oculto'}
          >
            {tk.shown}
          </code>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={() => void reveal()}>
              {tk.revealed ? <EyeOff /> : <Eye />}
              {tk.revealed ? 'Ocultar' : 'Mostrar'}
            </Button>
            <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={() => void copyToken()}>
              Copiar
            </Button>
            <Button variant="ghost" size="sm" className="max-sm:h-11" disabled={busy || confirming} onClick={() => setConfirming(true)}>
              <RefreshCw />
              Regenerar
            </Button>
          </div>
        </div>
        {confirming && (
          <div role="alertdialog" aria-label="Confirmar regenerar token" className="flex flex-wrap items-center justify-between gap-2 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              Los agentes conectados con el token actual dejarán de funcionar hasta que configures el nuevo.
            </p>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" className="max-sm:h-11" disabled={busy} onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" size="sm" className="max-sm:h-11" disabled={busy} onClick={() => void rotate()}>
                {busy ? 'Regenerando…' : 'Regenerar token'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/* ───────────────────────── Instrucciones ───────────────────────── */

const SUBAGENTS: { name: string; does: string }[] = [
  { name: 'dbt-normalizador', does: 'lleva un flujo de 1FN a BCNF con los pasos de copia de datos' },
  { name: 'dbt-rendimiento', does: 'propone índices y mide consultas si hay conexión a una BD' },
  { name: 'dbt-triggers', does: 'revisa triggers y funciones (ciclos, efectos, orden)' },
  { name: 'dbt-revisor', does: 'revisa de forma adversarial lo que hicieron los demás' },
  { name: 'dbt-documentador', does: 'documenta las decisiones y el resultado de cada flujo' },
]

function Instructions({ info, tk }: { info: McpInfo; tk: TokenApi }) {
  const visible = tk.revealed && tk.token ? tk.token : '<token>'
  const [repoDir, setRepoDir] = useState(info.repoDir ?? '')
  const repo = (info.repoDir || repoDir.trim() || REPO_PLACEHOLDER).replace(/\/+$/, '')

  // Lo que se ve lleva el token oculto; lo que se copia, el real (se pide al pulsar).
  const withToken = (render: (token: string) => string) => ({
    display: render(visible),
    value: async () => {
      const t = await tk.get()
      return t ? render(t) : null
    },
  })

  const cli = (scope: boolean) =>
    withToken((t) => `claude mcp add --transport http${scope ? ' --scope user' : ''} dbtracker ${info.mcpUrl} --header "Authorization: Bearer ${t}"`)
  const mcpJson = JSON.stringify(
    { mcpServers: { dbtracker: { type: 'http', url: '${DBTRACKER_MCP_URL:-http://127.0.0.1:8787/mcp}', headers: { Authorization: 'Bearer ${DBTRACKER_MCP_TOKEN}' } } } },
    null,
    2,
  )
  const env = withToken((t) =>
    [`export DBTRACKER_MCP_TOKEN=${t}`, ...(info.mcpUrl !== DEFAULT_MCP_URL ? [`export DBTRACKER_MCP_URL=${info.mcpUrl}`] : []), `cd ${repo}`, 'claude'].join('\n'),
  )
  const desktop = JSON.stringify({ mcpServers: { dbtracker: { command: 'node', args: [`${repo}/dist-mcp/stdio.mjs`] } } }, null, 2)
  const workflow = `/dbtracker-flujos "normalizar y auditar pedidos"`

  const note = 'text-xs text-muted-foreground'
  const code = 'rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground'

  return (
    <section aria-label="Instrucciones" className="min-w-0 space-y-2">
      <h3 className="text-sm font-medium">Instrucciones</h3>
      {!tk.revealed && <p className="text-xs text-muted-foreground">Al copiar, los bloques llevan tu token real aunque aquí se vea &lt;token&gt;.</p>}
      <Tabs defaultValue="cli" className="min-w-0">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto max-sm:h-11">
          <TabsTrigger value="cli" className="flex-none max-sm:h-11">
            <span className="sm:hidden">CLI</span>
            <span className="max-sm:hidden">Claude Code</span>
          </TabsTrigger>
          <TabsTrigger value="project" className="flex-none max-sm:h-11">
            Proyecto
          </TabsTrigger>
          <TabsTrigger value="desktop" className="flex-none max-sm:h-11">
            <span className="sm:hidden">Desktop</span>
            <span className="max-sm:hidden">Claude Desktop</span>
          </TabsTrigger>
          <TabsTrigger value="workflow" className="flex-none max-sm:h-11">
            Workflow
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cli" className="min-w-0 space-y-2 pt-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          <p className={note}>Registra DB Tracker en Claude Code (CLI) para este proyecto:</p>
          <CopyBlock {...cli(false)} label="comando claude mcp add" />
          <p className={note}>O para todos tus proyectos:</p>
          <CopyBlock {...cli(true)} label="comando claude mcp add con --scope user" />
          <p className={note}>
            Compruébalo con <span className={code}>/mcp</span> dentro de Claude Code. Las herramientas se llaman{' '}
            <span className={code}>mcp__dbtracker__&lt;herramienta&gt;</span>, p. ej. <span className={code}>mcp__dbtracker__edit_schema</span>.
          </p>
        </TabsContent>

        <TabsContent value="project" className="min-w-0 space-y-2 pt-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          <p className={note}>
            El repositorio ya trae <span className={code}>.mcp.json</span>, que lee el token de una variable de entorno:
          </p>
          <CopyBlock display={mcpJson} value={mcpJson} label=".mcp.json" />
          <p className={note}>Exporta el token y abre Claude Code en la carpeta del repo:</p>
          <CopyBlock {...env} label="variables de entorno y arranque de Claude Code" />
          <p className={note}>La primera vez, Claude Code te pide aprobar el servidor del proyecto.</p>
        </TabsContent>

        <TabsContent value="desktop" className="min-w-0 space-y-2 pt-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          <p className={note}>
            Claude Desktop se conecta con el puente stdio. Añádelo a <span className={code}>claude_desktop_config.json</span> (macOS:{' '}
            <span className={code}>~/Library/Application Support/Claude/</span>) y reinicia Claude Desktop.
          </p>
          {!info.repoDir && (
            <div className="space-y-1.5">
              <Label htmlFor="mcp-repo-dir" className="text-xs text-muted-foreground">
                Carpeta del repositorio de DB Tracker
              </Label>
              <Input
                id="mcp-repo-dir"
                value={repoDir}
                placeholder={REPO_PLACEHOLDER}
                onChange={(e) => setRepoDir(e.target.value)}
                className="font-mono text-xs max-sm:h-11"
              />
            </div>
          )}
          <CopyBlock display={desktop} value={desktop} label="claude_desktop_config.json" />
          {import.meta.env.DEV && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              TODO (solo desarrollo): confirmar con server/mcp cómo se genera dist-mcp/stdio.mjs (¿npm run build?) y si el puente lee el token de
              &lt;dataDir&gt;/mcp-token o necesita DBTRACKER_MCP_TOKEN en env.
            </p>
          )}
        </TabsContent>

        <TabsContent value="workflow" className="min-w-0 space-y-2 pt-2 animate-in fade-in duration-200 motion-reduce:animate-none">
          <p className={note}>Con DB Tracker registrado, abre Claude Code en la carpeta del repo y lanza el workflow multiagente:</p>
          <CopyBlock display={workflow} value={workflow} label="comando del workflow" />
          <p className={note}>
            El coordinador explora el proyecto, lanza un agente por flujo en paralelo (cada uno en su rama, visible aquí), mide si hay conexión, revisa
            de forma adversarial y compara los flujos para recomendar uno.
          </p>
          <p className={note}>
            Subagentes en <span className={code}>.claude/agents/</span>; puedes pedir uno directamente («usa dbt-revisor para revisar flujo/3fn»):
          </p>
          <ul className="divide-y text-xs">
            {SUBAGENTS.map((a) => (
              <li key={a.name} className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3">
                <span className="w-36 shrink-0 font-mono">{a.name}</span>
                <span className="text-muted-foreground">{a.does}</span>
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </section>
  )
}

/* ───────────────────────── Agentes conectados ───────────────────────── */

function AgentList({
  agents,
  enabled,
  busyId,
  onAction,
}: {
  agents: AgentView[]
  enabled: boolean
  busyId: string | null
  onAction: (id: string, action: ParticipantAction) => void
}) {
  const active = agents.filter((a) => a.participant.status === 'active').length
  return (
    <section aria-label="Agentes conectados" className="space-y-1">
      <h3 className="text-sm font-medium">
        Agentes conectados <span className="font-normal text-muted-foreground tabular-nums">· {active}</span>
      </h3>
      {agents.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">
          {enabled
            ? 'Todavía no hay ninguno. Cuando un agente use una herramienta de DB Tracker, aparecerá aquí.'
            : 'Activa «Permitir agentes» y configura Claude Code con las instrucciones de arriba.'}
        </p>
      ) : (
        <ul className="divide-y">
          {agents.map((a) => (
            <AgentRow key={a.participant.id} agent={a} busy={busyId === a.participant.id} onAction={onAction} />
          ))}
        </ul>
      )}
      {agents.length > 0 && <p className="sr-only">{agentes(agents.length)}</p>}
    </section>
  )
}

function AgentRow({ agent, busy, onAction }: { agent: AgentView; busy: boolean; onAction: (id: string, action: ParticipantAction) => void }) {
  const p = agent.participant
  const pending = p.status === 'pending'
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 animate-in fade-in duration-200 motion-reduce:animate-none">
      <PeerAvatar name={p.name} color={p.color} kind="agent" className="size-7" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{p.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {pending ? (
            <span className="text-amber-700 dark:text-amber-400">Esperando aprobación</span>
          ) : (
            <span className={agent.status ? 'text-foreground/80' : undefined}>{agent.status ?? 'inactivo'}</span>
          )}
          {agent.branch && (
            <>
              {' · '}
              <span className="font-mono">{agent.branch}</span>
            </>
          )}
        </div>
      </div>
      <div className={cn('flex shrink-0 gap-1.5', pending && 'max-sm:w-full max-sm:justify-end')}>
        {pending ? (
          <>
            <Button variant="ghost" size="sm" className="max-sm:h-11" disabled={busy} onClick={() => onAction(p.id, { action: 'reject' })}>
              Rechazar
            </Button>
            <Button size="sm" className="max-sm:h-11" disabled={busy} onClick={() => onAction(p.id, { action: 'approve' })}>
              Aprobar
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive max-sm:h-11"
            disabled={busy}
            onClick={() => onAction(p.id, { action: 'kick' })}
          >
            Expulsar
          </Button>
        )}
      </div>
    </li>
  )
}
