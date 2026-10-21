import {
  Check,
  CloudUpload,
  Code,
  Columns3,
  Eye,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Hash,
  Link2,
  Loader2,
  ShieldCheck,
  SquareFunction,
  Table2,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

import type { Operation, StepKind, StepStatus } from './store'

const KIND_ICON: Record<StepKind, React.ComponentType<{ className?: string }>> = {
  table: Table2,
  column: Columns3,
  relation: Link2,
  view: Eye,
  trigger: Zap,
  function: SquareFunction,
  index: Hash,
  branch: GitBranch,
  commit: GitCommitHorizontal,
  sql: Code,
  network: CloudUpload,
  file: FileText,
  check: ShieldCheck,
}

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'pendiente',
  running: 'en curso',
  done: 'hecho',
  error: 'error',
  skipped: 'omitido',
}

/** Pasos de una operación como un flujo horizontal: nodos unidos por conectores que se rellenan al avanzar. */
export function FlowSteps({ operation }: { operation: Operation }) {
  const scroller = useRef<HTMLOListElement>(null)
  const runningIndex = operation.steps.findIndex((s) => s.status === 'running')

  useEffect(() => {
    if (runningIndex < 0) return
    const el = scroller.current?.children[runningIndex] as HTMLElement | undefined
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [runningIndex])

  return (
    <ol ref={scroller} className="flex items-stretch overflow-x-auto px-4 py-3" aria-label={`Pasos de ${operation.title}`}>
      {operation.steps.map((step, i) => {
        const Icon = KIND_ICON[step.kind ?? 'check']
        const next = operation.steps[i + 1]
        const filled = step.status === 'done' && next && next.status !== 'pending' && next.status !== 'skipped'
        return (
          <li
            key={step.id}
            className="flex shrink-0 animate-in items-center fade-in slide-in-from-left-2 duration-300"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms`, animationFillMode: 'both' }}
          >
            <div
              className={cn(
                'relative flex w-44 flex-col gap-1 rounded-lg border bg-card px-3 py-2 transition-[border-color,background-color,opacity,box-shadow] duration-300',
                step.status === 'pending' && 'opacity-55',
                step.status === 'skipped' && 'opacity-40',
                step.status === 'running' && 'border-brand shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_18%,transparent)]',
                step.status === 'done' && 'border-border',
                step.status === 'error' && 'border-destructive bg-destructive/5',
              )}
              aria-current={step.status === 'running' ? 'step' : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors duration-300',
                    step.status === 'running' ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground',
                    step.status === 'done' && 'text-foreground',
                    step.status === 'error' && 'bg-destructive/10 text-destructive',
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{step.label}</span>
                <StatusGlyph status={step.status} />
              </div>
              {step.detail && (
                <p key={step.detail} className="line-clamp-2 animate-in font-mono text-[11px] leading-4 text-muted-foreground fade-in duration-300">
                  {step.detail}
                </p>
              )}
              <span className="sr-only">{STATUS_LABEL[step.status]}</span>
              {step.ms != null && step.status === 'done' && (
                <span className="text-[10px] text-muted-foreground tabular-nums">{step.ms} ms</span>
              )}
            </div>
            {next && (
              <span aria-hidden="true" className="relative mx-1.5 h-px w-8 bg-border">
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 w-full origin-left bg-brand transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]',
                    filled ? 'scale-x-100' : 'scale-x-0',
                  )}
                />
                {step.status === 'running' && (
                  <span className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 animate-[flow-dot_1.1s_ease-in-out_infinite] rounded-full bg-brand motion-reduce:hidden" />
                )}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function StatusGlyph({ status }: { status: StepStatus }) {
  const base = 'size-3.5 shrink-0 animate-in zoom-in-50 fade-in duration-200'
  if (status === 'running') return <Loader2 key="r" className={cn(base, 'animate-spin text-brand')} />
  if (status === 'done') return <Check key="d" className={cn(base, 'text-emerald-600 dark:text-emerald-400')} />
  if (status === 'error') return <X key="e" className={cn(base, 'text-destructive')} />
  return <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/50" />
}
