// Diff estructural entre esquemas + métricas de flujos (ramas) y estimación heurística de coste de consultas.
// Dueño: feature "versions". El contrato de tipos vive en src/types/report.ts.
import type { BranchMetrics, QueryBenchmark, SchemaDiff } from '@/types/report'
import type { Column, Project, Relation, Schema, Table, Trigger, Version, View } from '@/types/schema'

/* -------------------------------------------------------------------------- */
/*                                    Diff                                    */
/* -------------------------------------------------------------------------- */

const COLUMN_FIELDS: { key: keyof Column; label: string; fmt?: (v: unknown) => string }[] = [
  { key: 'type', label: 'tipo' },
  { key: 'pk', label: 'pk', fmt: (v) => (v ? 'sí' : 'no') },
  { key: 'nullable', label: 'nullable', fmt: (v) => (v ? 'sí' : 'no') },
  { key: 'unique', label: 'unique', fmt: (v) => (v ? 'sí' : 'no') },
  { key: 'autoIncrement', label: 'autoincremento', fmt: (v) => (v ? 'sí' : 'no') },
  { key: 'default', label: 'default', fmt: (v) => (v === undefined || v === null || v === '' ? '∅' : String(v)) },
]

const fmtVal = (v: unknown, fmt?: (v: unknown) => string) => (fmt ? fmt(v) : String(v ?? '∅'))

/** Etiqueta legible de una relación: nombre o `origen.col → destino.col`. */
export function relationLabel(rel: Relation, schema: Schema): string {
  if (rel.name) return rel.name
  const st = schema.tables.find((t) => t.id === rel.sourceTableId)
  const tt = schema.tables.find((t) => t.id === rel.targetTableId)
  const sc = st?.columns.find((c) => c.id === rel.sourceColumnId)
  const tc = tt?.columns.find((c) => c.id === rel.targetColumnId)
  return `${st?.name ?? '?'}.${sc?.name ?? '?'} → ${tt?.name ?? '?'}.${tc?.name ?? '?'}`
}

const relationSignature = (r: Relation) =>
  [r.sourceTableId, r.sourceColumnId, r.targetTableId, r.targetColumnId, r.cardinality, r.onDelete, r.onUpdate].join('|')

function triggerLabel(t: Trigger, schema: Schema): string {
  const table = schema.tables.find((x) => x.id === t.tableId)?.name ?? '?'
  return `${t.name} (${t.timing} ${t.events.join('/')} ON ${table})${t.enabled === false ? ' [desactivado]' : ''}`
}

const triggerSignature = (t: Trigger) =>
  [t.name, t.tableId, t.functionId, t.timing, [...t.events].sort().join('/'), t.level, t.condition ?? '', t.enabled === false ? 'off' : 'on'].join('|')

/** Cambios de definición de un trigger (mismo id). Vacío si no cambió. */
export function triggerFieldChanges(a: Trigger, b: Trigger, from: Schema, to: Schema): string[] {
  const changes: string[] = []
  if (a.name !== b.name) changes.push(`nombre: ${a.name} → ${b.name}`)
  if (a.timing !== b.timing) changes.push(`momento: ${a.timing} → ${b.timing}`)
  const ae = [...a.events].sort().join('/')
  const be = [...b.events].sort().join('/')
  if (ae !== be) changes.push(`eventos: ${a.events.join('/')} → ${b.events.join('/')}`)
  if (a.level !== b.level) changes.push(`nivel: ${a.level} → ${b.level}`)
  if ((a.condition ?? '') !== (b.condition ?? '')) changes.push(`condición: ${a.condition || '∅'} → ${b.condition || '∅'}`)
  if ((a.enabled ?? true) !== (b.enabled ?? true)) changes.push(b.enabled === false ? 'trigger desactivado' : 'trigger activado')
  if (a.functionId !== b.functionId) {
    const fa = from.functions.find((f) => f.id === a.functionId)?.name ?? '?'
    const fb = to.functions.find((f) => f.id === b.functionId)?.name ?? '?'
    changes.push(`función: ${fa}() → ${fb}()`)
  }
  if (a.tableId !== b.tableId) {
    const ta = from.tables.find((t) => t.id === a.tableId)?.name ?? '?'
    const tb = to.tables.find((t) => t.id === b.tableId)?.name ?? '?'
    changes.push(`tabla: ${ta} → ${tb}`)
  }
  return changes
}

function triggerChange(a: Trigger, b: Trigger, from: Schema, to: Schema): string {
  return `${b.name}: ${triggerFieldChanges(a, b, from, to).join('; ')}`
}

const viewLabel = (v: View) => `${v.name}${v.materialized ? ' (materializada)' : ''}`
const normSql = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase()

/** Cambios de una vista (mismo id). Vacío si no cambió. */
export function viewFieldChanges(a: View, b: View): string[] {
  const changes: string[] = []
  if (a.name !== b.name) changes.push(`nombre: ${a.name} → ${b.name}`)
  if (normSql(a.definition) !== normSql(b.definition)) changes.push('definición modificada')
  if (a.materialized !== b.materialized) changes.push(`materializada: ${a.materialized ? 'sí' : 'no'} → ${b.materialized ? 'sí' : 'no'}`)
  return changes
}

function viewChange(a: View, b: View): string | null {
  const changes = viewFieldChanges(a, b)
  return changes.length ? `${b.name}: ${changes.join('; ')}` : null
}

/** Cambios de una columna (mismo id): nombre, tipo, pk, nullable, unique, autoincremento, default. */
export function columnFieldChanges(b: Column, a: Column): string[] {
  const changes: string[] = []
  if (b.name !== a.name) changes.push(`nombre: ${b.name} → ${a.name}`)
  for (const f of COLUMN_FIELDS) {
    if ((b[f.key] ?? '') !== (a[f.key] ?? '')) changes.push(`${f.label}: ${fmtVal(b[f.key], f.fmt)} → ${fmtVal(a[f.key], f.fmt)}`)
  }
  return changes
}

function diffTable(before: Table, after: Table): SchemaDiff['modifiedTables'][number] | null {
  const bCols = new Map(before.columns.map((c) => [c.id, c]))
  const aCols = new Map(after.columns.map((c) => [c.id, c]))
  const addedColumns = after.columns.filter((c) => !bCols.has(c.id)).map((c) => c.name)
  const removedColumns = before.columns.filter((c) => !aCols.has(c.id)).map((c) => c.name)
  const changedColumns: { column: string; changes: string[] }[] = []

  for (const a of after.columns) {
    const b = bCols.get(a.id)
    if (!b) continue
    const changes = columnFieldChanges(b, a)
    if (changes.length) changedColumns.push({ column: a.name, changes })
  }

  // Los índices no tienen campo propio en el contrato: se reportan como entradas "índice …".
  const colName = (t: Table, id: string) => t.columns.find((c) => c.id === id)?.name ?? '?'
  const bIdx = new Map(before.indexes.map((i) => [i.id, i]))
  const aIdx = new Map(after.indexes.map((i) => [i.id, i]))
  for (const i of after.indexes) {
    const prev = bIdx.get(i.id)
    const cols = i.columnIds.map((id) => colName(after, id)).join(', ')
    if (!prev) {
      changedColumns.push({ column: `índice ${i.name}`, changes: [`añadido${i.unique ? ' (único)' : ''} sobre (${cols})`] })
    } else if (prev.name !== i.name || prev.unique !== i.unique || prev.columnIds.join() !== i.columnIds.join()) {
      changedColumns.push({ column: `índice ${i.name}`, changes: [`modificado: (${cols})${i.unique ? ' único' : ''}`] })
    }
  }
  for (const i of before.indexes) {
    if (!aIdx.has(i.id)) changedColumns.push({ column: `índice ${i.name}`, changes: ['eliminado'] })
  }

  if (!addedColumns.length && !removedColumns.length && !changedColumns.length) return null
  return { table: after.name, addedColumns, removedColumns, changedColumns }
}

/** Diferencias estructurales `from → to`. `from = null` equivale a un esquema vacío. */
export function diffSchemas(from: Schema | null, to: Schema): SchemaDiff {
  const fromTables = from?.tables ?? []
  const before = new Map(fromTables.map((t) => [t.id, t]))
  const after = new Map(to.tables.map((t) => [t.id, t]))

  const addedTables = to.tables.filter((t) => !before.has(t.id)).map((t) => t.name)
  const removedTables = fromTables.filter((t) => !after.has(t.id)).map((t) => t.name)
  const renamedTables: SchemaDiff['renamedTables'] = []
  const modifiedTables: SchemaDiff['modifiedTables'] = []

  for (const t of to.tables) {
    const b = before.get(t.id)
    if (!b) continue
    if (b.name !== t.name) renamedTables.push({ from: b.name, to: t.name })
    const mod = diffTable(b, t)
    if (mod) modifiedTables.push(mod)
  }

  // Relaciones: mismo id con extremos distintos = eliminada + añadida.
  const fromRels = from?.relations ?? []
  const bRel = new Map(fromRels.map((r) => [r.id, r]))
  const aRel = new Map(to.relations.map((r) => [r.id, r]))
  const addedRelations: string[] = []
  const removedRelations: string[] = []
  for (const r of to.relations) {
    const prev = bRel.get(r.id)
    if (!prev) addedRelations.push(relationLabel(r, to))
    else if (relationSignature(prev) !== relationSignature(r)) {
      removedRelations.push(relationLabel(prev, from!))
      addedRelations.push(relationLabel(r, to))
    }
  }
  for (const r of fromRels) if (!aRel.has(r.id)) removedRelations.push(relationLabel(r, from!))

  // Triggers: mismo id con definición distinta = cambiado.
  const fromTrg = from?.triggers ?? []
  const bTrg = new Map(fromTrg.map((t) => [t.id, t]))
  const aTrg = new Map(to.triggers.map((t) => [t.id, t]))
  const addedTriggers: string[] = []
  const removedTriggers: string[] = []
  const changedTriggers: string[] = []
  for (const t of to.triggers) {
    const prev = bTrg.get(t.id)
    if (!prev) addedTriggers.push(triggerLabel(t, to))
    else if (triggerSignature(prev) !== triggerSignature(t)) changedTriggers.push(triggerChange(prev, t, from!, to))
  }
  for (const t of fromTrg) if (!aTrg.has(t.id)) removedTriggers.push(triggerLabel(t, from!))

  // Vistas (los esquemas antiguos pueden no traer `views`).
  const fromViews = from?.views ?? []
  const toViews = to.views ?? []
  const bView = new Map(fromViews.map((v) => [v.id, v]))
  const aView = new Map(toViews.map((v) => [v.id, v]))
  const addedViews = toViews.filter((v) => !bView.has(v.id)).map(viewLabel)
  const removedViews = fromViews.filter((v) => !aView.has(v.id)).map(viewLabel)
  const changedViews: string[] = []
  for (const v of toViews) {
    const prev = bView.get(v.id)
    if (prev) {
      const c = viewChange(prev, v)
      if (c) changedViews.push(c)
    }
  }

  const columnJumps = modifiedTables.reduce(
    (n, m) => n + m.addedColumns.length + m.removedColumns.length + m.changedColumns.reduce((k, c) => k + c.changes.length, 0),
    0,
  )
  const jumps =
    addedTables.length +
    removedTables.length +
    renamedTables.length +
    columnJumps +
    addedRelations.length +
    removedRelations.length +
    addedViews.length +
    removedViews.length +
    changedViews.length +
    addedTriggers.length +
    removedTriggers.length +
    changedTriggers.length

  return {
    addedTables,
    removedTables,
    renamedTables,
    modifiedTables,
    addedRelations,
    removedRelations,
    addedViews,
    removedViews,
    changedViews,
    addedTriggers,
    removedTriggers,
    changedTriggers,
    jumps,
  }
}

/** Desglose de los saltos de un diff por categoría (útil para barras apiladas). */
export function jumpBreakdown(d: SchemaDiff) {
  const tables = d.addedTables.length + d.removedTables.length + d.renamedTables.length
  let columns = 0
  let indexes = 0
  for (const m of d.modifiedTables) {
    columns += m.addedColumns.length + m.removedColumns.length
    for (const c of m.changedColumns) {
      if (c.column.startsWith('índice ')) indexes += c.changes.length
      else columns += c.changes.length
    }
  }
  const relations = d.addedRelations.length + d.removedRelations.length
  const views = d.addedViews.length + d.removedViews.length + d.changedViews.length
  const triggers = d.addedTriggers.length + d.removedTriggers.length + d.changedTriggers.length
  return { tables, columns, indexes, relations, views, triggers }
}

export const isEmptyDiff = (d: SchemaDiff) => d.jumps === 0

/* -------------------------------------------------------------------------- */
/*                                  Métricas                                  */
/* -------------------------------------------------------------------------- */

const HOUR = 3_600_000
const DAY = 24 * HOUR

const ts = (iso: string) => new Date(iso).getTime()

/** Versión padre (puede estar en otra rama: la versión de origen del fork). */
export function parentOf(project: Project, v: Version): Version | undefined {
  return v.parentId ? project.versions.find((x) => x.id === v.parentId) : undefined
}

/** Diff de una versión respecto a su padre (esquema vacío si no tiene). */
export function versionDiff(project: Project, v: Version): SchemaDiff {
  return diffSchemas(parentOf(project, v)?.schema ?? null, v.schema)
}

export interface MetricsOptions {
  /** Benchmarks (remotos o estimados). Se prefieren los 'remote' sobre los 'estimate'. */
  benchmarks?: QueryBenchmark[]
  /** Rango de fechas: solo cuentan las versiones creadas dentro. */
  from?: Date | null
  to?: Date | null
}

/** Media y p95 de las mediciones de la versión más reciente de la rama que tenga benchmarks. */
function branchLatency(versions: Version[], benchmarks: QueryBenchmark[]): { avg: number | null; p95: number | null } {
  if (!benchmarks.length) return { avg: null, p95: null }
  const byVersion = new Map<string, QueryBenchmark[]>()
  for (const b of benchmarks) {
    const list = byVersion.get(b.versionId) ?? []
    list.push(b)
    byVersion.set(b.versionId, list)
  }
  for (const v of [...versions].reverse()) {
    const list = byVersion.get(v.id)
    if (!list?.length) continue
    const remote = list.filter((b) => b.source === 'remote')
    const use = remote.length ? remote : list
    // Si hay varias mediciones de la misma consulta, nos quedamos con la más reciente.
    const latest = new Map<string, QueryBenchmark>()
    for (const b of use) {
      const prev = latest.get(b.query)
      if (!prev || ts(b.measuredAt) > ts(prev.measuredAt)) latest.set(b.query, b)
    }
    const items = [...latest.values()]
    const avg = items.reduce((s, b) => s + b.avgMs, 0) / items.length
    const p95 = items.reduce((s, b) => s + b.p95Ms, 0) / items.length
    return { avg: round(avg, 2), p95: round(p95, 2) }
  }
  return { avg: null, p95: null }
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/**
 * Métricas por rama:
 * - agilidad: horas medias entre cada versión y su padre (incluye el salto desde la versión de origen del fork)
 *   y versiones/día en el periodo activo (desde el origen hasta la última versión; mínimo 1 día).
 * - saltos: suma y máximo de `diffSchemas(padre, versión).jumps`.
 * - latencia: desde `options.benchmarks` (o `null`).
 */
export function computeBranchMetrics(project: Project, options: MetricsOptions | QueryBenchmark[] = {}): BranchMetrics[] {
  const opts: MetricsOptions = Array.isArray(options) ? { benchmarks: options } : options
  const from = opts.from?.getTime() ?? -Infinity
  const to = opts.to?.getTime() ?? Infinity
  const benchmarks = opts.benchmarks ?? []

  return project.branches.map((branch) => {
    const versions = project.versions
      .filter((v) => v.branchId === branch.id)
      .filter((v) => ts(v.createdAt) >= from && ts(v.createdAt) <= to)
      .sort((a, b) => ts(a.createdAt) - ts(b.createdAt))

    const gaps: number[] = []
    let totalJumps = 0
    let maxJump = 0
    for (const v of versions) {
      const parent = parentOf(project, v)
      if (parent) gaps.push((ts(v.createdAt) - ts(parent.createdAt)) / HOUR)
      const j = diffSchemas(parent?.schema ?? null, v.schema).jumps
      totalJumps += j
      maxJump = Math.max(maxJump, j)
    }

    let versionsPerDay = 0
    if (versions.length) {
      const first = versions[0]
      const startParent = parentOf(project, first)
      const start = Math.max(startParent ? ts(startParent.createdAt) : ts(first.createdAt), from)
      const end = ts(versions[versions.length - 1].createdAt)
      versionsPerDay = versions.length / Math.max(1, (end - start) / DAY)
    }

    const latency = branchLatency(versions, benchmarks)
    return {
      branchId: branch.id,
      branchName: branch.name,
      versions: versions.length,
      avgHoursBetweenVersions: gaps.length ? round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0,
      versionsPerDay: round(versionsPerDay, 2),
      totalJumps,
      maxJump,
      avgQueryMs: latency.avg,
      p95QueryMs: latency.p95,
    }
  })
}

/* -------------------------------------------------------------------------- */
/*                         Estimación heurística de coste                      */
/* -------------------------------------------------------------------------- */

export interface QueryCostOptions {
  /** Filas supuestas por tabla (por nombre). Por defecto `defaultRows`. */
  rows?: Record<string, number>
  defaultRows?: number
}

export interface QueryCostEstimate {
  avgMs: number
  p95Ms: number
  tables: string[]
  joins: number
  /** Joins cuya columna de unión no tiene índice/PK en ninguno de los lados. */
  unindexedJoins: number
  /** Tablas recorridas completas (sin índice utilizable en el filtro). */
  seqScans: string[]
  /** Triggers que se dispararían (para INSERT/UPDATE/DELETE). */
  triggersFired: number
  notes: string[]
}

const DEFAULT_ROWS = 10_000

/** Heurística de filas: tablas de detalle y auditoría crecen más que los catálogos. */
function guessRows(table: Table, opts: QueryCostOptions): number {
  if (opts.rows?.[table.name] !== undefined) return opts.rows[table.name]
  const base = opts.defaultRows ?? DEFAULT_ROWS
  const n = table.name.toLowerCase()
  if (/(audit|log|histor|evento)/.test(n)) return base * 20
  if (/(item|detalle|linea|línea)/.test(n)) return base * 4
  if (/(categor|tipo|estado|pais|país|moneda)/.test(n)) return Math.max(20, Math.round(base / 200))
  if (/(producto|telefono|teléfono)/.test(n)) return Math.round(base / 2)
  return base
}

/** ¿Hay un índice (o PK/unique) cuya primera columna sea `columnName`? */
function isIndexed(table: Table, columnName: string): boolean {
  const col = table.columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase())
  if (!col) return false
  const pkCols = table.columns.filter((c) => c.pk)
  if (pkCols[0]?.id === col.id) return true
  if (col.unique) return true
  return table.indexes.some((i) => i.columnIds[0] === col.id)
}

const stripQuotes = (s: string) => s.replace(/["`[\]]/g, '')

/**
 * Estimación heurística (sin BD) del coste de una consulta SQL sobre un esquema:
 * analiza FROM/JOIN/WHERE, si las columnas de unión/filtro están indexadas, el número de filas supuesto
 * y los triggers que dispararía una escritura. Devuelve milisegundos aproximados (orden de magnitud).
 */
export function estimateQueryCost(schema: Schema, query: string, opts: QueryCostOptions = {}, depth = 0): QueryCostEstimate {
  const sql = stripQuotes(query).replace(/\s+/g, ' ').trim()
  const lower = sql.toLowerCase()
  const byName = new Map(schema.tables.map((t) => [t.name.toLowerCase(), t]))
  const notes: string[] = []
  const viewsByName = new Map((schema.views ?? []).map((v) => [v.name.toLowerCase(), v]))
  let viewCost = 0

  // alias → tabla
  const aliases = new Map<string, Table>()
  const order: Table[] = []
  const refRe = /\b(from|join|update|into|delete from)\s+([a-z_][\w.]*)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi
  const reserved = new Set(['where', 'join', 'inner', 'left', 'right', 'full', 'on', 'group', 'order', 'limit', 'set', 'values', 'using', 'cross', 'outer'])
  for (const m of sql.matchAll(refRe)) {
    const name = m[2].split('.').pop()!.toLowerCase()
    const t = byName.get(name)
    if (!t) {
      const view = viewsByName.get(name)
      if (view && depth < 3) {
        if (view.materialized) {
          viewCost += Math.max(20, (opts.defaultRows ?? DEFAULT_ROWS) / 50) * 0.0005 + 0.05
          notes.push(`Vista materializada ${view.name}: lectura de datos precalculados (requiere REFRESH).`)
        } else {
          const inner = estimateQueryCost(schema, view.definition, opts, depth + 1)
          viewCost += inner.avgMs
          notes.push(`Vista ${view.name}: se expande su definición (${inner.joins} JOIN).`)
        }
      }
      continue
    }
    aliases.set(name, t)
    if (m[3] && !reserved.has(m[3].toLowerCase())) aliases.set(m[3].toLowerCase(), t)
    if (!order.includes(t)) order.push(t)
  }
  if (!order.length && !viewCost && schema.tables.length) {
    notes.push('No se reconocieron tablas del esquema en la consulta; se asume un recorrido de la tabla mayor.')
  }

  const resolve = (ref: string): { table?: Table; column: string } => {
    const parts = ref.toLowerCase().split('.')
    if (parts.length === 2) return { table: aliases.get(parts[0]), column: parts[1] }
    const column = parts[0]
    return { table: order.find((t) => t.columns.some((c) => c.name.toLowerCase() === column)), column }
  }

  // Joins: ON a.x = b.y
  const joins = (lower.match(/\bjoin\b/g) ?? []).length
  let unindexedJoins = 0
  let joinCost = 0
  const onRe = /\bon\s+([\w.]+)\s*=\s*([\w.]+)/gi
  for (const m of sql.matchAll(onRe)) {
    const l = resolve(m[1])
    const r = resolve(m[2])
    const lIdx = l.table ? isIndexed(l.table, l.column) : false
    const rIdx = r.table ? isIndexed(r.table, r.column) : false
    const lRows = l.table ? guessRows(l.table, opts) : DEFAULT_ROWS
    const rRows = r.table ? guessRows(r.table, opts) : DEFAULT_ROWS
    if (lIdx && rIdx) joinCost += 0.04 * Math.log2(Math.max(lRows, rRows) + 1)
    else if (lIdx || rIdx) {
      // Nested loop: un lado indexado, el otro se recorre (o hash join barato).
      const scanned = lIdx ? rRows : lRows
      joinCost += scanned * 0.00025 + 0.3
      const missing = lIdx ? r : l
      notes.push(`Sin índice en ${missing.table?.name ?? '?'}.${missing.column} (JOIN): recorrido de ~${scanned.toLocaleString('es')} filas.`)
    } else {
      unindexedJoins++
      joinCost += (lRows + rRows) * 0.0006 + 1
      notes.push(`JOIN sin índices en ${l.table?.name ?? '?'}.${l.column} ni ${r.table?.name ?? '?'}.${r.column}: hash join completo.`)
    }
  }

  // Filtros WHERE: columna = / IN / LIKE
  const seqScans: string[] = []
  let scanCost = 0
  const whereIdx = lower.indexOf(' where ')
  const whereClause = whereIdx >= 0 ? sql.slice(whereIdx + 7) : ''
  const filtered = new Set<Table>()
  if (whereClause) {
    const condRe = /([\w.]+)\s*(=|in\b|like\b|ilike\b|>=|<=|>|<|between\b)\s*('?%?)/gi
    for (const m of whereClause.matchAll(condRe)) {
      const ref = resolve(m[1])
      if (!ref.table) continue
      const op = m[2].toLowerCase()
      const leadingWildcard = (op === 'like' || op === 'ilike') && m[3].includes('%')
      const rows = guessRows(ref.table, opts)
      if (!leadingWildcard && isIndexed(ref.table, ref.column)) {
        scanCost += 0.02 * Math.log2(rows + 1)
      } else {
        scanCost += rows * (leadingWildcard ? 0.0009 : 0.0005)
        seqScans.push(ref.table.name)
        notes.push(
          leadingWildcard
            ? `LIKE con comodín inicial en ${ref.table.name}.${ref.column}: recorrido secuencial (valores no atómicos).`
            : `Filtro sin índice en ${ref.table.name}.${ref.column}: recorrido secuencial de ~${rows.toLocaleString('es')} filas.`,
        )
      }
      filtered.add(ref.table)
    }
  }
  // Sin ningún filtro → recorrido completo de la tabla principal (salvo INSERT o LIMIT).
  const isInsert = /^\s*insert\b/i.test(sql)
  if (!isInsert && order[0] && filtered.size === 0 && !/\blimit\s+\d+/i.test(sql)) {
    const rows = guessRows(order[0], opts)
    scanCost += rows * 0.0005
    seqScans.push(order[0].name)
  }

  // Coste por anchura de fila (tablas sin normalizar con muchas columnas de texto).
  const width = order.reduce((n, t) => n + t.columns.filter((c) => /text|varchar|json/i.test(c.type)).length, 0)
  const widthCost = width * 0.02

  // Escrituras: triggers + mantenimiento de índices.
  let triggersFired = 0
  let writeCost = 0
  const writeKind = isInsert ? 'INSERT' : /^\s*update\b/i.test(sql) ? 'UPDATE' : /^\s*delete\b/i.test(sql) ? 'DELETE' : null
  if (writeKind && order[0]) {
    const target = order[0]
    writeCost += 0.15 + target.indexes.length * 0.05 + target.columns.filter((c) => c.unique || c.pk).length * 0.03
    const fired = schema.triggers.filter((t) => t.tableId === target.id && t.events.includes(writeKind))
    triggersFired = fired.length
    for (const t of fired) {
      const fn = schema.functions.find((f) => f.id === t.functionId)
      const inserts = (fn?.body.match(/\binsert\b/gi) ?? []).length
      writeCost += (t.timing === 'BEFORE' ? 0.05 : 0.12) + inserts * 0.25
    }
    if (fired.length) notes.push(`${fired.length} trigger(s) ${writeKind} en ${target.name} añaden latencia de escritura.`)
  }

  const avgMs = round(0.25 + scanCost + joinCost + widthCost + writeCost + viewCost, 2)
  const variance = 1.35 + 0.15 * joins + 0.2 * seqScans.length + 0.1 * triggersFired
  return {
    avgMs,
    p95Ms: round(avgMs * variance, 2),
    tables: order.map((t) => t.name),
    joins,
    unindexedJoins,
    seqScans: [...new Set(seqScans)],
    triggersFired,
    notes,
  }
}

/**
 * Carga de trabajo sintética para un esquema arbitrario (cuando no hay consultas definidas):
 * una búsqueda por PK por tabla y un JOIN por cada relación.
 */
export function syntheticWorkload(schema: Schema): { label: string; query: string }[] {
  const out: { label: string; query: string }[] = []
  for (const t of schema.tables) {
    const pk = t.columns.find((c) => c.pk) ?? t.columns[0]
    if (!pk) continue
    out.push({ label: `Lectura por PK de ${t.name}`, query: `SELECT * FROM ${t.name} WHERE ${pk.name} = $1` })
  }
  for (const r of schema.relations) {
    const s = schema.tables.find((t) => t.id === r.sourceTableId)
    const t = schema.tables.find((x) => x.id === r.targetTableId)
    const sc = s?.columns.find((c) => c.id === r.sourceColumnId)
    const tc = t?.columns.find((c) => c.id === r.targetColumnId)
    if (!s || !t || !sc || !tc) continue
    out.push({
      label: `${s.name} ⋈ ${t.name}`,
      query: `SELECT * FROM ${s.name} a JOIN ${t.name} b ON a.${sc.name} = b.${tc.name} WHERE a.${sc.name} = $1`,
    })
  }
  for (const v of schema.views ?? []) {
    out.push({ label: `Lectura de la vista ${v.name}`, query: `SELECT * FROM ${v.name} LIMIT 100` })
  }
  return out
}

/** Benchmarks estimados (source 'estimate') para una versión usando consultas dadas o la carga sintética. */
export function estimateVersionBenchmarks(
  version: Version,
  queries: { label: string; query: string }[] = syntheticWorkload(version.schema),
  opts?: QueryCostOptions,
): QueryBenchmark[] {
  return queries.map((q) => {
    const est = estimateQueryCost(version.schema, q.query, opts)
    return {
      versionId: version.id,
      query: q.query,
      label: q.label,
      runs: 1,
      avgMs: est.avgMs,
      p95Ms: est.p95Ms,
      source: 'estimate' as const,
      measuredAt: version.createdAt,
    }
  })
}
