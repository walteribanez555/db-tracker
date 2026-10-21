import { ArrowDown, ArrowUp, ChevronLeft, KeyRound, Link2, Trash } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useProjectStore } from '@/store/project'
import type { Column, Table } from '@/types/schema'

import { moveColumnIn, removeColumnFrom } from '../../lib/actions'
import { TypeCombobox } from '../TypeCombobox'
import { Field } from './primitives'

interface MobileColumnEditorProps {
  table: Table
  column: Column
  isFk: boolean
  onBack: () => void
}

/** Móvil: edición de una columna dentro de la hoja inferior (pantalla propia con «atrás»). */
export function MobileColumnEditor({ table, column, isFk, onBack }: MobileColumnEditorProps) {
  const updateColumn = useProjectStore((s) => s.updateColumn)
  const id = useId()
  const index = table.columns.findIndex((c) => c.id === column.id)
  const total = table.columns.length
  const patch = (p: Partial<Column>) => updateColumn(table.id, column.id, p)

  const flags: { key: string; label: string; checked: boolean; onChange: (v: boolean) => void }[] = [
    { key: 'pk', label: 'Clave primaria', checked: column.pk, onChange: (v) => patch(v ? { pk: true, nullable: false } : { pk: false }) },
    { key: 'nn', label: 'Not null', checked: !column.nullable, onChange: (v) => patch({ nullable: !v }) },
    { key: 'uq', label: 'Único', checked: column.unique, onChange: (v) => patch({ unique: v }) },
    { key: 'ai', label: 'Auto incremento', checked: column.autoIncrement, onChange: (v) => patch({ autoIncrement: v }) },
  ]

  return (
    <div className="animate-in fade-in-0 slide-in-from-right-2 duration-200 ease-out motion-reduce:animate-none">
      <div className="flex h-12 items-center gap-1 border-b pr-4 pl-1">
        <Button variant="ghost" size="icon" className="size-11" onClick={onBack} aria-label="Volver a las columnas">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="flex size-4 shrink-0 items-center justify-center">
          {column.pk ? (
            <KeyRound className="size-3.5 text-amber-600 dark:text-amber-400" />
          ) : isFk ? (
            <Link2 className="size-3.5 text-sky-600 dark:text-sky-400" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{column.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      <div className="grid gap-4 p-4">
        <Field label="Nombre" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={column.name}
            onChange={(e) => patch({ name: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 font-mono text-base"
          />
        </Field>
        <Field label="Tipo">
          <TypeCombobox value={column.type} onChange={(type) => patch({ type })} className="h-11 w-full text-sm" />
        </Field>
      </div>

      <div className="border-y">
        {flags.map((f) => (
          <div key={f.key} className="flex min-h-[52px] items-center gap-3 border-b px-4 last:border-b-0">
            <Label htmlFor={`${id}-${f.key}`} className="min-w-0 flex-1 text-sm font-normal">
              {f.label}
            </Label>
            <Switch id={`${id}-${f.key}`} checked={f.checked} onCheckedChange={f.onChange} />
          </div>
        ))}
      </div>

      <div className="grid gap-4 p-4">
        <Field label="Valor por defecto" htmlFor={`${id}-default`}>
          <Input
            id={`${id}-default`}
            value={column.default ?? ''}
            onChange={(e) => patch({ default: e.target.value || undefined })}
            placeholder="NULL"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 font-mono text-base"
          />
        </Field>
        <Field label="Comentario" htmlFor={`${id}-comment`}>
          <Input
            id={`${id}-comment`}
            value={column.comment ?? ''}
            onChange={(e) => patch({ comment: e.target.value || undefined })}
            className="h-11 text-base"
          />
        </Field>
      </div>

      <div className="flex items-center gap-2 border-t px-4 py-3">
        <Button variant="outline" className="h-11 flex-1" disabled={index <= 0} onClick={() => moveColumnIn(table.id, index, index - 1)}>
          <ArrowUp />
          Subir
        </Button>
        <Button variant="outline" className="h-11 flex-1" disabled={index === total - 1} onClick={() => moveColumnIn(table.id, index, index + 1)}>
          <ArrowDown />
          Bajar
        </Button>
        <Button
          variant="ghost"
          className="h-11 flex-1 text-destructive hover:text-destructive"
          onClick={() => {
            removeColumnFrom(table.id, column.id)
            onBack()
          }}
        >
          <Trash />
          Eliminar
        </Button>
      </div>
    </div>
  )
}
