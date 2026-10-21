import { ArrowRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { TABLE_COLORS, useProjectStore } from '@/store/project'
import type { Table } from '@/types/schema'

import { addColumnTo, deleteSelection } from '../../lib/actions'
import { fkColumnIdsByTable, relationLabel } from '../../lib/relations'
import { ColorSwatches } from '../ColorSwatches'
import { ColumnItem } from './ColumnItem'
import { IndexesPanel } from './IndexesPanel'
import { Field, InspectorHeader, InspectorSection } from './primitives'

const TAB_FADE = 'animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none'

function TableRelations({ table }: { table: Table }) {
  const draft = useProjectStore((s) => s.draft)
  const setSelection = useProjectStore((s) => s.setSelection)
  const related = draft.relations.filter((r) => r.sourceTableId === table.id || r.targetTableId === table.id)

  if (!related.length) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">Sin relaciones. Arrastra desde el borde de una columna hacia otra tabla.</p>
    )
  }
  return (
    <div>
      {related.map((r) => {
        const l = relationLabel(draft, r)
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => setSelection({ kind: 'relation', id: r.id })}
            className="flex w-full items-center gap-2 border-b px-4 py-2 text-left font-mono text-xs last:border-b-0 hover:bg-muted/60"
          >
            <span className="min-w-0 flex-1 truncate">
              {l.source}.{l.sourceColumn}
            </span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {l.target}.{l.targetColumn}
            </span>
            <span className="text-muted-foreground">{r.cardinality}</span>
          </button>
        )
      })}
    </div>
  )
}

export function TableInspector({ table }: { table: Table }) {
  const updateTable = useProjectStore((s) => s.updateTable)
  const relations = useProjectStore((s) => s.draft.relations)
  const [expanded, setExpanded] = useState<string | null>(null)
  const fkIds = useMemo(() => fkColumnIdsByTable(relations).get(table.id) ?? [], [relations, table.id])
  const relationCount = relations.filter((r) => r.sourceTableId === table.id || r.targetTableId === table.id).length

  const addColumn = () => {
    const column = addColumnTo(table.id)
    if (column) setExpanded(column.id)
  }

  return (
    <>
      <InspectorHeader
        kind="Tabla"
        title={
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: table.color }} />
            <span className="truncate font-mono">{table.name}</span>
          </span>
        }
        onDelete={deleteSelection}
      />

      <InspectorSection title="General" id="table-general">
        <Field label="Nombre" htmlFor="table-name">
          <Input
            id="table-name"
            value={table.name}
            onChange={(e) => updateTable(table.id, { name: e.target.value })}
            className="font-mono"
          />
        </Field>
        <Field label="Color">
          <ColorSwatches colors={TABLE_COLORS} value={table.color} onChange={(color) => updateTable(table.id, { color })} />
        </Field>
        <Field label="Comentario" htmlFor="table-comment">
          <Textarea
            id="table-comment"
            value={table.comment ?? ''}
            onChange={(e) => updateTable(table.id, { comment: e.target.value || undefined })}
            rows={2}
            placeholder="Descripción de la tabla"
            className="min-h-14 text-sm"
          />
        </Field>
      </InspectorSection>

      <Tabs defaultValue="columns" className="gap-0">
        <div className="border-b px-4 py-2">
          <TabsList variant="line" className="h-7 gap-3 p-0">
            <TabsTrigger value="columns" className="px-0 text-xs">
              Columnas <span className="text-muted-foreground tabular-nums">{table.columns.length}</span>
            </TabsTrigger>
            <TabsTrigger value="indexes" className="px-0 text-xs">
              Índices <span className="text-muted-foreground tabular-nums">{table.indexes.length}</span>
            </TabsTrigger>
            <TabsTrigger value="relations" className="px-0 text-xs">
              Relaciones <span className="text-muted-foreground tabular-nums">{relationCount}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="columns" className={TAB_FADE}>
          {table.columns.map((column, i) => (
            <ColumnItem
              key={column.id}
              tableId={table.id}
              column={column}
              index={i}
              total={table.columns.length}
              isFk={fkIds.includes(column.id)}
              expanded={expanded === column.id}
              onToggle={() => setExpanded((cur) => (cur === column.id ? null : column.id))}
            />
          ))}
          <div className="border-t px-4 py-3">
            <Button variant="outline" size="sm" className="w-full" onClick={addColumn}>
              <Plus />
              Agregar columna
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="indexes" className={TAB_FADE}>
          <IndexesPanel table={table} />
        </TabsContent>
        <TabsContent value="relations" className={TAB_FADE}>
          <TableRelations table={table} />
        </TabsContent>
      </Tabs>
    </>
  )
}
