// Análisis heurístico de la definición SQL de una vista: tablas y columnas que referencia.
import type { Schema, View } from '@/types/schema'

export interface ViewProblem {
  kind: 'missing-source' | 'missing-table' | 'missing-column'
  /** Tabla/vista o "alias.columna" afectada. */
  ref: string
  /** Id de la tabla de la que falta la columna (si se conoce). */
  tableId?: string
}

const KEYWORDS = new Set(
  'where join on left right inner outer full cross natural using union intersect except group order limit offset having window as lateral select from and or not'.split(
    ' ',
  ),
)

const clean = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")

const unquote = (s: string) => s.trim().replace(/^"|"$/g, '')

interface Rel {
  id: string
  name: string
  /** null cuando no conocemos las columnas (vista sin columnas declaradas). */
  columns: string[] | null
}

function resolve(schema: Schema, name: string): Rel | undefined {
  const lower = name.toLowerCase()
  const t = schema.tables.find((x) => x.name.toLowerCase() === lower)
  if (t) return { id: t.id, name: t.name, columns: t.columns.map((c) => c.name.toLowerCase()) }
  const v = (schema.views ?? []).find((x) => x.name.toLowerCase() === lower)
  if (v) return { id: v.id, name: v.name, columns: v.columns.length ? v.columns.map((c) => c.name.toLowerCase()) : null }
  return undefined
}

/** Divide por comas de nivel superior (fuera de paréntesis). */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

export function checkView(view: View, schema: Schema): ViewProblem[] {
  const problems: ViewProblem[] = []
  for (const id of view.sourceIds)
    if (!schema.tables.some((t) => t.id === id) && !(schema.views ?? []).some((v) => v.id === id))
      problems.push({ kind: 'missing-source', ref: id })

  const sql = clean(view.definition)
  if (!sql.trim()) return problems

  // CTEs: WITH nombre AS ( … )
  const ctes = new Set([...sql.matchAll(/(?:\bWITH|,)\s+(?:RECURSIVE\s+)?("?[A-Za-z_]\w*"?)\s+AS\s*\(/gi)].map((m) => unquote(m[1]).toLowerCase()))

  const aliases = new Map<string, Rel>()
  const refs: Rel[] = []
  const FROM_RE = /\b(FROM|JOIN)\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)(\s*\()?(?:\s+(?:AS\s+)?("?[A-Za-z_]\w*"?))?/gi
  for (const m of sql.matchAll(FROM_RE)) {
    if (m[3]) continue // función: FROM generate_series(…)
    const before = sql.slice(Math.max(0, m.index - 40), m.index)
    if (/\b(EXTRACT|SUBSTRING|TRIM|OVERLAY|POSITION)\s*\([^()]*$/i.test(before)) continue
    const name = unquote(m[2].split('.').pop()!)
    if (ctes.has(name.toLowerCase())) continue
    const rel = resolve(schema, name)
    if (!rel) {
      if (!problems.some((p) => p.ref === name)) problems.push({ kind: 'missing-table', ref: name })
      continue
    }
    refs.push(rel)
    aliases.set(rel.name.toLowerCase(), rel)
    const alias = m[4] ? unquote(m[4]).toLowerCase() : undefined
    if (alias && !KEYWORDS.has(alias)) aliases.set(alias, rel)
  }

  // Referencias calificadas alias.columna
  for (const m of sql.matchAll(/(?<![\w."])("?[A-Za-z_]\w*"?)\s*\.\s*("?[A-Za-z_]\w*"?|\*)/g)) {
    const q = unquote(m[1]).toLowerCase()
    const col = unquote(m[2]).toLowerCase()
    const rel = aliases.get(q)
    if (!rel || col === '*' || !rel.columns) continue
    // "public.pedidos": el calificador es un esquema, no un alias.
    if (resolve(schema, col)?.id === rel.id) continue
    if (!rel.columns.includes(col) && !problems.some((p) => p.ref === `${m[1]}.${m[2]}`))
      problems.push({ kind: 'missing-column', ref: `${unquote(m[1])}.${unquote(m[2])}`, tableId: rel.id })
  }

  // Con una sola fuente, comprobamos también las columnas sin calificar de la lista SELECT.
  const unique = [...new Map(refs.map((r) => [r.id, r])).values()]
  const single = unique.length === 1 ? unique[0] : undefined
  const singleCols = single?.columns
  if (single && singleCols) {
    const rel = single
    const select = /^\s*SELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\s+FROM\b/i.exec(sql)
    if (select)
      for (const item of splitTopLevel(select[1])) {
        const noAs = item.trim().replace(/\s+AS\s+"?[A-Za-z_]\w*"?\s*$/i, '')
        const m = /^("?[A-Za-z_]\w*"?)(?:\s+"?[A-Za-z_]\w*"?)?$/.exec(noAs)
        if (!m) continue
        const expr = m[1]
        const col = unquote(expr).toLowerCase()
        if (KEYWORDS.has(col) || ['true', 'false', 'null', 'now', 'current_date', 'current_timestamp', 'current_user'].includes(col)) continue
        if (!singleCols.includes(col) && !problems.some((p) => p.ref === `${rel.name}.${col}`))
          problems.push({ kind: 'missing-column', ref: `${rel.name}.${unquote(expr)}`, tableId: rel.id })
      }
  }
  return problems
}

/** ¿Se usa la vista desde otra vista, una función o un trigger? */
export function isViewUsed(view: View, schema: Schema): boolean {
  const re = new RegExp(`\\b${view.name.replace(/[^\w]/g, '')}\\b`, 'i')
  if ((schema.views ?? []).some((v) => v.id !== view.id && (v.sourceIds.includes(view.id) || re.test(clean(v.definition))))) return true
  if (schema.functions.some((f) => re.test(clean(f.body)))) return true
  return schema.triggers.some((t) => t.tableId === view.id)
}

/** Ids de las tablas/vistas que aparecen en FROM/JOIN de una definición (para mantener `sourceIds`). */
export function parseViewSources(definition: string, schema: Schema, selfId?: string): string[] {
  const sql = clean(definition)
  const ids: string[] = []
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)(\s*\()?/gi)) {
    if (m[2]) continue
    const before = sql.slice(Math.max(0, m.index - 40), m.index)
    if (/\b(EXTRACT|SUBSTRING|TRIM|OVERLAY|POSITION)\s*\([^()]*$/i.test(before)) continue
    const rel = resolve(schema, unquote(m[1].split('.').pop()!))
    if (rel && rel.id !== selfId && !ids.includes(rel.id)) ids.push(rel.id)
  }
  return ids
}
