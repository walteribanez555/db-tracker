import type { Schema, View } from '@/types/schema'

const IDENT = String.raw`(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[A-Za-z_][\w$]*)`
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`

const KEYWORDS = new Set([
  'on', 'using', 'where', 'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'natural', 'lateral',
  'group', 'order', 'having', 'limit', 'offset', 'union', 'except', 'intersect', 'window', 'as', 'from', 'select',
  'and', 'or', 'not', 'is', 'null', 'in', 'like', 'between', 'case', 'when', 'then', 'else', 'end', 'with', 'fetch',
])

const unquote = (id: string) => id.trim().replace(/^["`[]|["`\]]$/g, '')
const lastPart = (qualified: string) => unquote(qualified.split('.').at(-1) ?? qualified)

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

/** Recorre `sql` devolviendo, para cada índice, si está a profundidad 0 y fuera de literales. */
function topLevelMask(sql: string): boolean[] {
  const mask: boolean[] = []
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (quote) {
      mask.push(false)
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      mask.push(false)
      continue
    }
    if (ch === '(') depth++
    mask.push(depth === 0 && ch !== ')')
    if (ch === ')') depth = Math.max(0, depth - 1)
  }
  return mask
}

function splitTopLevel(text: string): string[] {
  const mask = topLevelMask(text)
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ',' && mask[i]) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

function findTopLevelKeyword(sql: string, keyword: RegExp, from = 0): number {
  const mask = topLevelMask(sql)
  const re = new RegExp(keyword.source, 'gi')
  re.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) if (mask[m.index]) return m.index
  return -1
}

interface SourceRef {
  name: string
  alias: string | null
}

function parseSources(sql: string): SourceRef[] {
  const refs: SourceRef[] = []
  const alias = String.raw`(?:\s+(?:as\s+)?(?!${[...KEYWORDS].join('\\b|')}\b)(${IDENT}))?`
  const head = new RegExp(String.raw`\b(from|join)\s+(${QUALIFIED})${alias}`, 'gi')
  const more = new RegExp(String.raw`^\s*,\s*(${QUALIFIED})${alias}`, 'i')
  const push = (name: string, alias?: string) => {
    const a = alias && !KEYWORDS.has(alias.toLowerCase()) ? unquote(alias) : null
    refs.push({ name: lastPart(name), alias: a })
  }
  let m: RegExpExecArray | null
  while ((m = head.exec(sql))) {
    if (sql.slice(head.lastIndex).trimStart().startsWith('(')) continue
    if (/\b(extract|substring|trim|overlay|position)\s*\([^()]*$/i.test(sql.slice(0, m.index))) continue
    push(m[2], m[3])
    if (m[1].toLowerCase() !== 'from') continue
    let rest = sql.slice(head.lastIndex)
    let n: RegExpExecArray | null
    while ((n = more.exec(rest))) {
      push(n[1], n[2])
      rest = rest.slice(n[0].length)
    }
  }
  return refs
}

function inferType(expr: string, resolve: (qualifier: string | null, column: string) => string | undefined): string | undefined {
  const e = expr.trim()
  const cast = /::\s*([\w ]+(?:\([^)]*\))?)\s*$/.exec(e) ?? /^cast\s*\(.*\bas\s+([\w ]+(?:\([^)]*\))?)\)$/i.exec(e)
  if (cast) return cast[1].trim().toLowerCase()
  const col = new RegExp(String.raw`^(?:(${IDENT})\s*\.\s*)?(${IDENT})$`).exec(e)
  if (col && !/^\d/.test(e)) return resolve(col[1] ? unquote(col[1]) : null, unquote(col[2]))
  const fn = /^(\w+)\s*\(/.exec(e)?.[1]?.toLowerCase()
  if (fn === 'count') return 'bigint'
  if (fn === 'sum' || fn === 'avg') return 'numeric'
  if (fn === 'now' || fn === 'current_timestamp') return 'timestamptz'
  if (fn === 'bool_and' || fn === 'bool_or' || fn === 'exists') return 'boolean'
  if (fn === 'string_agg' || fn === 'concat' || fn === 'lower' || fn === 'upper') return 'text'
  if (fn === 'json_agg' || fn === 'jsonb_agg' || fn === 'json_build_object' || fn === 'jsonb_build_object') return 'jsonb'
  if ((fn === 'min' || fn === 'max' || fn === 'coalesce') && e.includes('(')) {
    const inner = e.slice(e.indexOf('(') + 1, e.lastIndexOf(')'))
    const first = splitTopLevel(inner)[0]
    return first ? inferType(first, resolve) : undefined
  }
  if (/^'.*'$/.test(e)) return 'text'
  if (/^-?\d+$/.test(e)) return 'integer'
  if (/^-?\d+\.\d+$/.test(e)) return 'numeric'
  if (/^(true|false)$/i.test(e)) return 'boolean'
  return undefined
}

export interface ParsedView {
  sourceIds: string[]
  unknownSources: string[]
  columns: View['columns']
}

/** Parser deliberadamente simple: tablas de FROM/JOIN y lista del SELECT de primer nivel. */
export function parseViewDefinition(definition: string, schema: Schema, selfId?: string): ParsedView {
  const sql = stripComments(definition).replace(/\s+/g, ' ').trim().replace(/;$/, '')
  const refs = parseSources(sql)

  const entities = [
    ...schema.tables.map((t) => ({ id: t.id, name: t.name, columns: t.columns.map((c) => ({ name: c.name, type: c.type as string | undefined })) })),
    ...schema.views.filter((v) => v.id !== selfId).map((v) => ({ id: v.id, name: v.name, columns: v.columns })),
  ]
  const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e]))
  const ctes = new Set([...sql.matchAll(new RegExp(String.raw`(?:with|,)\s*(${IDENT})\s+as\s*\(`, 'gi'))].map((m) => unquote(m[1]).toLowerCase()))

  const sourceIds: string[] = []
  const unknownSources: string[] = []
  const aliases = new Map<string, (typeof entities)[number]>()
  for (const ref of refs) {
    const entity = byName.get(ref.name.toLowerCase())
    if (entity) {
      if (!sourceIds.includes(entity.id)) sourceIds.push(entity.id)
      aliases.set(entity.name.toLowerCase(), entity)
      if (ref.alias) aliases.set(ref.alias.toLowerCase(), entity)
    } else if (!ctes.has(ref.name.toLowerCase()) && !unknownSources.includes(ref.name)) {
      unknownSources.push(ref.name)
    }
  }
  const inScope = sourceIds.map((id) => entities.find((e) => e.id === id)!)

  const resolve = (qualifier: string | null, column: string) => {
    const pool = qualifier ? [aliases.get(qualifier.toLowerCase())].filter((e) => e !== undefined) : inScope
    for (const e of pool) {
      const c = e.columns.find((x) => x.name.toLowerCase() === column.toLowerCase())
      if (c) return c.type
    }
    return undefined
  }

  const columns: View['columns'] = []
  const selectAt = findTopLevelKeyword(sql, /\bselect\b/)
  if (selectAt >= 0) {
    const fromAt = findTopLevelKeyword(sql, /\bfrom\b/, selectAt)
    const list = sql
      .slice(selectAt + 6, fromAt >= 0 ? fromAt : undefined)
      .replace(/^\s*distinct\s+on\s*\([^)]*\)/i, '')
      .replace(/^\s*(distinct|all)\b/i, '')
    splitTopLevel(list).forEach((item, i) => {
      const star = new RegExp(String.raw`^(?:(${IDENT})\s*\.\s*)?\*$`).exec(item)
      if (star) {
        const pool = star[1] ? [aliases.get(unquote(star[1]).toLowerCase())].filter((e) => e !== undefined) : inScope
        pool.forEach((e) => e.columns.forEach((c) => columns.push({ name: c.name, type: c.type })))
        return
      }
      const explicit = new RegExp(String.raw`^(.*?)\s+as\s+(${IDENT})$`, 'i').exec(item)
      const implicit = new RegExp(String.raw`^(.*[\w)\]"'\x60])\s+(${IDENT})$`).exec(item)
      let expr = item
      let name: string
      if (explicit) {
        expr = explicit[1]
        name = unquote(explicit[2])
      } else if (implicit && !KEYWORDS.has(implicit[2].toLowerCase()) && !/[-+*/|=<>]$/.test(implicit[1].trim())) {
        expr = implicit[1]
        name = unquote(implicit[2])
      } else {
        const ref = new RegExp(String.raw`^(?:${IDENT}\s*\.\s*)*(${IDENT})$`).exec(item)
        const fn = /^(\w+)\s*\(/.exec(item)?.[1]
        name = ref ? unquote(ref[1]) : (fn?.toLowerCase() ?? `columna_${i + 1}`)
      }
      columns.push({ name, type: inferType(expr, resolve) })
    })
  }

  return { sourceIds, unknownSources, columns }
}
