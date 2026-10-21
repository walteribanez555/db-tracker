// Diccionario de datos en Markdown.
import type { Schema } from '@/types/schema'

import { DIALECT_LABELS, indexName, resolveRelations } from './dialects'

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')
const code = (s: string) => '`' + s.replace(/`/g, "'") + '`'
const anchor = (s: string) => s.toLowerCase().replace(/[^\w-]+/g, '-')

export function generateMarkdown(schema: Schema, opts: { title?: string; subtitle?: string } = {}): string {
  const out: string[] = []
  const rels = resolveRelations(schema)
  out.push(`# ${opts.title ?? 'Diccionario de datos'}`)
  if (opts.subtitle) out.push(opts.subtitle)
  out.push(
    [
      `- **Motor:** ${DIALECT_LABELS[schema.dialect]}`,
      `- **Tablas:** ${schema.tables.length}`,
      `- **Vistas:** ${(schema.views ?? []).length}`,
      `- **Relaciones:** ${schema.relations.length}`,
      `- **Enums:** ${schema.enums.length}`,
      `- **Triggers:** ${schema.triggers.length}`,
      `- **Generado:** ${new Date().toLocaleString('es')}`,
    ].join('\n'),
  )

  if (schema.tables.length) {
    out.push('## Índice')
    out.push(schema.tables.map((t) => `- [${t.name}](#${anchor(t.name)})${t.comment ? ` — ${t.comment}` : ''}`).join('\n'))
  }

  for (const t of schema.tables) {
    out.push(`## ${t.name}`)
    if (t.comment) out.push(`> ${t.comment}`)
    const fkByCol = new Map(rels.filter((r) => r.target.id === t.id).map((r) => [r.targetColumn.id, r]))
    const rows = t.columns.map((c) => {
      const keys = [c.pk && 'PK', fkByCol.has(c.id) && 'FK', c.unique && !c.pk && 'UQ', c.autoIncrement && 'AI'].filter(Boolean).join(', ')
      const fk = fkByCol.get(c.id)
      const desc = [c.comment, fk && `→ ${fk.source.name}.${fk.sourceColumn.name}`].filter(Boolean).join(' ')
      return `| ${code(c.name)} | ${code(c.type)} | ${c.nullable && !c.pk ? 'Sí' : 'No'} | ${keys} | ${c.default ? code(c.default) : ''} | ${cell(desc)} |`
    })
    out.push(['| Columna | Tipo | Nulo | Clave | Default | Descripción |', '|---|---|---|---|---|---|', ...rows].join('\n'))

    if (t.indexes.length) {
      out.push('**Índices**')
      out.push(
        t.indexes
          .map((i) => {
            const cols = i.columnIds.map((id) => t.columns.find((c) => c.id === id)?.name ?? '?')
            return `- ${code(indexName(t, i))}${i.unique ? ' (único)' : ''}: ${cols.join(', ')}`
          })
          .join('\n'),
      )
    }

    const related = rels.filter((r) => r.source.id === t.id || r.target.id === t.id)
    if (related.length) {
      out.push('**Relaciones**')
      out.push(
        related
          .map(
            (r) =>
              `- ${r.target.name}.${r.targetColumn.name} → ${r.source.name}.${r.sourceColumn.name} (${r.rel.cardinality}, ON DELETE ${r.rel.onDelete}, ON UPDATE ${r.rel.onUpdate})`,
          )
          .join('\n'),
      )
    }

    const trg = schema.triggers.filter((x) => x.tableId === t.id)
    if (trg.length) {
      out.push('**Triggers**')
      out.push(
        trg
          .map((x) => {
            const fn = schema.functions.find((f) => f.id === x.functionId)
            return `- ${code(x.name)}: ${x.timing} ${x.events.join(' OR ')} FOR EACH ${x.level} → ${fn ? code(fn.name + '()') : '?'}`
          })
          .join('\n'),
      )
    }
  }

  const views = schema.views ?? []
  if (views.length) {
    out.push('## Vistas')
    for (const v of views) {
      out.push(`### ${v.name}${v.materialized ? ' (materializada)' : ''}`)
      if (v.comment) out.push(`> ${v.comment}`)
      const sources = v.sourceIds
        .map((id) => schema.tables.find((t) => t.id === id)?.name ?? views.find((x) => x.id === id)?.name)
        .filter(Boolean)
      if (sources.length) out.push(`**Lee de:** ${sources.map((n) => code(n!)).join(', ')}`)
      if (v.columns.length)
        out.push(['| Columna | Tipo |', '|---|---|', ...v.columns.map((c) => `| ${code(c.name)} | ${c.type ? code(c.type) : ''} |`)].join('\n'))
      out.push('```sql\n' + v.definition.trim() + '\n```')
    }
  }

  if (schema.enums.length) {
    out.push('## Enumeraciones')
    out.push(['| Enum | Valores |', '|---|---|', ...schema.enums.map((e) => `| ${code(e.name)} | ${e.values.map(code).join(', ')} |`)].join('\n'))
  }

  if (schema.functions.length) {
    out.push('## Funciones')
    for (const f of schema.functions) {
      out.push(`### ${f.name}(${f.args})`)
      if (f.comment) out.push(f.comment)
      out.push('```sql\n' + f.body.trim() + '\n```')
    }
  }

  return out.join('\n\n') + '\n'
}
