import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { leaveSession, useCollabStore, type DiscoveredSession } from '@/collab'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

import { CollabApiError, collabApi, normalizeBaseUrl, parseJoinLink } from '../api'
import { useCollabPrefs } from '../lib/identity'
import { isValidCode, joinFlow, JoinError, normalizeCode } from '../lib/join'
import { CodeInput } from './CodeInput'
import { JoinStatus } from './JoinStatus'

type Discover = { kind: 'searching' } | { kind: 'done'; list: DiscoveredSession[] } | { kind: 'unavailable'; message: string }

export function JoinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">{open && <JoinBody onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

async function loadDiscover(): Promise<Discover> {
  try {
    return { kind: 'done', list: await collabApi.discover() }
  } catch (err) {
    return {
      kind: 'unavailable',
      message:
        err instanceof CollabApiError && err.code === 'unavailable'
          ? 'La búsqueda en la red solo funciona en la app de escritorio. Escribe la dirección y el código.'
          : 'No se pudo buscar en la red. Escribe la dirección y el código.',
    }
  }
}

const plural = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`

function JoinBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const savedName = useCollabPrefs((s) => s.name)
  const setSavedName = useCollabPrefs((s) => s.setName)
  const status = useCollabStore((s) => s.status)
  const storeError = useCollabStore((s) => s.error)
  const [discover, setDiscover] = useState<Discover>({ kind: 'searching' })
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [name, setName] = useState(savedName)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'form' | 'joining' | 'waiting'>('form')
  const [hostName, setHostName] = useState('el anfitrión')
  const codeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void loadDiscover().then((d) => alive && setDiscover(d))
    return () => {
      alive = false
    }
  }, [])
  const search = () => {
    setDiscover({ kind: 'searching' })
    void loadDiscover().then(setDiscover)
  }

  // Ya dentro: cerrar y abrir el diagrama.
  useEffect(() => {
    if (phase === 'waiting' && status === 'connected') {
      onClose()
      navigate('/editor')
    }
  }, [phase, status, onClose, navigate])

  // Pegar un enlace completo en "Dirección" rellena código y secreto.
  const onAddress = (v: string) => {
    setAddress(v)
    if (/\/unirse\?/.test(v)) {
      const link = parseJoinLink(v)
      if (link) {
        setAddress(link.baseUrl.replace(/^https?:\/\//, ''))
        if (link.code) setCode(normalizeCode(link.code))
        setSecret(link.secret)
      }
    }
  }

  const pick = (s: DiscoveredSession) => {
    setAddress(`${s.address}:${s.port}`)
    setSecret(null)
    setError(null)
    setHostName(s.hostName)
    // El anuncio mDNS no lleva el código: hay que pedírselo al anfitrión.
    requestAnimationFrame(() => codeRef.current?.querySelector('input')?.focus())
  }

  const canJoin = address.trim().length > 0 && isValidCode(code) && name.trim().length > 0 && phase === 'form'

  const join = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canJoin) return
    setError(null)
    setPhase('joining')
    setSavedName(name.trim())
    try {
      const info = await joinFlow({ baseUrl: normalizeBaseUrl(address), code, secret, name: name.trim() })
      setHostName(info.hostName)
      const st = useCollabStore.getState().status
      if (st === 'connected') {
        toast(`Te uniste a ${info.projectName}`)
        onClose()
        navigate('/editor')
      } else setPhase('waiting')
    } catch (err) {
      setError(err instanceof JoinError || err instanceof Error ? err.message : 'No se pudo entrar.')
      setPhase('form')
    }
  }

  const cancel = async () => {
    await leaveSession({ keepCopy: false }).catch(() => undefined)
    setPhase('form')
  }

  if (phase === 'waiting')
    return (
      <>
        <DialogHeader>
          <DialogTitle>Unirse a una sesión</DialogTitle>
        </DialogHeader>
        <JoinStatus status={status} hostName={hostName} error={storeError} onCancel={() => void cancel()} onBack={() => void cancel()} />
      </>
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle>Unirse a una sesión</DialogTitle>
        <DialogDescription>Entra en un proyecto que alguien comparte en tu red local.</DialogDescription>
      </DialogHeader>

      <section aria-label="Sesiones en tu red" className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">
            En tu red{discover.kind === 'searching' && <span className="font-normal"> · buscando…</span>}
          </h3>
          <Button variant="ghost" size="icon-sm" aria-label="Buscar de nuevo" disabled={discover.kind === 'searching'} onClick={search}>
            <RefreshCw className={discover.kind === 'searching' ? 'animate-spin motion-reduce:animate-none' : ''} />
          </Button>
        </div>
        {discover.kind === 'unavailable' && <p className="text-xs text-muted-foreground">{discover.message}</p>}
        {discover.kind === 'done' && discover.list.length === 0 && (
          <p className="text-xs text-muted-foreground">No se encontró ninguna sesión. Comprueba que el anfitrión está compartiendo.</p>
        )}
        {discover.kind === 'done' && discover.list.length > 0 && (
          <ul className="divide-y">
            {discover.list.map((s) => (
              <li key={s.id} className="flex min-h-11 items-center gap-3 py-2 animate-in fade-in duration-200 motion-reduce:animate-none">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.projectName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.hostName} · {plural(s.participants)} · <span className="font-mono">{s.address}:{s.port}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => pick(s)}>
                  Unirse
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Separator />

      <form onSubmit={(e) => void join(e)} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="collab-address" className="text-xs text-muted-foreground">
            Dirección
          </Label>
          <Input
            id="collab-address"
            value={address}
            onChange={(e) => onAddress(e.target.value)}
            placeholder="192.168.1.24:47123 o el enlace completo"
            className="font-mono max-sm:h-11"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5" ref={codeRef}>
          <Label htmlFor="collab-code" className="text-xs text-muted-foreground">
            Código
          </Label>
          <CodeInput id="collab-code" value={code} onChange={setCode} />
          {secret ? (
            <p className="text-xs text-muted-foreground">Enlace con secreto detectado: entrarás sin escribir nada más.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Pídeselo al anfitrión. Si acepta invitados automáticamente, necesitarás su enlace.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="collab-name" className="text-xs text-muted-foreground">
            Tu nombre
          </Label>
          <Input id="collab-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Cómo te verán los demás" className="max-sm:h-11" />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} className="max-sm:h-11">
            Cancelar
          </Button>
          <Button type="submit" disabled={!canJoin} className="max-sm:h-11">
            {phase === 'joining' ? 'Conectando…' : 'Unirse'}
          </Button>
        </div>
      </form>
    </>
  )
}
