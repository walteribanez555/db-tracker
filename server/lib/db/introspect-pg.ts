// Introspección de PostgreSQL vía pg_catalog → Schema.
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
  View,
} from '../../../src/types/schema.ts'
import type { DbClient } from './client.ts'
import { phaseTimer } from './phases.ts'
import { LIMITS } from './validation.ts'

const uid = (p: string) => `${p}${nanoid(10)}`

const ACTION: Record<string, ReferentialAction> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }

const NOT_EXTENSION = (col: string) =>
  `NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = ${col} AND dep.deptype = 'e')`

/** Limpia defaults: 'x'::character varying → 'x' (mantiene casts a enums). */
function cleanDefault(def: string | null): string | undefined {
  if (def === null || def === undefined) return undefined
  const m = /^('(?:[^']|'')*')::(?:character varying|text|bpchar|varchar|character)(\[\])?$/.exec(def)
  return m ? m[1] : def
}

/** Extrae la condición WHEN (...) de pg_get_triggerdef. */
function triggerCondition(def: string): string | undefined {
  const i = def.search(/\bWHEN\s*\(/i)
  if (i < 0) return undefined
  const open = def.indexOf('(', i)
  let depth = 0
  for (let j = open; j < def.length; j++) {
    if (def[j] === '(') depth++
    else if (def[j] === ')' && --depth === 0) return def.slice(open + 1, j).trim()
  }
  return undefined
}

export async function introspectPostgres(client: DbClient, schemaName = 'public') {
  const warnings: string[] = []
  const s = [schemaName]
  const timer = phaseTimer()

  const tablesQ = await client.query<{ oid: string; name: string; comment: string | null; kind: string; rows: number }>(
    `SELECT c.oid::text AS oid, c.relname AS name, obj_description(c.oid, 'pg_class') AS comment, c.relkind AS kind,
            GREATEST(c.reltuples, 0)::bigint AS rows
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m') AND NOT c.relispartition AND ${NOT_EXTENSION('c.oid')}
      ORDER BY c.relname
      LIMIT ${LIMITS.maxTables + 1}`,
    s,
  )
  timer.mark('tables')
  if (tablesQ.rows.length > LIMITS.maxTables) warnings.push(`El esquema tiene más de ${LIMITS.maxTables} objetos: se importan solo los primeros.`)
  const rels = tablesQ.rows.slice(0, LIMITS.maxTables)

  const columnsQ = await client.query<{
    table_oid: string
    attnum: number
    name: string
    type: string
    not_null: boolean
    def: string | null
    identity: string
    generated: string
    comment: string | null
    typtype: string
    typname: string
  }>(
    `SELECT a.attrelid::text AS table_oid, a.attnum::int AS attnum, a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null,
            pg_get_expr(d.adbin, d.adrelid) AS def, a.attidentity::text AS identity, a.attgenerated::text AS generated,
            col_description(a.attrelid, a.attnum) AS comment, t.typtype::text AS typtype, t.typname AS typname
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m') AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attrelid, a.attnum`,
    s,
  )

  const enumsQ = await client.query<{ name: string; values: string[] }>(
    `SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS values
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 OR t.oid IN (
            SELECT a.atttypid FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE n2.nspname = $1)
      GROUP BY t.typname ORDER BY t.typname`,
    s,
  )
  timer.mark('columns')

  const consQ = await client.query<{
    name: string
    type: string
    table_oid: string
    cols: number[]
    ref_oid: string
    ref_cols: number[] | null
    on_delete: string
    on_update: string
  }>(
    `SELECT con.conname AS name, con.contype::text AS type, con.conrelid::text AS table_oid, con.conkey::int[] AS cols,
            con.confrelid::text AS ref_oid, con.confkey::int[] AS ref_cols,
            con.confdeltype::text AS on_delete, con.confupdtype::text AS on_update
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND con.contype IN ('p','u','f')
      ORDER BY con.conname`,
    s,
  )
  timer.mark('keys')

  const idxQ = await client.query<{ name: string; table_oid: string; is_unique: boolean; cols: number[]; skip: boolean }>(
    `SELECT ic.relname AS name, i.indrelid::text AS table_oid, i.indisunique AS is_unique,
            string_to_array(i.indkey::text, ' ')::int[] AS cols,
            (i.indisprimary OR i.indexprs IS NOT NULL OR i.indpred IS NOT NULL
             OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conindid = i.indexrelid AND k.contype IN ('p','u','x'))) AS skip
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND t.relkind IN ('r','p')
      ORDER BY ic.relname`,
    s,
  )
  timer.mark('indexes')

  const viewsQ = await client.query<{ oid: string; definition: string }>(
    `SELECT c.oid::text AS oid, pg_get_viewdef(c.oid, true) AS definition
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('v','m')`,
    s,
  )
  const viewDepsQ = await client.query<{ view_oid: string; source_oid: string }>(
    `SELECT DISTINCT v.oid::text AS view_oid, d.refobjid::text AS source_oid
       FROM pg_class v
       JOIN pg_namespace n ON n.oid = v.relnamespace
       JOIN pg_rewrite r ON r.ev_class = v.oid
       JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
      WHERE n.nspname = $1 AND v.relkind IN ('v','m') AND d.refobjid <> v.oid`,
    s,
  )
  timer.mark('views')

  const trigQ = await client.query<{ name: string; table_oid: string; fn_oid: string; type: number; def: string; enabled: string }>(
    `SELECT t.tgname AS name, t.tgrelid::text AS table_oid, t.tgfoid::text AS fn_oid, t.tgtype::int AS type,
            pg_get_triggerdef(t.oid, true) AS def, t.tgenabled::text AS enabled
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND NOT t.tgisinternal
      ORDER BY t.tgname`,
    s,
  )

  const fnQ = await client.query<{ oid: string; name: string; language: string; args: string; returns: string; body: string; comment: string | null }>(
    `SELECT p.oid::text AS oid, p.proname AS name, l.lanname AS language, pg_get_function_arguments(p.oid) AS args,
            pg_get_function_result(p.oid) AS returns, p.prosrc AS body, obj_description(p.oid, 'pg_proc') AS comment
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_language l ON l.oid = p.prolang
      WHERE l.lanname IN ('plpgsql','sql') AND p.prokind = 'f' AND ${NOT_EXTENSION('p.oid')}
        AND (n.nspname = $1 OR p.oid IN (
              SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n2 ON n2.oid = c.relnamespace WHERE n2.nspname = $1 AND NOT t.tgisinternal))
      ORDER BY p.proname
      LIMIT 500`,
    s,
  )
  timer.mark('routines')

  // --- Construcción del Schema ---------------------------------------------
  const enumNames = new Set(enumsQ.rows.map((e) => e.name))
  const enums: EnumType[] = enumsQ.rows.map((e) => ({ id: uid('enum_'), name: e.name, values: e.values }))

  const colsByTable = new Map<string, typeof columnsQ.rows>()
  for (const c of columnsQ.rows) {
    if (!colsByTable.has(c.table_oid)) colsByTable.set(c.table_oid, [])
    colsByTable.get(c.table_oid)!.push(c)
  }

  const tableByOid = new Map<string, Table>()
  const colByAttnum = new Map<string, Column>() // `${oid}:${attnum}`
  const rowEstimates: Record<string, number> = {}
  const tables: Table[] = []
  const views: View[] = []
  const viewByOid = new Map<string, View>()

  for (const r of rels) {
    const cols = colsByTable.get(r.oid) ?? []
    if (r.kind === 'v' || r.kind === 'm') {
      const v: View = {
        id: uid('view_'),
        name: r.name,
        definition: '',
        materialized: r.kind === 'm',
        sourceIds: [],
        columns: cols.map((c) => ({ name: c.name, type: c.typtype === 'e' ? c.typname : normalizeType(c.type).type })),
        color: VIEW_COLOR,
        ...(r.comment ? { comment: r.comment } : {}),
        position: { x: 0, y: 0 },
      }
      views.push(v)
      viewByOid.set(r.oid, v)
      continue
    }
    const table: Table = {
      id: uid('tbl_'),
      name: r.name,
      color: IMPORT_TABLE_COLORS[tables.length % IMPORT_TABLE_COLORS.length],
      ...(r.comment ? { comment: r.comment } : {}),
      columns: [],
      indexes: [],
      position: { x: 0, y: 0 },
    }
    rowEstimates[r.name] = Number(r.rows) || 0
    for (const c of cols) {
      const nt = c.typtype === 'e' || enumNames.has(c.typname) ? { type: c.typname, autoIncrement: false } : normalizeType(c.type)
      const isSerial = !!c.def && /^nextval\(/i.test(c.def)
      const col: Column = {
        id: uid('col_'),
        name: c.name,
        type: nt.type,
        pk: false,
        nullable: !c.not_null,
        unique: false,
        autoIncrement: isSerial || c.identity === 'a' || c.identity === 'd',
        ...(!isSerial && c.def && c.generated !== 's' ? { default: cleanDefault(c.def) } : {}),
        ...(c.comment ? { comment: c.comment } : {}),
      }
      if (c.generated === 's') warnings.push(`Columna generada ${r.name}.${c.name}: se importa como columna normal.`)
      table.columns.push(col)
      colByAttnum.set(`${r.oid}:${c.attnum}`, col)
    }
    tables.push(table)
    tableByOid.set(r.oid, table)
  }

  // PK / UNIQUE / FK
  const relations: Relation[] = []
  for (const con of consQ.rows) {
    const table = tableByOid.get(con.table_oid)
    if (!table) continue
    const cols = (con.cols ?? []).map((n) => colByAttnum.get(`${con.table_oid}:${n}`)).filter((c): c is Column => !!c)
    if (con.type === 'p') {
      for (const c of cols) {
        c.pk = true
        c.nullable = false
      }
    } else if (con.type === 'u') {
      if (cols.length === 1) cols[0].unique = true
      else if (cols.length) table.indexes.push({ id: uid('idx_'), name: con.name, columnIds: cols.map((c) => c.id), unique: true })
    } else if (con.type === 'f') {
      const ref = tableByOid.get(con.ref_oid)
      if (!ref) {
        warnings.push(`FK ${con.name} de ${table.name} apunta a una tabla fuera del esquema ${schemaName}; se omite.`)
        continue
      }
      const refCols = (con.ref_cols ?? []).map((n) => colByAttnum.get(`${con.ref_oid}:${n}`))
      cols.forEach((c, i) => {
        const rc = refCols[i]
        if (!rc) return
        relations.push({
          id: uid('rel_'),
          name: cols.length > 1 && i > 0 ? `${con.name}_${i + 1}` : con.name,
          sourceTableId: ref.id,
          sourceColumnId: rc.id,
          targetTableId: table.id,
          targetColumnId: c.id,
          cardinality: '1:N',
          onDelete: ACTION[con.on_delete] ?? 'NO ACTION',
          onUpdate: ACTION[con.on_update] ?? 'NO ACTION',
        })
      })
    }
  }
  // Cardinalidad (tras conocer PK/UNIQUE)
  for (const r of relations) {
    const t = tables.find((x) => x.id === r.targetTableId)!
    const c = t.columns.find((x) => x.id === r.targetColumnId)!
    if (c.unique || (c.pk && t.columns.filter((x) => x.pk).length === 1)) r.cardinality = '1:1'
  }

  // Índices
  for (const i of idxQ.rows) {
    if (i.skip) continue
    const table = tableByOid.get(i.table_oid)
    if (!table) continue
    if (i.cols.includes(0)) continue
    const ids = i.cols.map((n) => colByAttnum.get(`${i.table_oid}:${n}`)?.id).filter((x): x is string => !!x)
    if (ids.length) table.indexes.push({ id: uid('idx_'), name: i.name, columnIds: ids, unique: i.is_unique })
  }

  // Vistas: definición y dependencias (pg_depend es más fiable que analizar el SQL)
  for (const vq of viewsQ.rows) {
    const v = viewByOid.get(vq.oid)
    if (v) v.definition = (vq.definition ?? '').trim().replace(/;\s*$/, '')
  }
  for (const d of viewDepsQ.rows) {
    const v = viewByOid.get(d.view_oid)
    const src = tableByOid.get(d.source_oid) ?? viewByOid.get(d.source_oid)
    if (v && src && !v.sourceIds.includes(src.id)) v.sourceIds.push(src.id)
  }
  for (const v of views) if (!v.sourceIds.length) v.sourceIds = resolveViewSources(v.definition, tables, views)

  // Funciones y triggers
  const fnByOid = new Map<string, DbFunction>()
  const functions: DbFunction[] = fnQ.rows.map((f) => {
    const fn: DbFunction = {
      id: uid('fn_'),
      name: f.name,
      language: f.language === 'sql' ? 'sql' : 'plpgsql',
      args: f.args ?? '',
      returns: f.returns ?? 'trigger',
      body: (f.body ?? '').replace(/^\n+|\s+$/g, ''),
      ...(f.comment ? { comment: f.comment } : {}),
      position: { x: 0, y: 0 },
    }
    fnByOid.set(f.oid, fn)
    return fn
  })
  const triggers: Trigger[] = []
  for (const t of trigQ.rows) {
    const table = tableByOid.get(t.table_oid)
    const fn = fnByOid.get(t.fn_oid)
    if (!table || !fn) {
      warnings.push(`Trigger ${t.name}: ${!table ? 'está sobre una vista' : 'su función no es plpgsql/sql'}; se omite.`)
      continue
    }
    const events: TriggerEvent[] = []
    if (t.type & 4) events.push('INSERT')
    if (t.type & 16) events.push('UPDATE')
    if (t.type & 8) events.push('DELETE')
    if (t.type & 32) events.push('TRUNCATE')
    const cond = triggerCondition(t.def)
    triggers.push({
      id: uid('trg_'),
      name: t.name,
      tableId: table.id,
      functionId: fn.id,
      timing: t.type & 64 ? 'INSTEAD OF' : t.type & 2 ? 'BEFORE' : 'AFTER',
      events,
      level: t.type & 1 ? 'ROW' : 'STATEMENT',
      ...(cond ? { condition: cond } : {}),
      // tgenabled: 'O' (origen), 'D' (desactivado), 'R' (réplica), 'A' (siempre)
      ...(t.enabled === 'D' ? { enabled: false } : {}),
      position: { x: 0, y: 0 },
    })
  }

  const schema: Schema = { dialect: 'postgresql', tables, views, relations, enums, functions, triggers, notes: [] }
  gridLayout(schema)
  timer.mark('build')
  return { schema, warnings, rowEstimates, phases: timer.phases }
}
