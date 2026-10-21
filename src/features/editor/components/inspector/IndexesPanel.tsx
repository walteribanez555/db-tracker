import { Plus, Trash } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { Index, Table } from '@/types/schema'

import { addIndex, removeIndex, updateIndex } from '../../lib/actions'

function IndexItem({ table, index }: { table: Table; index: Index }) {
  const id = useId()
  const toggleColumn = (columnId: string, checked: boolean) => {
    const set = new Set(index.columnIds)
    if (checked) set.add(columnId)
    else set.delete(columnId)
    updateIndex(table.id, index.id, { columnIds: table.columns.map((c) => c.id).filter((c) => set.has(c)) })
  }

  return (
    <div className="grid gap-2.5 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-1">
        <Input
          value={index.name}
          onChange={(e) => updateIndex(table.id, index.id, { name: e.target.value })}
          aria-label="Nombre del índice"
          className="h-7 flex-1 font-mono text-xs md:text-xs"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Eliminar índice"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => removeIndex(table.id, index.id)}
        >
          <Trash />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`${id}-unique`}
          size="sm"
          checked={index.unique}
          onCheckedChange={(v) => updateIndex(table.id, index.id, { unique: v })}
        />
        <Label htmlFor={`${id}-unique`} className="text-xs font-normal">
          Único
        </Label>
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Columnas</span>
        {table.columns.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-xs">
            <Checkbox checked={index.columnIds.includes(c.id)} onCheckedChange={(v) => toggleColumn(c.id, v === true)} />
            <span className="font-mono">{c.name}</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">{c.type}</span>
          </label>
        ))}
        {index.columnIds.length === 0 && <p className="text-xs text-amber-600 dark:text-amber-400">Selecciona al menos una columna.</p>}
      </div>
    </div>
  )
}

export function IndexesPanel({ table }: { table: Table }) {
  return (
    <div>
      {table.indexes.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">Esta tabla no tiene índices.</p>}
      {table.indexes.map((index) => (
        <IndexItem key={index.id} table={table} index={index} />
      ))}
      <div className="px-4 py-3">
        <Button variant="outline" size="sm" className="w-full" onClick={() => addIndex(table.id)}>
          <Plus />
          Agregar índice
        </Button>
      </div>
    </div>
  )
}
