// Consultas de ejemplo a partir del esquema: lecturas, conteos, joins por FK,
// filtros por columnas indexadas/únicas, agregados por FK y lecturas de vistas.
import type { SampleQuery } from '../../../src/features/io/api-types.ts'
import type { SampleSchemaInput } from './validation.ts'

type Dialect = 'postgresql' | 'mysql'

const quote = (name: string, d: Dialect) => (d === 'mysql' ? '`' + name.replace(/`/g, '``') + '`' : '"' + name.replace(/"/g, '""') + '"')

export function suggestQueries(schema: SampleSchemaInput, dialect: Dialect, limit = 20): SampleQuery[] {
  const q = (s: string) => quote(s, dialect)
  const tables = schema.tables
  const byId = new Map(tables.map((t) => [t.id, t]))
  const degree = new Map<string, number>()
  for (const r of schema.relations) {
    degree.set(r.sourceTableId, (degree.get(r.sourceTableId) ?? 0) + 1)
    degree.set(r.targetTableId, (degree.get(r.targetTableId) ?? 0) + 1)
  }
  const ranked = [...tables].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))

  const joins: SampleQuery[] = []
  const aggregates: SampleQuery[] = []
  for (const r of schema.relations) {
    const src = byId.get(r.sourceTableId)
    const tgt = byId.get(r.targetTableId)
    const sc = src?.columns.find((c) => c.id === r.sourceColumnId)
    const tc = tgt?.columns.find((c) => c.id === r.targetColumnId)
    if (!src || !tgt || !sc || !tc) continue
    joins.push({
      label: `Join ${tgt.name} → ${src.name}`,
      kind: 'join',
      query: `SELECT t.*, s.* FROM ${q(tgt.name)} t JOIN ${q(src.name)} s ON s.${q(sc.name)} = t.${q(tc.name)} LIMIT 100`,
    })
    aggregates.push({
      label: `${tgt.name} por ${tc.name}`,
      kind: 'aggregate',
      query: `SELECT t.${q(tc.name)}, COUNT(*) AS total FROM ${q(tgt.name)} t GROUP BY t.${q(tc.name)} ORDER BY total DESC LIMIT 10`,
    })
  }

  const filters: SampleQuery[] = []
  for (const t of ranked) {
    const indexed = new Set<string>()
    for (const i of t.indexes) if (i.columnIds[0]) indexed.add(i.columnIds[0])
    for (const c of t.columns) if (c.unique && !c.pk) indexed.add(c.id)
    for (const cid of indexed) {
      const c = t.columns.find((x) => x.id === cid)
      if (!c) continue
      // Valor existente tomado de la propia tabla: el filtro siempre "acierta".
      filters.push({
        label: `Filtro ${t.name}.${c.name}`,
        kind: 'filter',
        query: `SELECT * FROM ${q(t.name)} WHERE ${q(c.name)} = (SELECT ${q(c.name)} FROM ${q(t.name)} WHERE ${q(c.name)} IS NOT NULL LIMIT 1) LIMIT 100`,
      })
    }
    const pk = t.columns.filter((c) => c.pk)
    if (pk.length === 1) {
      filters.push({
        label: `Búsqueda por PK en ${t.name}`,
        kind: 'filter',
        query: `SELECT * FROM ${q(t.name)} WHERE ${q(pk[0].name)} = (SELECT ${q(pk[0].name)} FROM ${q(t.name)} LIMIT 1)`,
      })
    }
  }

  const scans: SampleQuery[] = ranked.map((t) => ({ label: `Lectura de ${t.name}`, kind: 'scan', query: `SELECT * FROM ${q(t.name)} LIMIT 100` }))
  const counts: SampleQuery[] = ranked.map((t) => ({ label: `Conteo de ${t.name}`, kind: 'count', query: `SELECT COUNT(*) FROM ${q(t.name)}` }))
  const views: SampleQuery[] = schema.views.map((v) => ({ label: `Vista ${v.name}`, kind: 'view', query: `SELECT * FROM ${q(v.name)} LIMIT 100` }))

  // Intercalado para tener variedad aunque se recorte por `limit`.
  const buckets = [joins, filters, scans, aggregates, views, counts]
  const out: SampleQuery[] = []
  const seen = new Set<string>()
  for (let i = 0; out.length < limit && buckets.some((b) => i < b.length); i++) {
    for (const b of buckets) {
      const item = b[i]
      if (item && !seen.has(item.query) && out.length < limit) {
        seen.add(item.query)
        out.push(item)
      }
    }
  }
  return out
}
