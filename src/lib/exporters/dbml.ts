// Exportador DBML (https://dbml.dbdiagram.io/docs).
import type { ReferentialAction, Schema } from '@/types/schema'

import { relationConstraintName, resolveRelations } from './dialects'

const SIMPLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const ident = (s: string) => (SIMPLE.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`)
const str = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

/** Los tipos con espacios o caracteres raros se citan; varchar(255) / numeric(10,2) se dejan tal cual. */
const dbmlType = (t: string) => (/^[A-Za-z_][\w]*(\([\w\s,']*\))?(\[\])?$/.test(t.trim()) ? t.trim() : `"${t.trim().replace(/"/g, '\\"')}"`)

function dbmlDefault(v: string): string {
  const s = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return s
  if (/^(true|false|null)$/i.test(s)) return s.toLowerCase()
  const m = /^'((?:[^']|'')*)'(::[\w\s"]+)?$/.exec(s)
  if (m) return str(m[1].replace(/''/g, "'"))
  return '`' + s.replace(/`/g, '\\`') + '`'
}

const action = (a: ReferentialAction) => a.toLowerCase()

export function generateDBML(schema: Schema, opts: { projectName?: string } = {}): string {
  const out: string[] = []
  if (opts.projectName) {
    const dbType = { postgresql: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', sqlserver: 'SQL Server' }[schema.dialect]
    out.push(`Project ${ident(opts.projectName)} {\n  database_type: ${str(dbType)}\n}`)
  }

  for (const e of schema.enums) {
    out.push(`Enum ${ident(e.name)} {\n${e.values.map((v) => `  ${JSON.stringify(v)}`).join('\n')}\n}`)
  }

  for (const t of schema.tables) {
    const settings: string[] = []
    if (t.color) settings.push(`headercolor: ${t.color}`)
    if (t.comment) settings.push(`note: ${str(t.comment)}`)
    const lines: string[] = []
    const pkCols = t.columns.filter((c) => c.pk)
    for (const c of t.columns) {
      const s: string[] = []
      if (c.pk && pkCols.length === 1) s.push('pk')
      if (c.autoIncrement) s.push('increment')
      if (!c.nullable && !c.pk) s.push('not null')
      if (c.unique && !c.pk) s.push('unique')
      if (c.default !== undefined && c.default !== '') s.push(`default: ${dbmlDefault(c.default)}`)
      if (c.comment) s.push(`note: ${str(c.comment)}`)
      lines.push(`  ${ident(c.name)} ${dbmlType(c.type)}${s.length ? ` [${s.join(', ')}]` : ''}`)
    }
    const idx: string[] = []
    if (pkCols.length > 1) idx.push(`    (${pkCols.map((c) => ident(c.name)).join(', ')}) [pk]`)
    for (const i of t.indexes) {
      const cols = i.columnIds.map((id) => t.columns.find((c) => c.id === id)?.name).filter(Boolean) as string[]
      if (!cols.length) continue
      const s = [i.unique ? 'unique' : '', i.name ? `name: ${str(i.name)}` : ''].filter(Boolean)
      const colsTxt = cols.length === 1 ? ident(cols[0]) : `(${cols.map(ident).join(', ')})`
      idx.push(`    ${colsTxt}${s.length ? ` [${s.join(', ')}]` : ''}`)
    }
    if (idx.length) lines.push('', '  indexes {', ...idx, '  }')
    out.push(`Table ${ident(t.name)}${settings.length ? ` [${settings.join(', ')}]` : ''} {\n${lines.join('\n')}\n}`)
  }

  const refs: string[] = []
  for (const r of resolveRelations(schema)) {
    const src = `${ident(r.source.name)}.${ident(r.sourceColumn.name)}`
    const tgt = `${ident(r.target.name)}.${ident(r.targetColumn.name)}`
    const body =
      r.rel.cardinality === '1:1' ? `${tgt} - ${src}` : r.rel.cardinality === 'N:M' ? `${src} <> ${tgt}` : `${tgt} > ${src}`
    const s: string[] = []
    if (r.rel.onDelete !== 'NO ACTION') s.push(`delete: ${action(r.rel.onDelete)}`)
    if (r.rel.onUpdate !== 'NO ACTION') s.push(`update: ${action(r.rel.onUpdate)}`)
    refs.push(`Ref ${ident(relationConstraintName(schema, r.rel))}: ${body}${s.length ? ` [${s.join(', ')}]` : ''}`)
  }
  if (refs.length) out.push(refs.join('\n'))

  // DBML no tiene vistas: se documentan como notas adhesivas con su definición.
  for (const v of schema.views ?? []) {
    const head = `${v.materialized ? 'Vista materializada' : 'Vista'} ${v.name}${v.comment ? ` — ${v.comment}` : ''}`
    const cols = v.columns.length ? `\nColumnas: ${v.columns.map((c) => (c.type ? `${c.name} (${c.type})` : c.name)).join(', ')}` : ''
    out.push(`Note ${ident(`vista_${v.name}`)} {\n  ${str(`${head}${cols}\n\n${v.definition.trim()}`)}\n}`)
  }

  for (const n of schema.notes) {
    out.push(`Note ${ident(`nota_${n.id.replace(/\W/g, '_')}`)} {\n  ${str(n.text)}\n}`)
  }

  return out.join('\n\n') + '\n'
}
