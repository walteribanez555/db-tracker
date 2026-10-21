import { ArrowDown, ArrowUp, ChevronRight, KeyRound, Link2, Trash } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { Column } from '@/types/schema'

import { moveColumnIn, removeColumnFrom } from '../../lib/actions'
import { TypeCombobox } from '../TypeCombobox'
import { Field } from './primitives'

interface ColumnItemProps {
  tableId: string
  column: Column
  index: number
  total: number
  isFk: boolean
  expanded: boolean
  onToggle: () => void
}

export function ColumnItem({ tableId, column, index, total, isFk, expanded, onToggle }: ColumnItemProps) {
  const updateColumn = useProjectStore((s) => s.updateColumn)
  const id = useId()
  const patch = (p: Partial<Column>) => updateColumn(tableId, column.id, p)

  const flags: { key: string; label: string; checked: boolean; onChange: (v: boolean) => void }[] = [
    { key: 'pk', label: 'Clave primaria', checked: column.pk, onChange: (v) => patch(v ? { pk: true, nullable: false } : { pk: false }) },
    { key: 'nn', label: 'Not null', checked: !column.nullable, onChange: (v) => patch({ nullable: !v }) },
    { key: 'uq', label: 'Único', checked: column.unique, onChange: (v) => patch({ unique: v }) },
    { key: 'ai', label: 'Auto incremento', checked: column.autoIncrement, onChange: (v) => patch({ autoIncrement: v }) },
  ]

  return (
    <div className={cn('border-b last:border-b-0', expanded && 'bg-muted/40')}>
      <div className="flex items-center gap-1 py-1.5 pr-1 pl-2">
        <button
          type="button"
          onClick={() => patch(column.pk ? { pk: false } : { pk: true, nullable: false })}
          title={column.pk ? 'Quitar clave primaria' : 'Marcar como clave primaria'}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
        >
          {column.pk ? (
            <KeyRound className="size-3.5 text-amber-600 dark:text-amber-400" />
          ) : isFk ? (
            <Link2 className="size-3.5 text-sky-600 dark:text-sky-400" />
          ) : (
            <KeyRound className="size-3.5 text-muted-foreground/30" />
          )}
        </button>
        <Input
          value={column.name}
          onChange={(e) => patch({ name: e.target.value })}
          aria-label="Nombre de la columna"
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1.5 font-mono text-xs shadow-none hover:border-input focus-visible:border-ring md:text-xs dark:bg-transparent"
        />
        <TypeCombobox value={column.type} onChange={(type) => patch({ type })} className="h-7 w-32 shrink-0" />
        <Button variant="ghost" size="icon-xs" onClick={onToggle} aria-label="Detalles" aria-expanded={expanded}>
          <ChevronRight className={cn('transition-transform', expanded && 'rotate-90')} />
        </Button>
      </div>

      {expanded && (
        <div className="grid gap-3 px-3 pt-1 pb-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {flags.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <Switch id={`${id}-${f.key}`} size="sm" checked={f.checked} onCheckedChange={f.onChange} />
                <Label htmlFor={`${id}-${f.key}`} className="text-xs font-normal">
                  {f.label}
                </Label>
              </div>
            ))}
          </div>
          <Field label="Valor por defecto" htmlFor={`${id}-default`}>
            <Input
              id={`${id}-default`}
              value={column.default ?? ''}
              onChange={(e) => patch({ default: e.target.value || undefined })}
              placeholder="NULL"
              className="h-7 font-mono text-xs md:text-xs"
            />
          </Field>
          <Field label="Comentario" htmlFor={`${id}-comment`}>
            <Input
              id={`${id}-comment`}
              value={column.comment ?? ''}
              onChange={(e) => patch({ comment: e.target.value || undefined })}
              className="h-7 text-xs md:text-xs"
            />
          </Field>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="xs" disabled={index === 0} onClick={() => moveColumnIn(tableId, index, index - 1)}>
              <ArrowUp />
              Subir
            </Button>
            <Button variant="ghost" size="xs" disabled={index === total - 1} onClick={() => moveColumnIn(tableId, index, index + 1)}>
              <ArrowDown />
              Bajar
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => removeColumnFrom(tableId, column.id)}
            >
              <Trash />
              Eliminar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
