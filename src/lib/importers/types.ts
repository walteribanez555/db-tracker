// Normalización de nombres de tipo SQL (Postgres/MySQL) a una forma corta y legible.
// Sin dependencias de runtime: lo usan el importador SQL y la introspección del servidor.

const TYPE_ALIASES: Record<string, string> = {
  'character varying': 'varchar',
  character: 'char',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  'time without time zone': 'time',
  'time with time zone': 'timetz',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  float8: 'double precision',
  float4: 'real',
}

const unquote = (raw: string) => {
  const parts = raw.match(/"(?:[^"]|"")+"|`[^`]+`|[^."`]+/g) ?? [raw]
  const last = parts[parts.length - 1].trim()
  return /^["`]/.test(last) ? last.slice(1, -1).replace(/""/g, '"') : last
}

export function normalizeType(raw: string): { type: string; autoIncrement: boolean } {
  let t = raw.trim().replace(/\s+/g, ' ')
  if (/^"/.test(t) || /^[\w$]+\."/.test(t)) return { type: unquote(t), autoIncrement: false }
  const low = t.toLowerCase()
  if (/^(small|big)?serial[248]?$/.test(low)) {
    const type = low.startsWith('big') || low === 'serial8' ? 'bigint' : low.startsWith('small') || low === 'serial2' ? 'smallint' : 'integer'
    return { type, autoIncrement: true }
  }
  if (/^tinyint\s*\(\s*1\s*\)/.test(low)) return { type: 'boolean', autoIncrement: false }
  // int(11) → int (ancho de visualización de MySQL)
  t = t.replace(/^((?:tiny|small|medium|big)?int(?:eger)?)\s*\(\s*\d+\s*\)/i, '$1')
  // "timestamp(3) with time zone" → base "timestamp with time zone", args "(3)"
  let array = false
  if (t.endsWith('[]')) {
    array = true
    t = t.slice(0, -2).trim()
  }
  const am = /\(([^)]*)\)/.exec(t)
  const args = am ? `(${am[1].replace(/\s+/g, '')})` : ''
  let rest = (am ? `${t.slice(0, am.index)} ${t.slice(am.index + am[0].length)}` : t).toLowerCase()
  const unsigned = /\bunsigned\b/.test(rest)
  rest = rest.replace(/\b(unsigned|zerofill)\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^[a-z][a-z0-9_ ]*$/.test(rest)) {
    const alias = TYPE_ALIASES[rest] ?? rest
    return { type: `${alias}${args}${unsigned ? ' unsigned' : ''}${array ? '[]' : ''}`, autoIncrement: false }
  }
  return { type: t.includes('.') ? unquote(t) : t, autoIncrement: false }
}
