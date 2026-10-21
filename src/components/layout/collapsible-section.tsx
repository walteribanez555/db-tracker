import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

const read = (key: string | undefined, fallback: boolean) => {
  if (!key) return fallback
  try {
    const v = localStorage.getItem(`db-tracker:section:${key}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

export interface CollapsibleSectionProps {
  title: React.ReactNode
  /** Texto gris junto al título (p. ej. un conteo). */
  meta?: React.ReactNode
  /** Botones a la derecha del encabezado; no pliegan la sección al pulsarlos. */
  actions?: React.ReactNode
  defaultOpen?: boolean
  /** Si se indica, el estado abierto/cerrado se recuerda entre visitas. */
  storageKey?: string
  className?: string
  contentClassName?: string
  children: React.ReactNode
}

/** Sección con encabezado que se pliega y despliega con animación de altura. */
export function CollapsibleSection({
  title,
  meta,
  actions,
  defaultOpen = true,
  storageKey,
  className,
  contentClassName,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(() => read(storageKey, defaultOpen))

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (storageKey) {
      try {
        localStorage.setItem(`db-tracker:section:${storageKey}`, next ? '1' : '0')
      } catch {
        // sin almacenamiento: solo en memoria
      }
    }
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn('group/section', className)}>
      <div className="flex items-center gap-1">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <ChevronRight className="size-3.5 shrink-0 transition-transform duration-200 ease-out group-data-[state=open]/section:rotate-90" />
          <span className="truncate">{title}</span>
          {meta != null && <span className="font-normal tabular-nums">{meta}</span>}
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsibleContent
        className={cn(
          'overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down',
          contentClassName,
        )}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
