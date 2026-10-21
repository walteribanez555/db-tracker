import type { Dialect } from '@/types/schema'

export const COMMON_TYPES: Record<Dialect, string[]> = {
  postgresql: [
    'uuid',
    'serial',
    'bigserial',
    'smallint',
    'integer',
    'bigint',
    'numeric(10,2)',
    'real',
    'double precision',
    'boolean',
    'varchar(255)',
    'char(1)',
    'text',
    'date',
    'time',
    'timestamp',
    'timestamptz',
    'interval',
    'json',
    'jsonb',
    'bytea',
    'inet',
  ],
  mysql: [
    'int',
    'bigint',
    'smallint',
    'tinyint(1)',
    'decimal(10,2)',
    'float',
    'double',
    'boolean',
    'char(36)',
    'varchar(255)',
    'text',
    'longtext',
    'date',
    'time',
    'datetime',
    'timestamp',
    'json',
    'blob',
  ],
  sqlite: ['integer', 'real', 'numeric', 'text', 'blob', 'boolean', 'date', 'datetime'],
  sqlserver: [
    'int',
    'bigint',
    'smallint',
    'tinyint',
    'bit',
    'decimal(10,2)',
    'float',
    'money',
    'uniqueidentifier',
    'varchar(255)',
    'nvarchar(255)',
    'nvarchar(max)',
    'text',
    'date',
    'time',
    'datetime2',
    'datetimeoffset',
    'varbinary(max)',
  ],
}

const ALIASES: Record<string, string> = {
  int: 'integer',
  int4: 'integer',
  serial: 'integer',
  serial4: 'integer',
  int8: 'bigint',
  bigserial: 'bigint',
  serial8: 'bigint',
  int2: 'smallint',
  smallserial: 'smallint',
  bool: 'boolean',
  bit: 'boolean',
  'character varying': 'varchar',
  character: 'char',
  float8: 'double precision',
  double: 'double precision',
  float4: 'real',
  decimal: 'numeric',
  'timestamp with time zone': 'timestamptz',
  uniqueidentifier: 'uuid',
}

const parseType = (raw: string) => {
  const t = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  const match = /^([a-z0-9_ ]+?)\s*(\((.*)\))?$/.exec(t)
  const base = match?.[1]?.trim() ?? t
  const params = match?.[3]?.replace(/\s/g, '') ?? ''
  return { base: ALIASES[base] ?? base, params }
}

export type TypeCompatibility = 'ok' | 'similar' | 'mismatch'

export function compareTypes(a: string, b: string): TypeCompatibility {
  const pa = parseType(a)
  const pb = parseType(b)
  if (pa.base !== pb.base) return 'mismatch'
  return pa.params === pb.params ? 'ok' : 'similar'
}

/** Tipo adecuado para una columna FK que referencia a `type` (serial → integer, etc.). */
export function fkTypeFor(type: string): string {
  const t = type.trim().toLowerCase()
  if (t === 'serial' || t === 'serial4') return 'integer'
  if (t === 'bigserial' || t === 'serial8') return 'bigint'
  if (t === 'smallserial') return 'smallint'
  return type
}
