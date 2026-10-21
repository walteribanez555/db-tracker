import { ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

// Colaboración: pestaña "Actividad" (entradas, salidas y cambios de rol de la sesión).
import { ActivityPanel, useActivityCount, useIsCollaborating } from '@/features/collab'
import { LiveChanges } from '@/features/versions/live-changes'
import { diffSchemas } from '@/lib/diff'
import { cn } from '@/lib/utils'
import { emptySchema, useProjectStore } from '@/store/project'

import { FlowSteps } from './flow-steps'
import { useOperationStore, type Operation } from './store'

type Tab = 'live' | 'ops' | 'activity'
const KEY = 'db-tracker:flow-dock'

const readOpen = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

const duration = (op: Operation) => {
  const ms = (op.finishedAt ?? Date.now()) - op.startedAt
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

/** Dock inferior "Flujo": cambios en vivo del borrador y operaciones paso a paso. */
export function FlowDock() {
  const [open, setOpen] = useState(readOpen)
  const [tab, setTab] = useState<Tab>('live')
  const operations = useOperationStore((s) => s.operations)
  const focusedId = useOperationStore((s) => s.focusedId)
  const focus = useOperationStore((s) => s.focus)
  const focused = operations.find((o) => o.id === focusedId) ?? operations[0]

  const draft = useProjectStore((s) => s.draft)
  const base = useProjectStore((s) => (s.baseVersionId ? s.project.versions.find((v) => v.id === s.baseVersionId)?.schema : undefined))
  const dialect = useProjectStore((s) => s.project.dialect)
  const collaborating = useIsCollaborating()
  const activityCount = useActivityCount()
  const showActivity = collaborating || activityCount > 0
  const jumps = useMemo(() => diffSchemas(base ?? emptySchema(dialect), draft).jumps, [base, draft, dialect])

  const change = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      // sin almacenamiento
    }
  }

  // Al empezar una operación, el dock se abre en la pestaña Operaciones.
  const runningId = operations.find((o) => o.status === 'running')?.id
  useEffect(() => {
    if (!runningId) return
    setOpen(true)
    setTab('ops')
  }, [runningId])

  const tabButton = (id: Tab, label: string, meta: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={open && tab === id}
      onClick={() => {
        setTab(id)
        change(true)
      }}
      className={cn(
        'relative flex h-9 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
        open && tab === id && 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground',
      )}
    >
      {label}
      <span key={String(meta)} className="animate-in font-normal text-muted-foreground tabular-nums fade-in duration-300">
        {meta}
      </span>
    </button>
  )

  return (
    <section aria-label="Flujo" className="shrink-0 border-t bg-background">
      <div role="tablist" className="flex items-center gap-5 px-4">
        {tabButton('live', 'Cambios en vivo', jumps ? `${jumps}` : 'sin cambios')}
        {tabButton(
          'ops',
          'Operaciones',
          focused ? (focused.status === 'running' ? 'en curso' : focused.status === 'error' ? 'con error' : `${operations.length}`) : '0',
        )}
        {showActivity && tabButton('activity', 'Actividad', `${activityCount}`)}
        {focused?.status === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden="true" />}
        <button
          type="button"
          onClick={() => change(!open)}
          aria-label={open ? 'Plegar flujo' : 'Desplegar flujo'}
          aria-expanded={open}
          className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronUp className={cn('size-4 transition-transform duration-300', open && 'rotate-180')} />
        </button>
      </div>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <div className="h-52 border-t">
            {tab === 'activity' && showActivity ? (
              <div key="activity" className="h-full animate-in overflow-auto fade-in duration-200">
                <ActivityPanel />
              </div>
            ) : tab === 'live' || tab === 'activity' ? (
              <div key="live" className="h-full animate-in overflow-auto fade-in duration-200">
                <LiveChanges />
              </div>
            ) : (
              <div key="ops" className="flex h-full animate-in fade-in duration-200">
                <ul className="w-56 shrink-0 overflow-y-auto border-r py-1" aria-label="Historial de operaciones">
                  {operations.length === 0 && (
                    <li className="px-4 py-3 text-xs text-muted-foreground">
                      Aquí aparecen, paso a paso, las operaciones que hagas: aplicar normalización, crear un flujo, migrar, subir o bajar.
                    </li>
                  )}
                  {operations.map((op, i) => (
                    <li key={op.id} className="animate-in fade-in slide-in-from-top-1 duration-200" style={{ animationDelay: `${Math.min(i, 8) * 30}ms`, animationFillMode: 'both' }}>
                      <button
                        type="button"
                        onClick={() => focus(op.id)}
                        aria-current={op.id === focused?.id}
                        className={cn(
                          'flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition-colors hover:bg-muted/60',
                          op.id === focused?.id && 'bg-muted',
                        )}
                      >
                        <span className="w-full truncate text-xs font-medium">{op.title}</span>
                        <span
                          className={cn(
                            'flex items-center gap-1.5 text-[11px] text-muted-foreground',
                            op.status === 'error' && 'text-destructive',
                          )}
                        >
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              op.status === 'running' && 'animate-pulse bg-brand',
                              op.status === 'done' && 'bg-emerald-500',
                              op.status === 'error' && 'bg-destructive',
                            )}
                          />
                          {op.status === 'running' ? 'en curso' : op.status === 'error' ? 'error' : 'hecho'} · {duration(op)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="min-w-0 flex-1">
                  {focused ? (
                    <div key={focused.id} className="flex h-full animate-in flex-col fade-in duration-200">
                      <div className="flex items-baseline gap-2 px-4 pt-3 text-sm">
                        <span className="font-medium">{focused.title}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {focused.steps.filter((s) => s.status === 'done').length} de {focused.steps.length} pasos
                        </span>
                        {focused.error && <span className="truncate text-xs text-destructive">{focused.error}</span>}
                      </div>
                      <FlowSteps operation={focused} />
                    </div>
                  ) : (
                    <p className="p-4 text-xs text-muted-foreground">Sin operaciones todavía.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
