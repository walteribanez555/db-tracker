import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

const read = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(`db-tracker:panel:${key}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

export interface CollapsiblePanelProps {
  side: 'left' | 'right'
  /** Ancho desplegado en px. */
  width: number
  /** Nombre del panel: se muestra vertical en el riel cuando está plegado. */
  title: string
  storageKey: string
  defaultOpen?: boolean
  /** Atajo opcional (p. ej. '[' o ']') para plegar/desplegar. */
  shortcut?: string
  className?: string
  children: React.ReactNode
}

/** Panel lateral que se pliega a un riel estrecho con animación de ancho. */
export function CollapsiblePanel({
  side,
  width,
  title,
  storageKey,
  defaultOpen = true,
  shortcut,
  className,
  children,
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(() => read(storageKey, defaultOpen))

  const change = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(`db-tracker:panel:${storageKey}`, next ? '1' : '0')
    } catch {
      // sin almacenamiento
    }
  }

  useEffect(() => {
    if (!shortcut) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], .monaco-editor, .nokey')) return
      if (e.key === shortcut) setOpen((o) => {
        try {
          localStorage.setItem(`db-tracker:panel:${storageKey}`, o ? '0' : '1')
        } catch {
          // sin almacenamiento
        }
        return !o
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut, storageKey])

  const CloseIcon = side === 'left' ? PanelLeftClose : PanelRightClose
  const OpenIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen
  const hint = shortcut ? ` (${shortcut})` : ''

  return (
    <aside
      aria-label={title}
      style={{ width: open ? width : 40 }}
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden bg-background transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none',
        side === 'left' ? 'border-r' : 'border-l',
        className,
      )}
    >
      <div
        aria-hidden={!open}
        inert={!open}
        style={{ width }}
        className={cn(
          'flex min-h-0 flex-1 flex-col transition-opacity duration-200',
          open ? 'opacity-100 delay-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className={cn('flex h-9 shrink-0 items-center px-2', side === 'left' ? 'justify-end' : 'justify-start')}>
          <button
            type="button"
            onClick={() => change(false)}
            aria-label={`Plegar ${title}${hint}`}
            title={`Plegar${hint}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>

      <button
        type="button"
        onClick={() => change(true)}
        aria-label={`Desplegar ${title}${hint}`}
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        className={cn(
          'absolute inset-0 flex flex-col items-center gap-3 pt-2.5 text-muted-foreground transition-opacity duration-200 hover:bg-muted/60 hover:text-foreground',
          open ? 'pointer-events-none opacity-0' : 'opacity-100 delay-150',
        )}
      >
        <OpenIcon className="size-4" />
        <span className="text-xs font-medium [writing-mode:vertical-rl]">{title}</span>
      </button>
    </aside>
  )
}
