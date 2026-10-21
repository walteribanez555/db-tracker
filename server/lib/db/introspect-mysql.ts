// Introspección de MySQL/MariaDB vía information_schema → Schema.
import { nanoid } from 'nanoid'

import { gridLayout, IMPORT_TABLE_COLORS } from '../../../src/lib/importers/layout.ts'
import { normalizeType } from '../../../src/lib/importers/types.ts'
import { VIEW_COLOR, resolveViewSources } from '../../../src/lib/importers/views.ts'
import type {
  Column,
  DbFunction,
  EnumType,
  ReferentialAction,
  Relation,
  Schema,
  Table,
  Trigger,
  TriggerEvent,
  TriggerTiming,
  View,
} from '../../../src/types/schema.ts'
import type { DbClient } from './client.ts'
import { phaseTimer } from './phases.ts'
import { LIMITS } from './validation.ts'

const uid = (p: string) => `${p}${nanoid(10)}`

const toAction = (s: string | null): ReferentialAction => {
  const v = (s ?? '').toUpperCase()
  return (['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'] as const).find((a) => a === v) ?? 'NO ACTION'
}

const parseEnumValues = (columnType: string): string[] => {
  const inner = /^enum\((.*)\)$/is.exec(columnType)?.[1] ?? ''
  const out: string[] = []
  const re = /'((?:[^'\\]|''|\\.)*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner))) out.push(m[1].replace(/''/g, "'").replace(/\\(.)/g, '$1'))
  return out
}

/** MySQL 8 devuelve COLUMN_DEFAULT sin comillas para literales; MariaDB los devuelve citados. */
function mysqlDefault(value: string | null, extra: string, dataType: string): string | undefined {
  if (value === null || value === undefined) return undefined
  const v = String(value)
  if (/^NULL$/i.test(v)) return undefined
  if (/DEFAULT_GENERATED/i.test(extra) || /^(CURRENT_TIMESTAMP|NOW|CURRENT_DATE|CURRENT_TIME|LOCALTIMESTAMP)\b/i.test(v) || /\(.*\)/.test(v) && /^\w+\(/.test(v))
    return v
  if (/^'.*'$/s.test(v)) return v
  if (/^-?\d+(\.\d+)?$/.test(v) && !/char|text|enum|set|json|date|time/i.test(dataType)) return v
  if (/^b'[01]+'$/i.test(v)) return v
  return `'${v.replace(/'/g, "''")}'`
}

interface ColRow {
  table_name: string
  column_name: string
  column_type: string
  data_type: string
  is_nullable: string
  column_default: string | null
  extra: string
  column_comment: string
}

export async function introspectMysql(client: DbClient, database: string) {
  const warnings: string[] = []
  const p = [database]
  const timer = phaseTimer()

  const tablesQ = await client.query<{ table_name: string; table_type: string; table_comment: string; table_rows: string | number | null }>(
    `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type, TABLE_COMMENT AS table_comment, TABLE_ROWS AS table_rows
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT ${LIMITS.maxTables + 1}`,
    p,
  )
  timer.mark('tables')
  if (tablesQ.rows.length > LIMITS.maxTables) warnings.push(`La base de datos tiene más de ${LIMITS.maxTables} objetos: se importan solo los primeros.`)

  const colsQ = await client.query<ColRow>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type, DATA_TYPE AS data_type,
            IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, EXTRA AS extra, COLUMN_COMMENT AS column_comment
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    p,
  )
  timer.mark('columns')
  const statsQ = await client.query<{ table_name: string; index_name: string; non_unique: number | string; seq: number; column_name: string | null }>(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq, COLUMN_NAME AS column_name
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    p,
  )
  timer.mark('keys')
  const fkQ = await client.query<{ name: string; tbl: string; col: string; ref_tbl: string; ref_col: string; on_delete: string; on_update: string }>(
    `SELECT k.CONSTRAINT_NAME AS name, k.TABLE_NAME AS tbl, k.COLUMN_NAME AS col, k.REFERENCED_TABLE_NAME AS ref_tbl,
            k.REFERENCED_COLUMN_NAME AS ref_col, r.DELETE_RULE AS on_delete, r.UPDATE_RULE AS on_update
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
      WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    p,
  )
  timer.mark('relations')
  const viewsQ = await client.query<{ name: string; definition: string | null }>(
    `SELECT TABLE_NAME AS name, VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`,
    p,
  )
  timer.mark('views')
  const trigQ = await client.query<{ name: string; event: string; tbl: string; timing: string; body: string; orientation: string }>(
    `SELECT TRIGGER_NAME AS name, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS tbl, ACTION_TIMING AS timing,
            ACTION_STATEMENT AS body, ACTION_ORIENTATION AS orientation
       FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`,
    p,
  )
  timer.mark('routines')

  const colsByTable = new Map<string, ColRow[]>()
  for (const c of colsQ.rows) {
    if (!colsByTable.has(c.table_name)) colsByTable.set(c.table_name, [])
    colsByTable.get(c.table_name)!.push(c)
  }

  const tables: Table[] = []
  const views: View[] = []
  const enums: EnumType[] = []
  const rowEstimates: Record<string, number> = {}
  const viewDefs = new Map(viewsQ.rows.map((v) => [v.name, v.definition ?? '']))

  for (const t of tablesQ.rows.slice(0, LIMITS.maxTables)) {
    const cols = colsByTable.get(t.table_name) ?? []
    if (/VIEW/i.test(t.table_type)) {
      views.push({
        id: uid('view_'),
        name: t.table_name,
        definition: (viewDefs.get(t.table_name) ?? '').trim(),
        materialized: false,
        sourceIds: [],
        columns: cols.map((c) => ({ name: c.column_name, type: normalizeType(c.column_type).type })),
        color: VIEW_COLOR,
        position: { x: 0, y: 0 },
      })
      continue
    }
    const columns: Column[] = cols.map((c) => {
      let type: string
      if (/^enum\(/i.test(c.column_type)) {
        const name = `${t.table_name}_${c.column_name}`
        enums.push({ id: uid('enum_'), name, values: parseEnumValues(c.column_type) })
        type = name
      } else type = normalizeType(c.column_type).type
      const def = mysqlDefault(c.column_default, c.extra ?? '', c.data_type)
      return {
        id: uid('col_'),
        name: c.column_name,
        type,
        pk: false,
        nullable: c.is_nullable === 'YES',
        unique: false,
        autoIncrement: /auto_increment/i.test(c.extra ?? ''),
        ...(def !== undefined ? { default: def } : {}),
        ...(c.column_comment ? { comment: c.column_comment } : {}),
      }
    })
    tables.push({
      id: uid('tbl_'),
      name: t.table_name,
      color: IMPORT_TABLE_COLORS[tables.length % IMPORT_TABLE_COLORS.length],
      ...(t.table_comment ? { comment: t.table_comment } : {}),
      columns,
      indexes: [],
      position: { x: 0, y: 0 },
    })
    rowEstimates[t.table_name] = Number(t.table_rows ?? 0) || 0
  }
  const findTable = (name: string) => tables.find((t) => t.name === name)

  // Índices / PK / UNIQUE
  const groups = new Map<string, { table: string; name: string; unique: boolean; cols: (string | null)[] }>()
  for (const s of statsQ.rows) {
    const key = `${s.table_name}\u0000${s.index_name}`
    if (!groups.has(key)) groups.set(key, { table: s.table_name, name: s.index_name, unique: Number(s.non_unique) === 0, cols: [] })
    groups.get(key)!.cols.push(s.column_name)
  }
  for (const g of groups.values()) {
    const table = findTable(g.table)
    if (!table) continue
    if (g.cols.some((c) => c === null)) continue // índice funcional
    const cols = g.cols.map((n) => table.columns.find((c) => c.name === n)).filter((c): c is Column => !!c)
    if (!cols.length) continue
    if (g.name === 'PRIMARY') {
      for (const c of cols) {
        c.pk = true
        c.nullable = false
      }
    } else if (g.unique && cols.length === 1) {
      cols[0].unique = true
    } else {
      table.indexes.push({ id: uid('idx_'), name: g.name, columnIds: cols.map((c) => c.id), unique: g.unique })
    }
  }

  // FKs
  const relations: Relation[] = []
  const fkCount = new Map<string, number>()
  for (const f of fkQ.rows) {
    const t = findTable(f.tbl)
    const rt = findTable(f.ref_tbl)
    const c = t?.columns.find((x) => x.name === f.col)
    const rc = rt?.columns.find((x) => x.name === f.ref_col)
    if (!t || !rt || !c || !rc) {
      warnings.push(`FK ${f.name} de ${f.tbl} hacia ${f.ref_tbl} no se pudo resolver; se omite.`)
      continue
    }
    const n = (fkCount.get(f.name) ?? 0) + 1
    fkCount.set(f.name, n)
    relations.push({
      id: uid('rel_'),
      name: n > 1 ? `${f.name}_${n}` : f.name,
      sourceTableId: rt.id,
      sourceColumnId: rc.id,
      targetTableId: t.id,
      targetColumnId: c.id,
      cardinality: c.unique || (c.pk && t.columns.filter((x) => x.pk).length === 1) ? '1:1' : '1:N',
      onDelete: toAction(f.on_delete),
      onUpdate: toAction(f.on_update),
    })
  }

  for (const v of views) v.sourceIds = resolveViewSources(v.definition, tables, views)

  // Triggers: en MySQL el cuerpo va dentro del trigger; lo representamos con una función por trigger.
  const functions: DbFunction[] = []
  const triggers: Trigger[] = []
  for (const tr of trigQ.rows) {
    const table = findTable(tr.tbl)
    if (!table) continue
    const fn: DbFunction = {
      id: uid('fn_'),
      name: `${tr.name}_cuerpo`,
      language: 'sql',
      args: '',
      returns: 'trigger',
      body: tr.body ?? '',
      comment: `Cuerpo del trigger MySQL ${tr.name} (importado; MySQL no usa funciones de trigger).`,
      position: { x: 0, y: 0 },
    }
    functions.push(fn)
    triggers.push({
      id: uid('trg_'),
      name: tr.name,
      tableId: table.id,
      functionId: fn.id,
      timing: (tr.timing?.toUpperCase() === 'AFTER' ? 'AFTER' : 'BEFORE') as TriggerTiming,
      events: [tr.event?.toUpperCase() as TriggerEvent].filter((e) => ['INSERT', 'UPDATE', 'DELETE'].includes(e)),
      level: tr.orientation?.toUpperCase() === 'STATEMENT' ? 'STATEMENT' : 'ROW',
      position: { x: 0, y: 0 },
    })
  }
  if (triggers.length) warnings.push('Los triggers de MySQL se importan con su cuerpo como función auxiliar (lenguaje sql).')

  const schema: Schema = { dialect: 'mysql', tables, views, relations, enums, functions, triggers, notes: [] }
  gridLayout(schema)
  timer.mark('build')
  return { schema, warnings, rowEstimates, phases: timer.phases }
}
