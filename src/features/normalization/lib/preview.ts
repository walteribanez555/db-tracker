// Calcula el "antes / después" de un plan de corrección para dibujarlo.
import type { DataMigrationHint, Schema } from '@/types/schema'

import { applyFix, fixTableIds, planFix } from './fixes'
import type { FixPlan } from './types'

export type ColState = 'same' | 'removed' | 'added' | 'changed'

export interface PreviewColumn {
  id: string
  name: string
  type: string
  pk: boolean
  fk: boolean
  state: ColState
  /** Valor anterior cuando cambió el nombre o el tipo. */
  previous?: string
}

export interface PreviewTable {
  id: string
  name: string
  state: 'same' | 'new' | 'renamed' | 'removed'
  isView: boolean
  previousName?: string
  columns: PreviewColumn[]
  indexes: { name: string; added: boolean }[]
}

export interface PreviewSide {
  tables: PreviewTable[]
  edges: { id: string; source: string; target: string }[]
}

export interface Preview {
  before: PreviewSide
  after: PreviewSide
  /** SQL que preserva los datos al aplicar el cambio (se registra en schema.dataMigrations). */
  migrations: DataMigrationHint[]
}

function edgesFor(schema: Schema, ids: Set<string>) {
  const out = schema.relations
    .filter((r) => ids.has(r.sourceTableId) && ids.has(r.targetTableId) && r.sourceTableId !== r.targetTableId)
    .map((r) => ({ id: r.id, source: r.sourceTableId, target: r.targetTableId }))
  for (const v of schema.views ?? [])
    if (ids.has(v.id)) for (const s of v.sourceIds) if (ids.has(s)) out.push({ id: `${s}->${v.id}`, source: s, target: v.id })
  return out
}

export function buildPreview(schema: Schema, fix: FixPlan): Preview {
  const after = applyFix(schema, fix)
  const ids = new Set(fixTableIds(schema, fix))
  if (fix.kind === 'drop-view') {
    ids.add(fix.viewId)
    const view = (schema.views ?? []).find((v) => v.id === fix.viewId)
    view?.sourceIds.forEach((s) => ids.add(s))
  }
  const newIds = after.tables.filter((t) => !schema.tables.some((b) => b.id === t.id)).map((t) => t.id)
  const afterIds = new Set([...[...ids].filter((id) => after.tables.some((t) => t.id === id) || (after.views ?? []).some((v) => v.id === id)), ...newIds])

  const fkSet = (s: Schema) => new Set(s.relations.map((r) => r.targetColumnId))
  const fkBefore = fkSet(schema)
  const fkAfter = fkSet(after)

  const viewTable = (s: Schema, id: string, state: PreviewTable['state']): PreviewTable | undefined => {
    const v = (s.views ?? []).find((x) => x.id === id)
    if (!v) return undefined
    return {
      id: v.id,
      name: v.name,
      state,
      isView: true,
      columns: v.columns.map((c) => ({ id: c.name, name: c.name, type: c.type ?? '', pk: false, fk: false, state: state === 'removed' ? 'removed' : 'same' })),
      indexes: [],
    }
  }

  const before: PreviewTable[] = []
  for (const id of ids) {
    const t = schema.tables.find((x) => x.id === id)
    if (!t) {
      const removed = !(after.views ?? []).some((v) => v.id === id)
      const vt = viewTable(schema, id, removed ? 'removed' : 'same')
      if (vt) before.push(vt)
      continue
    }
    const ta = after.tables.find((x) => x.id === id)
    before.push({
      id,
      name: t.name,
      state: !ta ? 'removed' : ta.name !== t.name ? 'renamed' : 'same',
      isView: false,
      columns: t.columns.map((c) => {
        const ca = ta?.columns.find((x) => x.id === c.id)
        const changed = ca && (ca.name !== c.name || ca.type !== c.type || ca.pk !== c.pk)
        return { id: c.id, name: c.name, type: c.type, pk: c.pk, fk: fkBefore.has(c.id), state: !ca ? 'removed' : changed ? 'changed' : 'same' }
      }),
      indexes: t.indexes.map((i) => ({ name: i.name, added: false })),
    })
  }

  const afterTables: PreviewTable[] = []
  for (const id of afterIds) {
    const t = after.tables.find((x) => x.id === id)
    if (!t) {
      const vt = viewTable(after, id, 'same')
      if (vt) afterTables.push(vt)
      continue
    }
    const tb = schema.tables.find((x) => x.id === id)
    afterTables.push({
      id,
      name: t.name,
      state: !tb ? 'new' : tb.name !== t.name ? 'renamed' : 'same',
      previousName: tb && tb.name !== t.name ? tb.name : undefined,
      isView: false,
      columns: t.columns.map((c) => {
        const cb = tb?.columns.find((x) => x.id === c.id)
        if (!cb) return { id: c.id, name: c.name, type: c.type, pk: c.pk, fk: fkAfter.has(c.id), state: 'added' }
        const prev = cb.name !== c.name ? cb.name : cb.type !== c.type ? cb.type : cb.pk !== c.pk ? 'sin PK' : undefined
        return { id: c.id, name: c.name, type: c.type, pk: c.pk, fk: fkAfter.has(c.id), state: prev ? 'changed' : 'same', previous: prev }
      }),
      indexes: t.indexes.map((i) => ({ name: i.name, added: !tb?.indexes.some((x) => x.id === i.id) })),
    })
  }

  // Orden visual: el orden horizontal original, las tablas nuevas al final.
  const xOf = (s: Schema, id: string) =>
    s.tables.find((t) => t.id === id)?.position.x ?? (s.views ?? []).find((v) => v.id === id)?.position.x ?? Number.MAX_SAFE_INTEGER
  before.sort((a, b) => xOf(schema, a.id) - xOf(schema, b.id))
  afterTables.sort((a, b) => xOf(schema, a.id) - xOf(schema, b.id))

  return {
    migrations: planFix(schema, fix).flatMap((st) => (st.hint ? [st.hint] : [])),
    before: { tables: before, edges: edgesFor(schema, new Set(before.map((t) => t.id))) },
    after: { tables: afterTables, edges: edgesFor(after, new Set(afterTables.map((t) => t.id))) },
  }
}
