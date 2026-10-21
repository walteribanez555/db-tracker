import { ArrowLeftRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProjectStore } from '@/store/project'
import type { Relation, Table } from '@/types/schema'

import { deleteSelection, discrete } from '../../lib/actions'
import { findColumn, relationLabel, swapRelation } from '../../lib/relations'
import { CardinalityToggle } from '../CardinalityToggle'
import { ReferentialSelect } from '../ReferentialSelect'
import { TypeCompatibility } from '../TypeCompatibility'
import { Field, InspectorHeader, InspectorSection } from './primitives'

function ColumnSelect({ table, value, onChange }: { table: Table; value: string; onChange: (columnId: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 shrink-0 rounded-full" style={{ background: table.color }} />
      <span className="max-w-24 truncate font-mono text-xs">{table.name}.</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="min-w-0 flex-1 font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {table.columns.map((c) => (
            <SelectItem key={c.id} value={c.id} className="font-mono text-xs">
              {c.name} <span className="text-muted-foreground">{c.type}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function RelationInspector({ relation }: { relation: Relation }) {
  const draft = useProjectStore((s) => s.draft)
  const updateRelation = useProjectStore((s) => s.updateRelation)
  const source = findColumn(draft, relation.sourceTableId, relation.sourceColumnId)
  const target = findColumn(draft, relation.targetTableId, relation.targetColumnId)
  const label = relationLabel(draft, relation)
  const patch = (p: Partial<Relation>) => updateRelation(relation.id, p)

  return (
    <>
      <InspectorHeader
        kind="Relación"
        title={
          <span className="font-mono">
            {label.source} → {label.target}
          </span>
        }
        onDelete={deleteSelection}
      />

      <InspectorSection title="Extremos" id="relation-ends">
        {source && (
          <Field label="Origen · lado 1 (referenciado)">
            <ColumnSelect table={source.table} value={relation.sourceColumnId} onChange={(id) => patch({ sourceColumnId: id })} />
          </Field>
        )}
        {target && (
          <Field label="Destino · clave foránea">
            <ColumnSelect table={target.table} value={relation.targetColumnId} onChange={(id) => patch({ targetColumnId: id })} />
          </Field>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="justify-self-start text-muted-foreground"
          onClick={() => discrete(() => patch(swapRelation(relation)))}
        >
          <ArrowLeftRight />
          Invertir sentido
        </Button>
        {source && target && <TypeCompatibility source={source} target={target} />}
      </InspectorSection>

      <InspectorSection title="Restricción" id="relation-constraint">
        <Field label="Cardinalidad">
          <CardinalityToggle value={relation.cardinality} onChange={(cardinality) => discrete(() => patch({ cardinality }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <ReferentialSelect label="ON DELETE" value={relation.onDelete} onChange={(onDelete) => discrete(() => patch({ onDelete }))} />
          <ReferentialSelect label="ON UPDATE" value={relation.onUpdate} onChange={(onUpdate) => discrete(() => patch({ onUpdate }))} />
        </div>
        <Field label="Nombre de la restricción" htmlFor="relation-name">
          <Input
            id="relation-name"
            value={relation.name ?? ''}
            onChange={(e) => patch({ name: e.target.value || undefined })}
            placeholder="fk_…"
            className="font-mono text-sm"
          />
        </Field>
      </InspectorSection>
    </>
  )
}
