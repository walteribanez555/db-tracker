// Utilidades para vistas: dependencias (FROM/JOIN) y columnas expuestas a partir del SELECT.
// Sin dependencias de runtime (también lo usa el servidor).
import type { Table, View } from '@/types/schema'

export const VIEW_COLOR = '#0d9488'

const IDENT = String.raw`(?:"(?:[^"]|"")+"|\x60[^\x60]+\x60|\[[^\]]+\]|[\w$]+)`
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`

const lastPart = (raw: string): string => {
  const parts = raw.match(new RegExp(IDENT, 'g')) ?? [raw]
  const last = parts[parts.length - 1].trim()
  if (last.startsWith('"')) return last.slice(1, -1).replace(/""/g, '"')
  if (last.startsWith('`') || last.startsWith('[')) return last.slice(1, -1)
  return last
}

/** Nombres (sin esquema) de las relaciones que aparecen tras FROM / JOIN / , en el SELECT. */
export function viewSourceNames(definition: string): string[] {
  const sql = definition.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ')
  const names = new Set<string>()
  const re = new RegExp(String.raw`\b(?:FROM|JOIN)\s+(?!\()(${QNAME})`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(sql))) names.add(lastPart(m[1]))
  // FROM a, b, c (sintaxis antigua): tomamos los identificadores tras comas en la misma cláusula FROM
  const fromList = new RegExp(String.raw`\bFROM\s+([^;]*?)(?:\bWHERE\b|\bGROUP\b|\bORDER\b|\bLIMIT\b|\bJOIN\b|\bUNION\b|\)|$)`, 'gis')
  while ((m = fromList.exec(sql))) {
    for (const part of m[1].split(',').slice(1)) {
      const id = new RegExp(`^\\s*(${QNAME})`).exec(part)
      if (id) names.add(lastPart(id[1]))
    }
  }
  return [...names].filter((n) => !/^(select|lateral|unnest|generate_series)$/i.test(n))
}

/** Resuelve los ids de las tablas/vistas de las que lee la vista. */
export function resolveViewSources(definition: string, tables: Pick<Table, 'id' | 'name'>[], views: Pick<View, 'id' | 'name'>[] = []): string[] {
  const all = [...tables, ...views]
  const ids: string[] = []
  for (const n of viewSourceNames(definition)) {
    const hit = all.find((x) => x.name.toLowerCase() === n.toLowerCase())
    if (hit && !ids.includes(hit.id)) ids.push(hit.id)
  }
  return ids
}

function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(s.slice(start).trim())
  return out.filter(Boolean)
}

/** Lista de SELECT de primer nivel (entre el primer SELECT y su FROM). */
function selectList(definition: string): string | null {
  const s = definition.trim()
  const m = /^\(?\s*(?:WITH\b[\s\S]*?\)\s*)?SELECT\s+(?:DISTINCT\s+(?:ON\s*\([^)]*\)\s*)?)?/i.exec(s)
  if (!m) return null
  let depth = 0
  let quote: string | null = null
  for (let i = m[0].length; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (depth === 0 && /^FROM\b/i.test(s.slice(i, i + 5)) && /\s/.test(s[i - 1] ?? ' ')) return s.slice(m[0].length, i)
  }
  return s.slice(m[0].length)
}

/** Columnas expuestas por la vista, con el tipo cuando la expresión es una columna de una tabla fuente. */
export function inferViewColumns(
  definition: string,
  sources: Pick<Table, 'name' | 'columns'>[],
  explicit?: string[],
): { name: string; type?: string }[] {
  // Alias de FROM/JOIN: "FROM pedidos p JOIN usuarios AS u" → p → pedidos, u → usuarios
  const aliases = new Map<string, string>()
  const KW = /^(ON|USING|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|NATURAL|GROUP|ORDER|LIMIT|HAVING|UNION|WINDOW|LATERAL)$/i
  const are = new RegExp(String.raw`\b(?:FROM|JOIN)\s+(${QNAME})(?:\s+(?:AS\s+)?(${IDENT}))?`, 'gi')
  let am: RegExpExecArray | null
  while ((am = are.exec(definition))) {
    if (am[2] && !KW.test(am[2])) aliases.set(lastPart(am[2]).toLowerCase(), lastPart(am[1]))
  }
  const typeOf = (alias: string | undefined, col: string) => {
    const table = alias ? (aliases.get(alias.toLowerCase()) ?? alias) : undefined
    const cands = table ? sources.filter((t) => t.name.toLowerCase() === table.toLowerCase()) : sources
    for (const t of cands.length ? cands : sources) {
      const c = t.columns.find((x) => x.name.toLowerCase() === col.toLowerCase())
      if (c) return c.type
    }
    return undefined
  }
  const list = selectList(definition)
  const items = list ? splitTopLevel(list) : []
  const out: { name: string; type?: string }[] = []
  items.forEach((item, i) => {
    const star = new RegExp(`^(?:(${IDENT})\\s*\\.\\s*)?\\*$`).exec(item)
    if (star) {
      const tname = star[1] ? (aliases.get(lastPart(star[1]).toLowerCase()) ?? lastPart(star[1])) : undefined
      const ts = tname ? sources.filter((t) => t.name.toLowerCase() === tname.toLowerCase()) : sources
      for (const t of ts) for (const c of t.columns) out.push({ name: c.name, type: c.type })
      return
    }
    const am = new RegExp(`\\s+(AS\\s+)?(${IDENT})$`, 'i').exec(item)
    // "a + b" no es un alias: sin AS, la expresión no puede terminar en operador.
    const alias = am && (am[1] || !/[-+*/|=<>%(,]\s*$/.test(item.slice(0, am.index))) && !/^(END|ELSE|THEN)$/i.test(am[2]) ? am : null
    const expr = alias ? item.slice(0, alias.index) : item
    const ref = new RegExp(`^(?:(${IDENT})\\s*\\.\\s*)?(${IDENT})$`).exec(expr.trim())
    const cast = /::\s*([\w\s]+(?:\([^)]*\))?)\s*$/.exec(expr)
    if (ref && !alias) {
      const col = lastPart(ref[2])
      out.push({ name: col, type: typeOf(ref[1] ? lastPart(ref[1]) : undefined, col) })
    } else if (alias) {
      const type =
        cast?.[1]?.trim() ??
        (ref ? typeOf(ref[1] ? lastPart(ref[1]) : undefined, lastPart(ref[2])) : undefined) ??
        (/^\s*count\s*\(/i.test(expr) ? 'bigint' : undefined)
      out.push({ name: lastPart(alias[2]), type })
    } else {
      out.push({ name: `columna_${i + 1}` })
    }
  })
  if (explicit?.length) return explicit.map((name, i) => ({ name, type: out[i]?.type }))
  return out
}

/** Orden de creación de vistas respetando dependencias entre ellas. */
export function orderViews<V extends Pick<View, 'id' | 'sourceIds'>>(views: V[]): V[] {
  const out: V[] = []
  const state = new Map<string, number>()
  const byId = new Map(views.map((v) => [v.id, v]))
  const visit = (v: V) => {
    if (state.get(v.id)) return
    state.set(v.id, 1)
    for (const s of v.sourceIds) {
      const dep = byId.get(s)
      if (dep) visit(dep)
    }
    state.set(v.id, 2)
    out.push(v)
  }
  views.forEach(visit)
  return out
}
