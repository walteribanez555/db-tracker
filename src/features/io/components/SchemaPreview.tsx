// Vista previa plana de un esquema: cifras y grupos plegables (tablas, vistas, relaciones, triggers, enums).
import { ChevronRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { cn } from '@/lib/utils'
import type { Schema } from '@/types/schema'

import { enterItem, fadeIn, stagger } from '../lib/motion'

const fmtRows = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)} k` : String(n))

export function SchemaStats({ schema }: { schema: Schema }) {
  const items: [string, number][] = [
    ['tablas', schema.tables.length],
    ['vistas', (schema.views ?? []).length],
    ['relaciones', schema.relations.length],
    ['enums', schema.enums.length],
    ['triggers', schema.triggers.length],
    ['funciones', schema.functions.length],
  ]
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1">
      {items.map(([label, n]) => (
        <div key={label} className="flex flex-row-reverse items-baseline justify-end gap-1.5">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          {/* key={n}: la cifra hace fade cuando cambia */}
          <dd key={n} className={cn('text-lg font-semibold tabular-nums', fadeIn)}>
            {n}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Group({ title, count, storageKey, children }: { title: string; count: number; storageKey: string; children: ReactNode }) {
  if (!count) return null
  return (
    <CollapsibleSection title={title} meta={count} storageKey={storageKey} contentClassName="pt-1">
      <ul className="divide-y border-y">{children}</ul>
    </CollapsibleSection>
  )
}

export function SchemaPreview({
  schema,
  rowEstimates,
  className,
  storagePrefix = 'io:preview',
  showStats = true,
}: {
  schema: Schema
  rowEstimates?: Record<string, number>
  className?: string
  /** Prefijo para recordar qué grupos están plegados (distinto por contexto). */
  storagePrefix?: string
  showStats?: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)
  const tableName = useMemo(() => new Map(schema.tables.map((t) => [t.id, t.name])), [schema.tables])
  const viewName = useMemo(() => new Map((schema.views ?? []).map((v) => [v.id, v.name])), [schema.views])
  const colName = (tableId: string, colId: string) =>
    schema.tables.find((t) => t.id === tableId)?.columns.find((c) => c.id === colId)?.name ?? '?'
  const fkCols = useMemo(() => new Set(schema.relations.map((r) => r.targetColumnId)), [schema.relations])
  const views = schema.views ?? []
  const k = (s: string) => `${storagePrefix}:${s}`

  return (
    <div className={cn('space-y-4', className)}>
      {showStats && <SchemaStats schema={schema} />}

      <Group title="Tablas" count={schema.tables.length} storageKey={k('tables')}>
        {schema.tables.map((t, i) => {
          const isOpen = open === t.id
          return (
            <li key={t.id} className={enterItem} style={stagger(i)}>
              <button
                type="button"
                className="flex w-full items-center gap-2 py-2 text-left transition-colors hover:bg-muted/50"
                onClick={() => setOpen(isOpen ? null : t.id)}
                aria-expanded={isOpen}
              >
                <ChevronRight
                  className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out', isOpen && 'rotate-90')}
                />
                <span className="size-2 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                <span className="font-mono text-sm">{t.name}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {t.columns.length} col.
                  {rowEstimates?.[t.name] !== undefined && ` · ~${fmtRows(rowEstimates[t.name])} filas`}
                </span>
              </button>
              {isOpen && (
                <div className={cn('pb-3 pl-8 max-md:overflow-x-auto max-md:pl-4', fadeIn)}>
                  {t.comment && <p className="mb-2 text-xs text-muted-foreground">{t.comment}</p>}
                  <table className="w-full text-xs max-md:w-max max-md:min-w-full">
                    <tbody>
                      {t.columns.map((c) => (
                        <tr key={c.id} className="align-baseline">
                          <td className="py-0.5 pr-3 font-mono">{c.name}</td>
                          <td className="py-0.5 pr-3 font-mono text-muted-foreground">{c.type}</td>
                          <td className="py-0.5 text-muted-foreground">
                            {[c.pk && 'PK', fkCols.has(c.id) && 'FK', c.unique && !c.pk && 'único', !c.nullable && !c.pk && 'no nulo', c.autoIncrement && 'autoinc.']
                              .filter(Boolean)
                              .join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          )
        })}
      </Group>

      <Group title="Vistas" count={views.length} storageKey={k('views')}>
        {views.map((v, i) => (
          <li key={v.id} className={cn('flex items-baseline gap-2 py-2 text-sm', enterItem)} style={stagger(i)}>
            <span className="font-mono">{v.name}</span>
            {v.materialized && <span className="text-xs text-muted-foreground">materializada</span>}
            <span className="ml-auto truncate text-xs text-muted-foreground">
              {v.sourceIds.length ? `lee de ${v.sourceIds.map((id) => tableName.get(id) ?? viewName.get(id) ?? '?').join(', ')}` : ''}
            </span>
          </li>
        ))}
      </Group>

      <Group title="Relaciones" count={schema.relations.length} storageKey={k('relations')}>
        {schema.relations.map((r, i) => (
          <li key={r.id} className={cn('flex flex-wrap items-baseline gap-x-2 py-1.5 font-mono text-xs', enterItem)} style={stagger(i)}>
            <span>
              {tableName.get(r.targetTableId)}.{colName(r.targetTableId, r.targetColumnId)}
            </span>
            <span className="text-muted-foreground">→</span>
            <span>
              {tableName.get(r.sourceTableId)}.{colName(r.sourceTableId, r.sourceColumnId)}
            </span>
            <span className="ml-auto font-sans text-muted-foreground">
              {r.cardinality}
              {r.onDelete !== 'NO ACTION' && ` · ON DELETE ${r.onDelete}`}
            </span>
          </li>
        ))}
      </Group>

      <Group title="Triggers" count={schema.triggers.length} storageKey={k('triggers')}>
        {schema.triggers.map((t, i) => (
          <li key={t.id} className={cn('flex flex-wrap items-baseline gap-x-2 py-1.5 text-xs', enterItem)} style={stagger(i)}>
            <span className={cn('font-mono', t.enabled === false && 'text-muted-foreground line-through decoration-muted-foreground/60')}>{t.name}</span>
            {t.enabled === false && <span className="text-muted-foreground">desactivado</span>}
            <span className="text-muted-foreground">
              {t.timing} {t.events.join(' OR ')} ON {tableName.get(t.tableId)}
            </span>
            <span className="ml-auto font-mono text-muted-foreground">{schema.functions.find((f) => f.id === t.functionId)?.name}()</span>
          </li>
        ))}
      </Group>

      <Group title="Enums" count={schema.enums.length} storageKey={k('enums')}>
        {schema.enums.map((e, i) => (
          <li key={e.id} className={cn('flex items-baseline gap-2 py-1.5 text-xs', enterItem)} style={stagger(i)}>
            <span className="font-mono">{e.name}</span>
            <span className="truncate text-muted-foreground">{e.values.join(', ')}</span>
          </li>
        ))}
      </Group>
    </div>
  )
}
