import { Trash } from 'lucide-react'
import type { ReactNode } from 'react'

import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function InspectorHeader({ kind, title, onDelete }: { kind: string; title: ReactNode; onDelete?: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground">{kind}</div>
        <div className="truncate text-sm font-semibold">{title}</div>
      </div>
      {onDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label="Eliminar"
          title="Eliminar (Supr)"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash />
        </Button>
      )}
    </div>
  )
}

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

interface InspectorSectionProps {
  children: ReactNode
  className?: string
  /** Con título la sección se puede plegar; `id` da la clave con la que se recuerda su estado. */
  title?: string
  id?: string
  meta?: ReactNode
  actions?: ReactNode
}

export function InspectorSection({ children, className, title, id, meta, actions }: InspectorSectionProps) {
  if (!title) return <div className={cn('grid gap-3 border-b px-4 py-4 last:border-b-0', className)}>{children}</div>
  return (
    <div className="border-b px-2.5 py-2 last:border-b-0">
      <CollapsibleSection
        title={title}
        meta={meta}
        actions={actions}
        storageKey={id ? `editor:inspector:${id}` : undefined}
        contentClassName="-mx-2.5"
      >
        <div className={cn('grid gap-3 px-4 pt-1.5 pb-2', className)}>{children}</div>
      </CollapsibleSection>
    </div>
  )
}
