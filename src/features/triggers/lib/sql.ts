// SQL de funciones y triggers. Reutilizable por el exportador (src/lib/exporters).
//
// API:
//  - generateFunctionSQL(fn, dialect?)          → CREATE OR REPLACE FUNCTION … (PostgreSQL)
//  - generateSingleTriggerSQL(trigger, schema)  → CREATE TRIGGER … de un trigger
//  - generateTriggerSQL(schema, opts?)          → todos los CREATE TRIGGER (sin funciones por defecto)
//  - generateProceduralSQL(schema, dialect?)    → funciones + triggers en orden de ejecución
//  - generateViewSQL(view, dialect?)            → CREATE [MATERIALIZED] VIEW …
//  - dialectWarnings(schema, dialect)           → avisos de portabilidad (MySQL, SQLite…)
import type { DbFunction, Dialect, Schema, Trigger, View } from '@/types/schema'

const pgIdent = (s: string) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`)
const myIdent = (s: string) => `\`${s.replace(/`/g, '``')}\``

const BODY_START = /^\s*(DECLARE|BEGIN|<<)/i

/** Cuerpo PL/pgSQL listo para el bloque $$: añade BEGIN/END si el usuario solo escribió sentencias. */
function normalizeBody(fn: DbFunction): string {
  const body = fn.body.trim()
  if (fn.language !== 'plpgsql' || !body) return body
  if (BODY_START.test(body)) return body.endsWith(';') ? body : `${body};`
  return `BEGIN\n${indent(body)}\nEND;`
}

const indent = (s: string, pad = '  ') =>
  s
    .split('\n')
    .map((l) => (l.trim() ? pad + l : l))
    .join('\n')

function dollarTag(body: string): string {
  if (!body.includes('$$')) return '$$'
  let i = 0
  while (body.includes(`$fn${i || ''}$`)) i++
  return `$fn${i || ''}$`
}

export function generateFunctionSQL(fn: DbFunction, dialect: Dialect = 'postgresql'): string {
  if (dialect === 'mysql') {
    return [
      `-- MySQL no tiene funciones de trigger: el cuerpo de "${fn.name}" se incrusta en cada CREATE TRIGGER.`,
      `-- Revisa la sintaxis (PL/pgSQL → MySQL): RETURN NEW/NULL no existe, := es SET, RAISE EXCEPTION es SIGNAL SQLSTATE '45000'.`,
    ].join('\n')
  }
  const body = normalizeBody(fn)
  const tag = dollarTag(body)
  const lines: string[] = []
  if (fn.comment) lines.push(...fn.comment.split('\n').map((l) => `-- ${l}`))
  lines.push(`CREATE OR REPLACE FUNCTION ${pgIdent(fn.name)}(${fn.args.trim()})`)
  lines.push(`RETURNS ${fn.returns.trim() || 'trigger'}`)
  lines.push(`LANGUAGE ${fn.language}`)
  lines.push(`AS ${tag}`)
  lines.push(body)
  lines.push(`${tag};`)
  return lines.join('\n')
}

const tableName = (schema: Schema, id: string) =>
  schema.tables.find((t) => t.id === id)?.name ?? (schema.views ?? []).find((v) => v.id === id)?.name ?? 'tabla_desconocida'

/** CREATE VIEW / CREATE MATERIALIZED VIEW. En MySQL las materializadas se emiten como vista normal con aviso. */
export function generateViewSQL(view: View, dialect: Dialect = 'postgresql'): string {
  const def = view.definition.trim().replace(/;\s*$/, '') || 'SELECT 1'
  const lines: string[] = []
  if (view.comment) lines.push(...view.comment.split('\n').map((l) => `-- ${l}`))
  if (dialect === 'mysql') {
    if (view.materialized) lines.push(`-- MySQL no tiene vistas materializadas: se crea como vista normal (o usa una tabla + evento programado).`)
    lines.push(`CREATE OR REPLACE VIEW ${myIdent(view.name)} AS`, `${def};`)
    return lines.join('\n')
  }
  if (dialect === 'sqlserver' || dialect === 'sqlite') {
    if (view.materialized) lines.push(`-- ${dialect === 'sqlite' ? 'SQLite' : 'SQL Server'} no tiene CREATE MATERIALIZED VIEW: se crea como vista normal.`)
    lines.push(`CREATE VIEW ${pgIdent(view.name)} AS`, `${def};`)
    return lines.join('\n')
  }
  if (view.materialized) lines.push(`CREATE MATERIALIZED VIEW ${pgIdent(view.name)} AS`, def, `WITH DATA;`)
  else lines.push(`CREATE OR REPLACE VIEW ${pgIdent(view.name)} AS`, `${def};`)
  return lines.join('\n')
}
const fnOf = (schema: Schema, id: string) => schema.functions.find((f) => f.id === id)

export function generateSingleTriggerSQL(trigger: Trigger, schema: Schema, dialect: Dialect = 'postgresql'): string {
  const fn = fnOf(schema, trigger.functionId)
  const events = trigger.events.length ? trigger.events : (['INSERT'] as Trigger['events'])
  if (dialect === 'mysql') return mysqlTrigger(trigger, schema, fn, events)

  const lines = [
    `CREATE TRIGGER ${pgIdent(trigger.name)}`,
    `  ${trigger.timing} ${events.join(' OR ')} ON ${pgIdent(tableName(schema, trigger.tableId))}`,
    `  FOR EACH ${trigger.level}`,
  ]
  if (trigger.condition?.trim()) lines.push(`  WHEN (${trigger.condition.trim()})`)
  lines.push(`  EXECUTE FUNCTION ${fn ? pgIdent(fn.name) : 'funcion_sin_definir'}();`)
  if (trigger.enabled === false) lines.push(`ALTER TABLE ${pgIdent(tableName(schema, trigger.tableId))} DISABLE TRIGGER ${pgIdent(trigger.name)};`)
  return lines.join('\n')
}

/** Traducción best-effort a MySQL: un trigger por evento con el cuerpo incrustado. */
function mysqlTrigger(trigger: Trigger, schema: Schema, fn: DbFunction | undefined, events: Trigger['events']): string {
  const table = tableName(schema, trigger.tableId)
  const timing = trigger.timing === 'INSTEAD OF' ? 'BEFORE' : trigger.timing
  const raw = (fn?.body ?? '').trim()
  const inner = raw
    .replace(/^\s*BEGIN\s*/i, '')
    .replace(/\s*END\s*;?\s*$/i, '')
    .replace(/^\s*RETURN\s+(NEW|OLD|NULL|COALESCE\([^)]*\))\s*;\s*$/gim, '')
    .replace(/(\bNEW\.\w+)\s*:=/g, 'SET $1 =')
    .replace(/RAISE\s+EXCEPTION\s+'([^']*)'[^;]*;/gi, "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '$1';")
    .trim()
  const out: string[] = []
  if (trigger.enabled === false) out.push(`-- ${trigger.name}: desactivado en la BD; MySQL no permite desactivar triggers (no lo crees o usa una variable de control).`)
  for (const ev of events) {
    if (ev === 'TRUNCATE') {
      out.push(`-- ${trigger.name}: MySQL no admite triggers ON TRUNCATE (omitido).`)
      continue
    }
    const name = events.length > 1 ? `${trigger.name}_${ev.toLowerCase()}` : trigger.name
    out.push(
      [
        'DELIMITER $$',
        `CREATE TRIGGER ${myIdent(name)}`,
        `  ${timing} ${ev} ON ${myIdent(table)}`,
        `  FOR EACH ROW`,
        `BEGIN`,
        trigger.condition?.trim() ? `  -- WHEN (${trigger.condition.trim()}) no existe en MySQL: usa IF … THEN … END IF;` : null,
        indent(inner || '-- (cuerpo vacío)'),
        `END$$`,
        'DELIMITER ;',
      ]
        .filter((l) => l !== null)
        .join('\n'),
    )
  }
  return out.join('\n\n')
}

export interface TriggerSQLOptions {
  dialect?: Dialect
  /** Si es true, antepone las funciones usadas por los triggers. Por defecto false. */
  includeFunctions?: boolean
}

/** CREATE TRIGGER de todo el esquema. Con includeFunctions incluye además las funciones. */
export function generateTriggerSQL(schema: Schema, opts: TriggerSQLOptions = {}): string {
  const dialect = opts.dialect ?? schema.dialect
  const parts: string[] = []
  if (opts.includeFunctions && dialect !== 'mysql') for (const f of schema.functions) parts.push(generateFunctionSQL(f, dialect))
  const triggers = [...schema.triggers].sort(
    (a, b) => tableName(schema, a.tableId).localeCompare(tableName(schema, b.tableId)) || a.name.localeCompare(b.name),
  )
  for (const t of triggers) parts.push(generateSingleTriggerSQL(t, schema, dialect))
  return parts.length ? parts.join('\n\n') + '\n' : ''
}

/** Funciones y triggers listos para ejecutar (funciones primero). */
export function generateProceduralSQL(schema: Schema, dialect: Dialect = schema.dialect): string {
  return generateTriggerSQL(schema, { dialect, includeFunctions: true })
}

/** Avisos de portabilidad del modelo de triggers al dialecto elegido. */
export function dialectWarnings(schema: Schema, dialect: Dialect): string[] {
  const w: string[] = []
  if (dialect === 'postgresql') {
    for (const t of schema.triggers) {
      if (t.timing === 'INSTEAD OF') w.push(`${t.name}: INSTEAD OF solo es válido sobre vistas en PostgreSQL.`)
      if (t.events.includes('TRUNCATE') && t.level === 'ROW') w.push(`${t.name}: TRUNCATE solo admite FOR EACH STATEMENT.`)
      if (t.level === 'STATEMENT' && /\b(NEW|OLD)\./.test(t.condition ?? ''))
        w.push(`${t.name}: un trigger FOR EACH STATEMENT no puede usar NEW/OLD en WHEN.`)
    }
    return w
  }
  if (dialect === 'mysql') {
    w.push('MySQL no separa trigger y función: cada trigger lleva el cuerpo incrustado y se genera uno por evento.')
    if (schema.triggers.some((t) => t.level === 'STATEMENT')) w.push('MySQL solo admite FOR EACH ROW: los triggers STATEMENT se convierten a ROW.')
    if (schema.triggers.some((t) => t.timing === 'INSTEAD OF')) w.push('MySQL no tiene INSTEAD OF: se generan como BEFORE.')
    if (schema.triggers.some((t) => t.condition?.trim())) w.push('MySQL no admite WHEN: traslada la condición a un IF dentro del cuerpo.')
    if (schema.triggers.some((t) => t.events.includes('TRUNCATE'))) w.push('MySQL no tiene triggers ON TRUNCATE.')
    if (schema.functions.some((f) => /TG_OP|TG_TABLE_NAME|to_jsonb|RAISE/i.test(f.body)))
      w.push('El cuerpo usa elementos de PL/pgSQL (TG_OP, TG_TABLE_NAME, to_jsonb, RAISE…) que hay que reescribir a mano.')
    return w
  }
  if (dialect === 'sqlite') w.push('SQLite no tiene funciones PL: los triggers usan bloques BEGIN … END con sentencias SQL simples.')
  if (dialect === 'sqlserver') w.push('SQL Server usa triggers AFTER/INSTEAD OF a nivel de sentencia con las tablas inserted/deleted.')
  return w
}
