import { forwardRef } from 'react'

import { cn } from '@/lib/utils'

import type { SimStep } from '../lib/graph'

function stepPrefix(s: SimStep): string {
  switch (s.kind) {
    case 'trigger':
      return s.phase ?? ''
    case 'operation':
      return 'Operación'
    case 'cycle':
      return 'Ciclo'
    case 'limit':
      return 'Límite'
    case 'refresh-view':
      return 'Refresco'
    case 'stale-view':
      return 'Vista'
    case 'disabled':
      return 'Desactivado'
  }
}

/** Lista numerada de pasos de una simulación; el paso actual se ilumina con transición. */
export const SimStepList = forwardRef<HTMLOListElement, { steps: SimStep[]; current: number; keyPrefix: string }>(function SimStepList(
  { steps, current, keyPrefix },
  listRef,
) {
  return (
          <ol ref={listRef} className="divide-y text-xs" aria-label="Secuencia de ejecución">
            {steps.map((s, i) => {
              const state = current < 0 ? 'idle' : i < current ? 'done' : i === current ? 'current' : 'pending'
              return (
                <li
                  key={`${keyPrefix}:${s.index}`}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'relative flex gap-2 px-4 py-2 transition-[background-color,color,opacity] duration-300 ease-out motion-reduce:transition-none',
                    'animate-in fade-in slide-in-from-top-1 fill-mode-both motion-reduce:animate-none',
                    'before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand before:opacity-0 before:transition-opacity before:duration-300',
                    state === 'current' && 'bg-brand/10 before:opacity-100',
                    state === 'pending' && 'text-muted-foreground opacity-70',
                  )}
                  style={{ paddingLeft: 16 + s.depth * 14, animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <span
                    className={cn(
                      'w-5 shrink-0 text-right font-mono tabular-nums transition-colors duration-300',
                      state === 'current' ? 'text-brand' : state === 'done' ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {s.index}.
                  </span>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        state === 'current' && 'font-medium',
                        s.kind === 'cycle' && 'text-destructive',
                        s.kind === 'stale-view' && 'text-amber-700 dark:text-amber-400',
                        s.kind === 'disabled' && 'text-muted-foreground line-through decoration-muted-foreground/50',
                      )}
                    >
                      <span className="text-muted-foreground">{stepPrefix(s)} · </span>
                      {s.kind === 'trigger' ? s.label.replace(/^\S+\s/, '') : s.label}
                    </p>
                    {s.detail && <p className="text-muted-foreground">{s.detail}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
  )
})
