// Utilidades por dialecto: comillas, mapeo de tipos, defaults y nombres de restricciones.
// Sin dependencias del DOM: lo compilan tanto la app como el servidor.
import type { Column, Dialect, EnumType, ReferentialAction, Relation, Schema, Table } from '@/types/schema'

export const DIALECT_LABELS: Record<Dialect, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  sqlserver: 'SQL Server',
}

/** Cita un identificador según el dialecto. */
export function quoteIdent(name: string, dialect: Dialect): string {
  switch (dialect) {
    case 'mysql':
      return '`' + name.replace(/`/g, '``') + '`'
    case 'sqlserver':
      return '[' + name.replace(/]/g, ']]') + ']'
    default:
      return '"' + name.replace(/"/g, '""') + '"'
  }
}

/** Literal de texto SQL ('...'). */
export const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`

export interface ParsedType {
  /** Nombre base en minúsculas y sin argumentos: 'varchar', 'double precision'. */
  base: string
  /** Argumentos crudos dentro de los paréntesis (p. ej. '10,2'), si los hay. */
  args?: string
  /** Sufijo de array de Postgres ('[]'). */
  array: boolean
}

export function parseType(raw: string): ParsedType {
  let t = raw.trim()
  let array = false
  if (t.endsWith('[]')) {
    array = true
    t = t.slice(0, -2).trim()
  }
  const m = /^([^()]*?)\s*(?:\((.*)\))?\s*([^()]*)$/.exec(t)
  if (!m) return { base: t.toLowerCase(), array }
  const base = `${m[1]} ${m[3] ?? ''}`.trim().replace(/\s+/g, ' ').toLowerCase()
  return { base, args: m[2]?.trim() || undefined, array }
}

const withArgs = (name: string, args?: string) => (args ? `${name}(${args})` : name)

type Canon =
  | 'smallint'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'real'
  | 'double'
  | 'boolean'
  | 'char'
  | 'varchar'
  | 'text'
  | 'uuid'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'timestamptz'
  | 'json'
  | 'binary'
  | 'other'

const CANON: Record<string, Canon> = {
  smallint: 'smallint', int2: 'smallint', tinyint: 'smallint', smallserial: 'smallint',
  int: 'integer', integer: 'integer', int4: 'integer', mediumint: 'integer', serial: 'integer', serial4: 'integer',
  bigint: 'bigint', int8: 'bigint', bigserial: 'bigint', serial8: 'bigint',
  decimal: 'decimal', numeric: 'decimal', money: 'decimal',
  real: 'real', float4: 'real', float: 'double', float8: 'double', double: 'double', 'double precision': 'double',
  boolean: 'boolean', bool: 'boolean', bit: 'boolean',
  char: 'char', character: 'char', nchar: 'char', bpchar: 'char',
  varchar: 'varchar', 'character varying': 'varchar', nvarchar: 'varchar', varchar2: 'varchar',
  text: 'text', tinytext: 'text', mediumtext: 'text', longtext: 'text', ntext: 'text', citext: 'text', string: 'text', clob: 'text',
  uuid: 'uuid', uniqueidentifier: 'uuid',
  date: 'date',
  time: 'time', 'time without time zone': 'time', timetz: 'time', 'time with time zone': 'time',
  timestamp: 'timestamp', 'timestamp without time zone': 'timestamp', datetime: 'timestamp', datetime2: 'timestamp', smalldatetime: 'timestamp',
  timestamptz: 'timestamptz', 'timestamp with time zone': 'timestamptz', datetimeoffset: 'timestamptz',
  json: 'json', jsonb: 'json',
  bytea: 'binary', blob: 'binary', longblob: 'binary', mediumblob: 'binary', tinyblob: 'binary', binary: 'binary', varbinary: 'binary', image: 'binary',
}

export function canonicalType(raw: string): Canon {
  const { base } = parseType(raw)
  return CANON[base.replace(/ unsigned$/, '')] ?? 'other'
}

export const isSerialType = (raw: string) => /^(small|big)?serial[248]?$/i.test(raw.trim())

/**
 * Traduce un tipo libre al dialecto destino. Los nombres de enum se resuelven aparte
 * (ver `columnTypeSQL`). Lo que no se reconoce se deja tal cual.
 */
export function mapType(raw: string, dialect: Dialect): string {
  const p = parseType(raw)
  const canon = CANON[p.base.replace(/ unsigned$/, '')] ?? 'other'
  const args = p.args
  switch (dialect) {
    case 'postgresql': {
      const out = ((): string => {
        switch (canon) {
          case 'smallint': return 'smallint'
          case 'integer': return 'integer'
          case 'bigint': return 'bigint'
          case 'decimal': return withArgs('numeric', args)
          case 'real': return 'real'
          case 'double': return 'double precision'
          case 'boolean': return 'boolean'
          case 'char': return withArgs('char', args)
          case 'varchar': return args && args.toLowerCase() !== 'max' ? `varchar(${args})` : 'varchar'
          case 'text': return p.base === 'citext' ? 'citext' : 'text'
          case 'uuid': return 'uuid'
          case 'date': return 'date'
          case 'time': return 'time'
          case 'timestamp': return 'timestamp'
          case 'timestamptz': return 'timestamptz'
          case 'json': return p.base === 'json' ? 'json' : 'jsonb'
          case 'binary': return 'bytea'
          default: return raw.replace(/\[\]$/, '')
        }
      })()
      return p.array ? `${out}[]` : out
    }
    case 'mysql':
      switch (canon) {
        case 'smallint': return p.base === 'tinyint' ? withArgs('TINYINT', args) : 'SMALLINT'
        case 'integer': return 'INT'
        case 'bigint': return 'BIGINT'
        case 'decimal': return withArgs('DECIMAL', args)
        case 'real': return 'FLOAT'
        case 'double': return 'DOUBLE'
        case 'boolean': return 'BOOLEAN'
        case 'char': return withArgs('CHAR', args ?? '1')
        case 'varchar': return `VARCHAR(${args && args.toLowerCase() !== 'max' ? args : '255'})`
        case 'text': return ['tinytext', 'mediumtext', 'longtext'].includes(p.base) ? p.base.toUpperCase() : 'TEXT'
        case 'uuid': return 'CHAR(36)'
        case 'date': return 'DATE'
        case 'time': return 'TIME'
        case 'timestamp': return withArgs('DATETIME', args)
        case 'timestamptz': return withArgs('TIMESTAMP', args)
        case 'json': return 'JSON'
        case 'binary': return ['longblob', 'mediumblob', 'tinyblob'].includes(p.base) ? p.base.toUpperCase() : 'BLOB'
        default: return p.array ? 'JSON' : raw
      }
    case 'sqlite':
      switch (canon) {
        case 'smallint':
        case 'integer':
        case 'bigint':
        case 'boolean':
          return 'INTEGER'
        case 'decimal': return 'NUMERIC'
        case 'real':
        case 'double':
          return 'REAL'
        case 'binary': return 'BLOB'
        case 'date':
        case 'time':
        case 'timestamp':
        case 'timestamptz':
          return 'TEXT'
        default: return 'TEXT'
      }
    case 'sqlserver':
      switch (canon) {
        case 'smallint': return 'SMALLINT'
        case 'integer': return 'INT'
        case 'bigint': return 'BIGINT'
        case 'decimal': return withArgs('DECIMAL', args)
        case 'real': return 'REAL'
        case 'double': return 'FLOAT'
        case 'boolean': return 'BIT'
        case 'char': return withArgs('NCHAR', args ?? '1')
        case 'varchar': return `NVARCHAR(${args ?? 'MAX'})`
        case 'text': return 'NVARCHAR(MAX)'
        case 'uuid': return 'UNIQUEIDENTIFIER'
        case 'date': return 'DATE'
        case 'time': return 'TIME'
        case 'timestamp': return 'DATETIME2'
        case 'timestamptz': return 'DATETIMEOFFSET'
        case 'json': return 'NVARCHAR(MAX)'
        case 'binary': return 'VARBINARY(MAX)'
        default: return p.array ? 'NVARCHAR(MAX)' : raw
      }
  }
}

export const findEnum = (schema: Pick<Schema, 'enums'>, type: string): EnumType | undefined => {
  const t = type.trim().replace(/^"|"$/g, '')
  return schema.enums.find((e) => e.name === t || e.name.toLowerCase() === t.toLowerCase())
}

/** Tipo SQL de una columna (resuelve enums y autoincrementos). */
export function columnTypeSQL(schema: Schema, col: Column, dialect: Dialect): string {
  const en = findEnum(schema, col.type)
  if (en) {
    switch (dialect) {
      case 'postgresql': return quoteIdent(en.name, dialect)
      case 'mysql': return `ENUM(${en.values.map(sqlString).join(', ')})`
      case 'sqlite': return 'TEXT'
      case 'sqlserver': return `NVARCHAR(${Math.max(1, ...en.values.map((v) => v.length))})`
    }
  }
  if (dialect === 'postgresql' && col.autoIncrement) {
    // Usamos IDENTITY (estándar SQL) en lugar de serial.
    const c = canonicalType(col.type)
    return c === 'bigint' ? 'bigint' : c === 'smallint' ? 'smallint' : 'integer'
  }
  if (isSerialType(col.type)) {
    const c = canonicalType(col.type)
    return mapType(c === 'bigint' ? 'bigint' : c === 'smallint' ? 'smallint' : 'integer', dialect)
  }
  return mapType(col.type, dialect)
}

/** CHECK para enums en dialectos sin tipo ENUM. */
export function enumCheckSQL(schema: Schema, col: Column, dialect: Dialect): string | null {
  if (dialect !== 'sqlite' && dialect !== 'sqlserver') return null
  const en = findEnum(schema, col.type)
  if (!en) return null
  return `CHECK (${quoteIdent(col.name, dialect)} IN (${en.values.map(sqlString).join(', ')}))`
}

const FUNC_DEFAULTS: Record<string, Partial<Record<Dialect, string | null>>> = {
  'now()': { mysql: 'CURRENT_TIMESTAMP', sqlite: 'CURRENT_TIMESTAMP', sqlserver: 'SYSDATETIME()' },
  current_timestamp: { sqlserver: 'SYSDATETIME()' },
  'gen_random_uuid()': { mysql: '(UUID())', sqlite: null, sqlserver: 'NEWID()' },
  'uuid_generate_v4()': { mysql: '(UUID())', sqlite: null, sqlserver: 'NEWID()' },
  'uuid()': { postgresql: 'gen_random_uuid()', sqlite: null, sqlserver: 'NEWID()' },
  'newid()': { postgresql: 'gen_random_uuid()', mysql: '(UUID())', sqlite: null },
  'getdate()': { postgresql: 'now()', mysql: 'CURRENT_TIMESTAMP', sqlite: 'CURRENT_TIMESTAMP' },
  'sysdatetime()': { postgresql: 'now()', mysql: 'CURRENT_TIMESTAMP', sqlite: 'CURRENT_TIMESTAMP' },
  'current_date': {},
}

/** Adapta un valor DEFAULT al dialecto. Devuelve null si no tiene equivalente. */
export function mapDefault(value: string | undefined, dialect: Dialect, col?: Column): string | null {
  if (value === undefined || value === null) return null
  const v = String(value).trim()
  if (!v) return null
  const key = v.toLowerCase()
  if (key in FUNC_DEFAULTS) {
    const m = FUNC_DEFAULTS[key][dialect]
    return m === undefined ? v : m
  }
  if (key === 'true' || key === 'false') {
    if (dialect === 'sqlite' || dialect === 'sqlserver' || (dialect === 'mysql' && col && canonicalType(col.type) !== 'boolean'))
      return key === 'true' ? '1' : '0'
    return key.toUpperCase()
  }
  if (/^nextval\(/i.test(v)) return null
  // Postgres casts: 'activo'::estado → 'activo' fuera de Postgres.
  if (dialect !== 'postgresql') return v.replace(/::[\w\s"]+(\[\])?$/i, '')
  return v
}

export function referentialSQL(action: ReferentialAction, dialect: Dialect): ReferentialAction | null {
  if (action === 'NO ACTION') return null
  if (dialect === 'sqlserver' && action === 'RESTRICT') return null
  return action
}

const slug = (s: string) => s.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()

/** Nombre determinista de la FK (estable entre exportaciones y migraciones). */
export function relationConstraintName(schema: Pick<Schema, 'tables'>, rel: Relation): string {
  if (rel.name && rel.name.trim()) return rel.name.trim()
  const tgt = schema.tables.find((t) => t.id === rel.targetTableId)
  const tc = tgt?.columns.find((c) => c.id === rel.targetColumnId)
  const src = schema.tables.find((t) => t.id === rel.sourceTableId)
  return `fk_${slug(tgt?.name ?? 't')}_${slug(tc?.name ?? 'c')}_${slug(src?.name ?? 'ref')}`.slice(0, 63)
}

/** Nombre de la restricción UNIQUE de una columna (coincide con el nombre por defecto de Postgres). */
export const uniqueConstraintName = (table: Table, col: Column) => `${table.name}_${col.name}_key`.slice(0, 63)
export const pkConstraintName = (table: Table) => `${table.name}_pkey`.slice(0, 63)

export function indexName(table: Table, idx: { name: string; columnIds: string[]; unique: boolean }): string {
  if (idx.name && idx.name.trim()) return idx.name.trim()
  const cols = idx.columnIds.map((id) => table.columns.find((c) => c.id === id)?.name ?? id)
  return `${idx.unique ? 'ux' : 'ix'}_${slug(table.name)}_${cols.map(slug).join('_')}`.slice(0, 63)
}

export interface ResolvedRelation {
  rel: Relation
  source: Table
  sourceColumn: Column
  target: Table
  targetColumn: Column
}

export function resolveRelations(schema: Schema): ResolvedRelation[] {
  const out: ResolvedRelation[] = []
  for (const rel of schema.relations) {
    const source = schema.tables.find((t) => t.id === rel.sourceTableId)
    const target = schema.tables.find((t) => t.id === rel.targetTableId)
    const sourceColumn = source?.columns.find((c) => c.id === rel.sourceColumnId)
    const targetColumn = target?.columns.find((c) => c.id === rel.targetColumnId)
    if (source && target && sourceColumn && targetColumn) out.push({ rel, source, sourceColumn, target, targetColumn })
  }
  return out
}

export const lineComment = (text: string) =>
  text
    .split('\n')
    .map((l) => `-- ${l}`)
    .join('\n')
