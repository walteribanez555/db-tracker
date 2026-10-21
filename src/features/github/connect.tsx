import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { githubApi, GithubApiError } from './api'
import type { DeviceStartResponse, GithubMe } from './types'

const CLASSIC_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=DB%20Tracker'
const FINE_GRAINED_URL = 'https://github.com/settings/personal-access-tokens/new'

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-brand">
    {children}
  </a>
)

export function ConnectSection({ deviceFlowAvailable, onConnected }: { deviceFlowAvailable: boolean; onConnected: (me: GithubMe) => void }) {
  return (
    <CollapsibleSection title="Conectar con GitHub" storageKey="github:connect" className="py-4" contentClassName="pt-3">
      <p className="max-w-2xl text-sm text-muted-foreground">
        La conexión dura solo esta sesión: el token se guarda en la memoria del servidor local (el navegador solo recibe una cookie
        httpOnly), nunca en el navegador ni en los logs, y se descarta al desconectar o reiniciar el servidor.
      </p>

      <Tabs defaultValue="pat" className="mt-4">
        <TabsList className="max-md:w-full max-md:group-data-horizontal/tabs:h-11">
          <TabsTrigger value="pat">Token personal</TabsTrigger>
          <TabsTrigger value="device">Inicio con dispositivo</TabsTrigger>
        </TabsList>
        <TabsContent value="pat" className="pt-4 animate-in fade-in duration-200">
          <PatForm onConnected={onConnected} />
        </TabsContent>
        <TabsContent value="device" className="pt-4 animate-in fade-in duration-200">
          {deviceFlowAvailable ? (
            <DeviceFlow onConnected={onConnected} />
          ) : (
            <p className="max-w-2xl text-sm text-muted-foreground">
              No está configurado. Crea una OAuth App en GitHub con <em>Device Flow</em> activado y arranca el servidor con{' '}
              <code className="font-mono text-foreground">GITHUB_CLIENT_ID=&lt;client id&gt; npm run dev:api</code>.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </CollapsibleSection>
  )
}

function PatForm({ onConnected }: { onConnected: (me: GithubMe) => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    setBusy(true)
    setError(null)
    try {
      const me = await githubApi.connectToken(token.trim())
      setToken('')
      onConnected(me)
    } catch (err) {
      setError(err instanceof GithubApiError ? err.message : 'No se pudo validar el token.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_minmax(0,22rem)]">
      <ol className="list-decimal space-y-3 pl-5 text-sm text-muted-foreground">
        <li>
          <span className="text-foreground">Token classic:</span> crea uno en <A href={CLASSIC_URL}>github.com/settings/tokens</A> con el
          scope <code className="font-mono text-foreground">repo</code> (necesario para crear repositorios privados y escribir commits).
        </li>
        <li>
          <span className="text-foreground">Token fine-grained:</span> en <A href={FINE_GRAINED_URL}>Fine-grained tokens</A>, da acceso a
          todos tus repositorios (o a los que vayas a usar) con permisos <em>Contents: Read and write</em>, <em>Metadata: Read</em> y, para
          crear repositorios, <em>Administration: Read and write</em>.
        </li>
        <li>Pega el token aquí. Se valida contra la API de GitHub antes de guardarlo.</li>
      </ol>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="gh-token">Personal Access Token</Label>
          <Input className="max-md:h-11"
            id="gh-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_… o github_pat_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={!!error}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="max-md:h-11" type="submit" disabled={busy || !token.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          Conectar
        </Button>
      </form>
    </div>
  )
}

type DeviceState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; info: DeviceStartResponse }
  | { phase: 'error'; message: string }

function DeviceFlow({ onConnected }: { onConnected: (me: GithubMe) => void }) {
  const [state, setState] = useState<DeviceState>({ phase: 'idle' })
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const start = async () => {
    window.clearTimeout(timer.current)
    setState({ phase: 'starting' })
    try {
      const info = await githubApi.deviceStart()
      setState({ phase: 'waiting', info })
      schedule(info.interval)
    } catch (err) {
      setState({ phase: 'error', message: err instanceof GithubApiError ? err.message : 'No se pudo iniciar.' })
    }
  }

  const schedule = (seconds: number) => {
    timer.current = window.setTimeout(poll, Math.max(seconds, 5) * 1000)
  }

  const poll = async () => {
    try {
      const r = await githubApi.devicePoll()
      if (r.status === 'pending' || r.status === 'slow_down') schedule(r.interval)
      else if (r.status === 'complete') onConnected(r.me)
      else if (r.status === 'expired' || r.status === 'denied') setState({ phase: 'error', message: r.message })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof GithubApiError ? err.message : 'Error al consultar GitHub.' })
    }
  }

  if (state.phase === 'waiting') {
    const { info } = state
    return (
      <div className="max-w-xl space-y-4 text-sm">
        <p className="text-muted-foreground">
          Abre <A href={info.verificationUri}>{info.verificationUri.replace(/^https:\/\//, '')}</A> e introduce este código:
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-3xl font-semibold tracking-[0.2em]">{info.userCode}</span>
          <Button
            className="max-md:size-11"
            variant="ghost"
            size="icon-sm"
            aria-label="Copiar código"
            onClick={() => {
              void navigator.clipboard?.writeText(info.userCode)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <Button className="max-md:h-11" asChild variant="outline" size="sm">
            <a href={info.verificationUri} target="_blank" rel="noreferrer">
              Abrir GitHub <ExternalLink />
            </a>
          </Button>
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Esperando autorización…
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-3 text-sm">
      <p className="text-muted-foreground">
        GitHub te mostrará una pantalla de autorización para DB Tracker con acceso <code className="font-mono text-foreground">repo</code>.
        No hace falta copiar ningún token.
      </p>
      {state.phase === 'error' && <p className="text-destructive">{state.message}</p>}
      <Button className="max-md:h-11" onClick={start} disabled={state.phase === 'starting'}>
        {state.phase === 'starting' && <Loader2 className="animate-spin" />}
        {state.phase === 'error' ? 'Generar otro código' : 'Obtener código'}
      </Button>
    </div>
  )
}
