import { ArrowLeftRight, ArrowRight, Info } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useProjectStore } from '@/store/project'
import type { Cardinality, Column, ReferentialAction, Table } from '@/types/schema'

import { discrete } from '../lib/actions'
import { useEditorUi } from '../lib/editorStore'
import { defaultCardinality, findColumn, suggestRelationName, swapRelation } from '../lib/relations'
import type { PendingRelation } from '../lib/types'
import { CardinalityToggle } from './CardinalityToggle'
import { ReferentialSelect } from './ReferentialSelect'
import { TypeCompatibility } from './TypeCompatibility'

export function NewRelationDialog() {
  const pending = useEditorUi((s) => s.pendingRelation)
  const setPending = useEditorUi((s) => s.setPendingRelation)
  const close = () => setPending(null)

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        {pending && <NewRelationForm key={JSON.stringify(pending)} pending={pending} onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

function Endpoint({ label, table, column }: { label: string; table: Table; column: Column }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: table.color }} />
        <span className="truncate font-mono text-sm">
          {table.name}.<span className="font-semibold">{column.name}</span>
        </span>
      </div>
      <div className="mt-0.5 truncate pl-3.5 font-mono text-[11px] text-muted-foreground">
        {column.type}
        {column.pk ? ' · PK' : column.unique ? ' · UNIQUE' : ''}
      </div>
    </div>
  )
}

function NewRelationForm({ pending, onDone }: { pending: PendingRelation; onDone: () => void }) {
  const draft = useProjectStore((s) => s.draft)
  const [rel, setRel] = useState(pending)
  const source = findColumn(draft, rel.sourceTableId, rel.sourceColumnId)
  const target = findColumn(draft, rel.targetTableId, rel.targetColumnId)
  const [cardinality, setCardinality] = useState<Cardinality>(() =>
    source && target ? defaultCardinality(source.column, target.column) : '1:N',
  )
  const [onDelete, setOnDelete] = useState<ReferentialAction>('NO ACTION')
  const [onUpdate, setOnUpdate] = useState<ReferentialAction>('NO ACTION')
  const [name, setName] = useState(() => (source && target ? suggestRelationName(source.table, target.table, target.column) : ''))

  if (!source || !target) {
    return (
      <DialogHeader>
        <DialogTitle>Nueva relación</DialogTitle>
        <DialogDescription>Las columnas seleccionadas ya no existen.</DialogDescription>
      </DialogHeader>
    )
  }

  const duplicate = draft.relations.some(
    (r) =>
      (r.sourceColumnId === rel.sourceColumnId && r.targetColumnId === rel.targetColumnId) ||
      (r.sourceColumnId === rel.targetColumnId && r.targetColumnId === rel.sourceColumnId),
  )
  const sourceIsKey = source.column.pk || source.column.unique

  const swap = () => {
    const next = swapRelation(rel)
    const s = findColumn(draft, next.sourceTableId, next.sourceColumnId)
    const t = findColumn(draft, next.targetTableId, next.targetColumnId)
    setRel(next)
    if (s && t) {
      setCardinality(defaultCardinality(s.column, t.column))
      setName(suggestRelationName(s.table, t.table, t.column))
    }
  }

  const confirm = () => {
    discrete(() => {
      const created = useProjectStore.getState().addRelation({
        ...rel,
        name: name.trim() || undefined,
        cardinality,
        onDelete,
        onUpdate,
      })
      useProjectStore.getState().setSelection({ kind: 'relation', id: created.id })
    })
    onDone()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nueva relación</DialogTitle>
        <DialogDescription>El origen es el lado «uno» (columna referenciada); el destino guarda la clave foránea.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="flex items-center gap-2 border-y py-3">
          <Endpoint label="Origen · lado 1" table={source.table} column={source.column} />
          <div className="flex flex-col items-center gap-0.5">
            <ArrowRight className="size-4 text-muted-foreground" />
            <Button variant="ghost" size="icon-xs" onClick={swap} aria-label="Invertir sentido" title="Invertir sentido">
              <ArrowLeftRight />
            </Button>
          </div>
          <Endpoint label={`Destino · lado ${cardinality === '1:1' ? '1' : 'N'}`} table={target.table} column={target.column} />
        </div>

        <TypeCompatibility source={source} target={target} />

        {!sourceIsKey && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            La columna de origen no es PK ni UNIQUE; la mayoría de motores exigen una clave en el lado referenciado.
          </p>
        )}
        {duplicate && (
          <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Ya existe una relación entre estas columnas.
          </p>
        )}

        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Cardinalidad</Label>
          <CardinalityToggle value={cardinality} onChange={setCardinality} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ReferentialSelect label="ON DELETE" value={onDelete} onChange={setOnDelete} />
          <ReferentialSelect label="ON UPDATE" value={onUpdate} onChange={setOnUpdate} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="relation-name" className="text-xs text-muted-foreground">
            Nombre de la restricción (opcional)
          </Label>
          <Input id="relation-name" value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-sm" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button onClick={confirm}>Crear relación</Button>
      </DialogFooter>
    </>
  )
}
