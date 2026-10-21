// Exportador Mermaid erDiagram.
import type { Schema } from '@/types/schema'

import { resolveRelations } from './dialects'

const entity = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
const attrName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
/** Mermaid no admite espacios ni comas en el tipo. */
const attrType = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, '_')
    .replace(/,/g, '-')
    .replace(/[^A-Za-z0-9_()[\]-]/g, '')
const label = (s: string) => s.replace(/"/g, "'")

export function generateMermaid(schema: Schema): string {
  const lines: string[] = ['erDiagram']
  const fkCols = new Set(schema.relations.map((r) => r.targetColumnId))
  for (const t of schema.tables) {
    lines.push(`  ${entity(t.name)} {`)
    for (const c of t.columns) {
      const keys: string[] = []
      if (c.pk) keys.push('PK')
      if (fkCols.has(c.id)) keys.push('FK')
      if (c.unique && !c.pk) keys.push('UK')
      const comment = c.comment ? ` "${label(c.comment)}"` : ''
      lines.push(`    ${attrType(c.type) || 'unknown'} ${attrName(c.name)}${keys.length ? ' ' + keys.join(', ') : ''}${comment}`)
    }
    lines.push('  }')
  }
  // Vistas: entidad con sufijo _vista (o _vista_mat) y líneas punteadas hacia sus fuentes.
  const viewEntity = (v: { name: string; materialized: boolean }) => `${entity(v.name)}_${v.materialized ? 'vista_mat' : 'vista'}`
  for (const v of schema.views ?? []) {
    lines.push(`  ${viewEntity(v)} {`)
    for (const c of v.columns) lines.push(`    ${attrType(c.type ?? 'columna') || 'columna'} ${attrName(c.name)}`)
    if (!v.columns.length) lines.push('    vista definicion')
    lines.push('  }')
  }
  for (const v of schema.views ?? []) {
    for (const sid of v.sourceIds) {
      const t = schema.tables.find((x) => x.id === sid)
      const sv = (schema.views ?? []).find((x) => x.id === sid)
      const src = t ? entity(t.name) : sv ? viewEntity(sv) : null
      if (src) lines.push(`  ${src} ||..o{ ${viewEntity(v)} : "vista"`)
    }
  }
  for (const r of resolveRelations(schema)) {
    const optional = r.targetColumn.nullable
    const left = optional ? '|o' : '||'
    const nm = r.rel.cardinality === 'N:M'
    const right = r.rel.cardinality === '1:1' ? 'o|' : 'o{'
    lines.push(
      `  ${entity(r.source.name)} ${nm ? '}o' : left}--${right} ${entity(r.target.name)} : "${label(r.rel.name || r.targetColumn.name)}"`,
    )
  }
  return lines.join('\n') + '\n'
}
