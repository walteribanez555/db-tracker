// Página /unirse?sala=CODE#s=SECRET: la abre el enlace o el QR del anfitrión en navegador o móvil.
import { Database, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { leaveSession, useCollabStore, type PublicSessionInfo } from '@/collab'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtRelative } from '@/features/versions/lib'

import { collabApi, secretFromHash } from '../api'
import { CodeInput } from '../components/CodeInput'
import { JoinStatus } from '../components/JoinStatus'
import { useCollabPrefs, type RecentSession } from '../lib/identity'
import { isValidCode, joinFlow, normalizeCode } from '../lib/join'

const plural = (n: number) => `${n} ${n === 1 ? 'persona conectada' : 'personas conectadas'}`


export function JoinPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [secret, setSecret] = useState<string | null>(() => secretFromHash(location.hash))
  // Quita el secreto de la barra de direcciones para que no quede a la vista ni en el historial.
  useEffect(() => {
    if (secretFromHash(location.hash)) history.replaceState(history.state, '', location.pathname + location.search)
  }, [])
  const [code, setCode] = useState(() => normalizeCode(params.get('sala') ?? ''))
  const savedName = useCollabPrefs((s) => s.name)
  const setSavedName = useCollabPrefs((s) => s.setName)
  const recent = useCollabPrefs((s) => s.recent)
  const removeRecent = useCollabPrefs((s) => s.removeRecent)
  const status = useCollabStore((s) => s.status)
  const storeError = useCollabStore((s) => s.error)
  const [name, setName] = useState(savedName)
  const [info, setInfo] = useState<PublicSessionInfo | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [phase, setPhase] = useState<'form' | 'joining' | 'waiting'>('form')
  const [error, setError] = useState<string | null>(null)

  // Vista previa de la sala (nombre del proyecto y anfitrión) en cuanto hay un código válido.
  useEffect(() => {
    if (!isValidCode(code)) return
    let alive = true
    collabApi
      .publicInfo(code, baseUrl)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null))
    return () => {
      alive = false
    }
  }, [code, baseUrl])

  // Dentro: al diagrama.
  useEffect(() => {
    if (status === 'connected' && phase !== 'form') navigate('/editor', { replace: true })
  }, [status, phase, navigate])

  const join = async (over?: { code: string; secret: string | null; baseUrl: string }) => {
    const c = over?.code ?? code
    const n = name.trim()
    if (!isValidCode(c) || !n) return
    setError(null)
    setPhase('joining')
    setSavedName(n)
    try {
      await joinFlow({ baseUrl: over?.baseUrl ?? baseUrl, code: c, secret: over ? over.secret : secret, name: n })
      if (useCollabStore.getState().status === 'connected') navigate('/editor', { replace: true })
      else setPhase('waiting')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar.')
      setPhase('form')
    }
  }

  const fromRecent = (r: RecentSession) => {
    setCode(r.code)
    setSecret(r.secret)
    setBaseUrl(r.baseUrl)
    if (name.trim()) void join({ code: r.code, secret: r.secret, baseUrl: r.baseUrl })
  }

  const cancel = async () => {
    await leaveSession({ keepCopy: false }).catch(() => undefined)
    setPhase('form')
  }

  const alreadyIn = phase === 'form' && (status === 'connected' || status === 'reconnecting')
  const canJoin = isValidCode(code) && name.trim().length > 0 && phase === 'form'

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="flex h-14 items-center gap-2 border-b px-4">
        <Database className="size-5" aria-hidden />
        <span className="font-semibold">DB Tracker</span>
        <ThemeToggle className="ml-auto size-11 sm:size-8" />
      </header>

      <main className="route-enter mx-auto w-full max-w-sm space-y-8 px-4 py-8 sm:py-12">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Unirse a una sesión</p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{info?.projectName ?? 'Proyecto compartido'}</h1>
          {info && (
            <p className="text-sm text-muted-foreground">
              Anfitrión: {info.hostName} · {plural(info.participants)}
            </p>
          )}
        </div>

        {alreadyIn ? (
          <div className="space-y-3">
            <p className="text-sm">Ya estás dentro de una sesión.</p>
            <Button className="h-11 w-full" onClick={() => navigate('/editor')}>
              Ir al diagrama
            </Button>
          </div>
        ) : phase === 'waiting' ? (
          <JoinStatus status={status} hostName={info?.hostName ?? 'el anfitrión'} error={storeError} onCancel={() => void cancel()} onBack={() => void cancel()} />
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault()
              void join()
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="join-name">Tu nombre</Label>
              <Input
                id="join-name"
                value={name}
                maxLength={40}
                autoComplete="nickname"
                autoFocus={!savedName}
                placeholder="Cómo te verán los demás"
                onChange={(e) => setName(e.target.value)}
                className="h-11 text-base"
              />
            </div>

            {!secret && (
              <div className="space-y-1.5">
                <Label htmlFor="join-code">Código</Label>
                <CodeInput id="join-code" value={code} onChange={setCode} autoFocus={!!savedName && !code} />
                <p className="text-xs text-muted-foreground">Los 6 caracteres que te dicta el anfitrión.</p>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={!canJoin} className="h-11 w-full text-base">
              {phase === 'joining' ? 'Conectando…' : 'Unirse'}
            </Button>
            {info?.needsApproval && <p className="text-center text-xs text-muted-foreground">El anfitrión tendrá que aceptarte.</p>}
          </form>
        )}

        {recent.length > 0 && phase === 'form' && (
          <section aria-label="Recientes" className="space-y-1">
            <h2 className="text-xs font-medium text-muted-foreground">Recientes</h2>
            <ul className="divide-y border-y">
              {recent.map((r) => (
                <li key={r.sessionId} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => fromRecent(r)}
                    className="flex min-h-14 min-w-0 flex-1 flex-col items-start justify-center py-2 text-left transition-colors hover:text-foreground"
                  >
                    <span className="w-full truncate text-sm font-medium">{r.projectName}</span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {r.hostName} · <span className="font-mono">{r.code}</span> · {fmtRelative(r.at)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Quitar ${r.projectName} de recientes`}
                    onClick={() => removeRecent(r.sessionId)}
                    className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-amber-700 dark:text-amber-400">La conexión no está cifrada: úsala solo en redes de confianza.</p>
      </main>
    </div>
  )
}
