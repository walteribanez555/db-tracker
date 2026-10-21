import type { Cardinality, Column, Relation, Schema, Table } from '@/types/schema'

import type { PendingRelation } from './types'

export const parseHandleColumn = (handleId: string | null | undefined) => handleId?.replace(/-(l|r)$/, '') ?? null

export const findColumn = (schema: Schema, tableId: string, columnId: string) => {
  const table = schema.tables.find((t) => t.id === tableId)
  const column = table?.columns.find((c) => c.id === columnId)
  return table && column ? { table, column } : null
}

/** Coloca la PK en el lado "uno" (source). Si ninguna o ambas son PK, respeta el sentido del arrastre. */
export function orientRelation(schema: Schema, pending: PendingRelation): PendingRelation {
  const from = findColumn(schema, pending.sourceTableId, pending.sourceColumnId)
  const to = findColumn(schema, pending.targetTableId, pending.targetColumnId)
  if (!from || !to) return pending
  const fromIsKey = from.column.pk || from.column.unique
  const toIsKey = to.column.pk || to.column.unique
  const swap = (to.column.pk && !from.column.pk) || (!from.column.pk && !to.column.pk && toIsKey && !fromIsKey)
  return swap ? swapRelation(pending) : pending
}

export const swapRelation = <T extends PendingRelation>(r: T): T => ({
  ...r,
  sourceTableId: r.targetTableId,
  sourceColumnId: r.targetColumnId,
  targetTableId: r.sourceTableId,
  targetColumnId: r.sourceColumnId,
})

export function defaultCardinality(source: Column, target: Column): Cardinality {
  return target.pk || target.unique ? (source.pk || source.unique ? '1:1' : '1:N') : '1:N'
}

export const cardinalityEnds = (c: Cardinality): [string, string] => (c === '1:1' ? ['1', '1'] : c === '1:N' ? ['1', 'N'] : ['N', 'M'])

export const fkColumnIdsByTable = (relations: Relation[]) => {
  const map = new Map<string, string[]>()
  for (const r of relations) {
    const list = map.get(r.targetTableId) ?? []
    list.push(r.targetColumnId)
    map.set(r.targetTableId, list)
  }
  return map
}

export const suggestRelationName = (source: Table, target: Table, targetColumn: Column) =>
  `fk_${target.name}_${targetColumn.name}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 63) || `fk_${source.name}`

export function relationLabel(schema: Schema, r: Relation) {
  const s = findColumn(schema, r.sourceTableId, r.sourceColumnId)
  const t = findColumn(schema, r.targetTableId, r.targetColumnId)
  return {
    source: s?.table.name ?? '?',
    sourceColumn: s?.column.name ?? '?',
    target: t?.table.name ?? '?',
    targetColumn: t?.column.name ?? '?',
  }
}
