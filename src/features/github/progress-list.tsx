// Lista de progreso por versión (subir y bajar): pendiente → en curso → hecha, con transición de icono y fila.
import { Check, Circle, Loader2, Minus, X } from 'lucide-react'

import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export type RowState = 'pending' | 'current' | 'done' | 'skipped' | 'error'

export interface ProgressRow {
  id: string
  state: RowState
  label: string
  meta?: React.ReactNode
  trailing?: React.ReactNode
}

const ICON: Record<RowState, React.ReactNode> = {
  pending: <Circle className="size-2.5 text-muted-foreground/50" />,
  current: <Loader2 className="size-3.5 animate-spin text-brand" />,
  done: <Check className="size-3.5 text-emerald-700 dark:text-emerald-400" />,
  skipped: <Minus className="size-3.5 text-muted-foreground" />,
  error: <X className="size-3.5 text-destructive" />,
}

const ROW: Record<RowState, string> = {
  pending: 'text-muted-foreground',
  current: 'bg-brand/10 text-foreground',
  done: 'text-foreground',
  skipped: 'text-muted-foreground',
  error: 'bg-destructive/10 text-destructive',
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label: React.ReactNode }) {
  return (
    <div className="animate-in fade-in duration-200">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span key={done} className="tabular-nums text-muted-foreground animate-in fade-in duration-200">
          {done} de {total}
        </span>
      </div>
      <Progress
        value={total ? (done / total) * 100 : 0}
        className="mt-2 [&_[data-slot=progress-indicator]]:bg-brand [&_[data-slot=progress-indicator]]:duration-300 [&_[data-slot=progress-indicator]]:ease-out"
      />
    </div>
  )
}

export function ProgressList({ rows, className }: { rows: ProgressRow[]; className?: string }) {
  return (
    <ol className={cn('max-h-80 divide-y overflow-y-auto border-y text-sm', className)}>
      {rows.map((r, i) => (
        <li
          key={r.id}
          style={i < 8 ? { animationDelay: `${i * 30}ms` } : undefined}
          className={cn(
            'flex items-center gap-3 px-2 py-2 transition-colors duration-300 ease-out animate-in fade-in slide-in-from-top-1 fill-mode-backwards',
            ROW[r.state],
          )}
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <span key={r.state} className="flex animate-in fade-in zoom-in-50 duration-200 ease-out">
              {ICON[r.state]}
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate">{r.label}</span>
          {r.meta && <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{r.meta}</span>}
          {r.trailing !== undefined && <span className="w-20 text-right font-mono text-xs text-muted-foreground">{r.trailing}</span>}
        </li>
      ))}
    </ol>
  )
}
