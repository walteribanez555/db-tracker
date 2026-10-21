import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Bot, Globe, Info, Monitor, Smartphone, User, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useActivity, type ClientKind } from '@/collab'
import { useProjectStore } from '@/store/project'

import { useActivityStore } from '../activity'

const KIND_ICON: Record<ClientKind, LucideIcon> = { agent: Bot, desktop: Monitor, web: Globe, mobile: Smartphone }

interface Row {
  id: string
  at: number
  icon: LucideIcon
  color: string | null
  who: string | null
  action: string
  detail?: string
  branch?: string
}

/** Fuerza un re-render cada `ms` para que la hora relativa no se quede vieja. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function relative(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'ahora'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  return format(at, 'd MMM', { locale: es })
}

/**
 * Contenido de la pestaña "Actividad" del dock, lo más reciente arriba: entradas, salidas y cambios de rol
 * (derivados del store) y lo que hacen los participantes, sobre todo agentes MCP (control {t:'activity'}).
 */
export function ActivityPanel() {
  const local = useActivityStore((s) => s.entries)
  const remote = useActivity()
  const branches = useProjectStore((s) => s.project.branches)
  const now = useNow(30_000)

  const rows = useMemo<Row[]>(() => {
    const branchName = (id?: string) => (id ? (branches.find((b) => b.id === id)?.name ?? undefined) : undefined)
    const a: Row[] = local.map((e) => ({
      id: e.id,
      at: e.at,
      icon: e.who ? (e.kind ? KIND_ICON[e.kind] : User) : Info,
      color: e.color,
      who: e.who,
      action: e.text,
    }))
    const b: Row[] = remote.map((e) => ({
      id: `r:${e.id}`,
      at: Date.parse(e.at) || 0,
      icon: KIND_ICON[e.actor.kind] ?? User,
      color: e.actor.color,
      who: e.actor.name,
      action: e.action,
      detail: e.detail,
      branch: branchName(e.branchId),
    }))
    return [...a, ...b].sort((x, y) => y.at - x.at)
  }, [local, remote, branches])

  if (!rows.length)
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Aquí aparece lo que pasa en la sesión compartida: quién entra y sale, los cambios de rol y lo que hacen los agentes de Claude Code.
      </p>
    )
  return (
    <ol className="divide-y" aria-label="Actividad de la sesión">
      {rows.map((e) => {
        const Icon = e.icon
        return (
          <li
            key={e.id}
            className="flex items-start gap-2.5 px-4 py-1.5 text-xs animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
          >
            <Icon
              className={e.color ? 'mt-px size-3.5 shrink-0' : 'mt-px size-3.5 shrink-0 text-muted-foreground'}
              style={e.color ? { color: e.color } : undefined}
              aria-hidden
            />
            <p className="min-w-0 flex-1 leading-snug">
              {e.who ? (
                <>
                  <span className="font-medium" style={{ color: e.color ?? undefined }}>
                    {e.who}
                  </span>{' '}
                  {e.action}
                  {e.detail && <span className="text-muted-foreground"> · {e.detail}</span>}
                  {e.branch && <span className="font-mono text-muted-foreground sm:hidden"> · {e.branch}</span>}
                </>
              ) : (
                <span className="text-muted-foreground">{e.action}</span>
              )}
            </p>
            <span className="flex shrink-0 items-baseline gap-2 text-muted-foreground">
              {e.branch && <span className="hidden max-w-32 truncate font-mono sm:inline">{e.branch}</span>}
              <time className="tabular-nums" dateTime={new Date(e.at).toISOString()} title={format(e.at, "d MMM yyyy, HH:mm:ss", { locale: es })}>
                {relative(e.at, now)}
              </time>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
