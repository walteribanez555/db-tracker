// Formulario de conexión remota (PostgreSQL / MySQL). La contraseña solo vive en memoria o sessionStorage.
import { Loader2, PlugZap, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useProjectStore } from '@/store/project'
import type { RemoteConnection } from '@/types/schema'

import { dbApi, toPayload } from '../lib/api'
import { forgetPassword, getPassword, isRemembered, setPassword } from '../lib/passwords'
import { setConnectionStatus, useConnectionStatus } from '../lib/status'
import { RadioList } from './RadioList'
import { StatusLine } from './StatusDot'

const DEFAULT_PORT = { postgresql: 5432, mysql: 3306 } as const

/** Montar con `key={connection.id}`: el estado inicial se toma de `initial`. */
export function ConnectionForm({
  initial,
  isNew,
  onSaved,
  onDeleted,
}: {
  initial: RemoteConnection
  isNew: boolean
  onSaved: (c: RemoteConnection) => void
  onDeleted: () => void
}) {
  const upsertConnection = useProjectStore((s) => s.upsertConnection)
  const removeConnection = useProjectStore((s) => s.removeConnection)
  const [form, setForm] = useState<RemoteConnection>(initial)
  const [password, setPw] = useState(() => getPassword(initial.id) ?? '')
  const [remember, setRemember] = useState(() => isRemembered(initial.id))
  const status = useConnectionStatus(initial.id)
  const testing = status.state === 'testing'

  const set = <K extends keyof RemoteConnection>(k: K, v: RemoteConnection[K]) => setForm((f) => ({ ...f, [k]: v }))
  const valid = form.name.trim() && form.host.trim() && form.database.trim() && form.user.trim() && form.port > 0
  const dirty = isNew || JSON.stringify(form) !== JSON.stringify(initial)

  const storePassword = () => setPassword(form.id, password, remember)

  const save = () => {
    if (!valid) return
    const c = { ...form, name: form.name.trim(), host: form.host.trim(), database: form.database.trim(), user: form.user.trim() }
    upsertConnection(c)
    storePassword()
    onSaved(c)
    toast.success(isNew ? 'Conexión guardada' : 'Conexión actualizada', { description: 'La contraseña no se guarda con el proyecto.' })
  }

  const runTest = async () => {
    setConnectionStatus(form.id, { state: 'testing' })
    storePassword()
    try {
      const res = await dbApi.test(toPayload(form, password))
      setConnectionStatus(form.id, { state: 'ok', detail: `${res.latencyMs} ms · ${res.serverVersion.split(',')[0]}` })
    } catch (e) {
      setConnectionStatus(form.id, { state: 'error', detail: e instanceof Error ? e.message : String(e) })
    }
  }

  const remove = () => {
    removeConnection(form.id)
    forgetPassword(form.id)
    onDeleted()
  }

  const id = (k: string) => `conn-${k}`

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={id('name')}>Nombre</Label>
          <Input id={id('name')} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="produccion, staging…" />
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Motor</span>
          <RadioList
            name={id('dialect')}
            dense
            className="-mx-2 flex-row"
            value={form.dialect}
            onChange={(d) =>
              setForm((f) => ({ ...f, dialect: d, port: f.port === DEFAULT_PORT[f.dialect] ? DEFAULT_PORT[d] : f.port }))
            }
            options={[
              { value: 'postgresql', label: 'PostgreSQL' },
              { value: 'mysql', label: 'MySQL' },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <div className="space-y-1.5">
          <Label htmlFor={id('host')}>Host</Label>
          <Input id={id('host')} value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="localhost" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('port')}>Puerto</Label>
          <Input
            id={id('port')}
            type="number"
            min={1}
            max={65535}
            value={form.port || ''}
            onChange={(e) => set('port', Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={id('db')}>Base de datos</Label>
          <Input id={id('db')} value={form.database} onChange={(e) => set('database', e.target.value)} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('user')}>Usuario</Label>
          <Input id={id('user')} value={form.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={id('pw')}>Contraseña</Label>
          <Input
            id={id('pw')}
            type="password"
            value={password}
            onChange={(e) => setPw(e.target.value)}
            onBlur={storePassword}
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={form.ssl} onCheckedChange={(v) => set('ssl', v)} />
          SSL
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={remember}
            onCheckedChange={(v) => {
              setRemember(v === true)
              setPassword(form.id, password, v === true)
            }}
          />
          Recordar la contraseña en esta pestaña
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        La contraseña nunca se guarda en el proyecto ni en las exportaciones: queda en memoria
        {remember ? ' y en sessionStorage hasta cerrar la pestaña' : ' hasta recargar la página'}.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!valid || !dirty}>
          <Save />
          {isNew ? 'Guardar conexión' : 'Guardar cambios'}
        </Button>
        <Button type="button" variant="outline" disabled={!valid || testing} onClick={runTest}>
          {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
          Probar conexión
        </Button>
        {!isNew && (
          <Button type="button" variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={remove}>
            <Trash2 />
            Eliminar
          </Button>
        )}
      </div>

      <StatusLine status={status} />
    </form>
  )
}
