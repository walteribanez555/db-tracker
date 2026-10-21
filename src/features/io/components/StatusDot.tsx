// Indicador del estado de una conexión (probando / conectado / error) con transición.
import { cn } from '@/lib/utils'

import { fadeIn } from '../lib/motion'
import type { ConnectionStatus } from '../lib/status'

const DOT: Record<ConnectionStatus['state'], string> = {
  idle: 'bg-muted-foreground/40',
  testing: 'bg-brand animate-pulse motion-reduce:animate-none',
  ok: 'bg-emerald-600 dark:bg-[#4fd1a5]',
  error: 'bg-destructive',
}

const LABEL: Record<ConnectionStatus['state'], string> = {
  idle: 'Sin probar',
  testing: 'Probando conexión…',
  ok: 'Conectado',
  error: 'Error de conexión',
}

export function StatusDot({ status, className }: { status: ConnectionStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={LABEL[status.state]}
      title={'detail' in status ? `${LABEL[status.state]} · ${status.detail}` : LABEL[status.state]}
      className={cn('inline-block size-2 shrink-0 rounded-full transition-colors duration-300', DOT[status.state], className)}
    />
  )
}

export function StatusLine({ status }: { status: ConnectionStatus }) {
  if (status.state === 'idle') return null
  return (
    <p key={status.state} className={cn('flex items-start gap-2 text-sm', fadeIn)} aria-live="polite">
      <StatusDot status={status} className="mt-1.5" />
      <span className="min-w-0">
        <span
          className={cn(
            'font-medium',
            status.state === 'ok' && 'text-emerald-700 dark:text-[#4fd1a5]',
            status.state === 'error' && 'text-destructive',
            status.state === 'testing' && 'text-muted-foreground',
          )}
        >
          {LABEL[status.state]}
        </span>
        {'detail' in status && <span className="text-muted-foreground"> · {status.detail}</span>}
      </span>
    </p>
  )
}
