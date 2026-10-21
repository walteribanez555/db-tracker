import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { jumpBreakdown } from '@/lib/diff'
import { cn } from '@/lib/utils'
import type { SchemaDiff } from '@/types/report'

import { DIFF_TEXT, STAGGER_LIST, type DiffKind } from '../lib'

const SIGN: Record<DiffKind, string> = { add: '+', remove: '−', change: '~' }
const SR: Record<DiffKind, string> = { add: 'añadido', remove: 'eliminado', change: 'cambiado' }

/** Línea de diff: signo + texto coloreado (el signo y el texto oculto evitan depender del color). */
export function DiffLine({ kind, children, className }: { kind: DiffKind; children: React.ReactNode; className?: string }) {
  return (
    <li className={cn('flex gap-2 font-mono text-xs leading-5', DIFF_TEXT[kind], className)}>
      <span aria-hidden className="w-3 shrink-0 text-center font-semibold">
        {SIGN[kind]}
      </span>
      <span className="sr-only">{SR[kind]}: </span>
      <span className="min-w-0 break-words">{children}</span>
    </li>
  )
}

function Section({ title, count, storageKey, children }: { title: string; count: number; storageKey?: string; children: React.ReactNode }) {
  return (
    <CollapsibleSection title={title} meta={count} storageKey={storageKey}>
      <ul className={cn('space-y-0.5 pt-1 pl-1.5', STAGGER_LIST)}>{children}</ul>
    </CollapsibleSection>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Resumen de una línea: "3 saltos · 1 tabla · 4 columnas …". */
export function DiffSummary({ diff, className }: { diff: SchemaDiff; className?: string }) {
  const b = jumpBreakdown(diff)
  const parts = [
    b.tables && plural(b.tables, 'tabla', 'tablas'),
    b.columns && plural(b.columns, 'columna', 'columnas'),
    b.indexes && plural(b.indexes, 'índice', 'índices'),
    b.relations && plural(b.relations, 'relación', 'relaciones'),
    b.views && plural(b.views, 'vista', 'vistas'),
    b.triggers && plural(b.triggers, 'trigger', 'triggers'),
  ].filter(Boolean)
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      <span className="font-medium text-foreground tabular-nums">{plural(diff.jumps, 'salto', 'saltos')}</span>
      {parts.length > 0 && <> · {parts.join(' · ')}</>}
    </p>
  )
}

/** Diff completo agrupado: tablas, columnas por tabla, relaciones y triggers. */
export function DiffList({ diff, emptyText = 'Sin cambios estructurales.' }: { diff: SchemaDiff; emptyText?: string }) {
  if (diff.jumps === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>

  const hasTables = diff.addedTables.length + diff.removedTables.length + diff.renamedTables.length > 0
  const hasRels = diff.addedRelations.length + diff.removedRelations.length > 0
  const hasViews = diff.addedViews.length + diff.removedViews.length + diff.changedViews.length > 0
  const hasTrg = diff.addedTriggers.length + diff.removedTriggers.length + diff.changedTriggers.length > 0

  return (
    <div className="space-y-2">
      {hasTables && (
        <Section title="Tablas" count={diff.addedTables.length + diff.removedTables.length + diff.renamedTables.length} storageKey="diff:tablas">
          {diff.addedTables.map((t) => (
            <DiffLine key={`a-${t}`} kind="add">
              {t}
            </DiffLine>
          ))}
          {diff.removedTables.map((t) => (
            <DiffLine key={`r-${t}`} kind="remove">
              {t}
            </DiffLine>
          ))}
          {diff.renamedTables.map((r) => (
            <DiffLine key={`n-${r.from}`} kind="change">
              {r.from} → {r.to}
            </DiffLine>
          ))}
        </Section>
      )}

      {diff.modifiedTables.map((m) => (
        <Section key={m.table} title={`Columnas · ${m.table}`} count={m.addedColumns.length + m.removedColumns.length + m.changedColumns.length}>
          {m.addedColumns.map((c) => (
            <DiffLine key={`a-${c}`} kind="add">
              {c}
            </DiffLine>
          ))}
          {m.removedColumns.map((c) => (
            <DiffLine key={`r-${c}`} kind="remove">
              {c}
            </DiffLine>
          ))}
          {m.changedColumns.map((c) => (
            <DiffLine key={`c-${c.column}`} kind={c.changes[0] === 'eliminado' ? 'remove' : c.changes[0]?.startsWith('añadido') ? 'add' : 'change'}>
              {c.column}
              <span className="text-muted-foreground"> — {c.changes.join('; ')}</span>
            </DiffLine>
          ))}
        </Section>
      ))}

      {hasRels && (
        <Section title="Relaciones" count={diff.addedRelations.length + diff.removedRelations.length} storageKey="diff:relaciones">
          {diff.addedRelations.map((r, i) => (
            <DiffLine key={`a-${i}`} kind="add">
              {r}
            </DiffLine>
          ))}
          {diff.removedRelations.map((r, i) => (
            <DiffLine key={`r-${i}`} kind="remove">
              {r}
            </DiffLine>
          ))}
        </Section>
      )}

      {hasViews && (
        <Section title="Vistas" count={diff.addedViews.length + diff.removedViews.length + diff.changedViews.length} storageKey="diff:vistas">
          {diff.addedViews.map((v, i) => (
            <DiffLine key={`a-${i}`} kind="add">
              {v}
            </DiffLine>
          ))}
          {diff.removedViews.map((v, i) => (
            <DiffLine key={`r-${i}`} kind="remove">
              {v}
            </DiffLine>
          ))}
          {diff.changedViews.map((v, i) => (
            <DiffLine key={`c-${i}`} kind="change">
              {v}
            </DiffLine>
          ))}
        </Section>
      )}

      {hasTrg && (
        <Section title="Triggers" count={diff.addedTriggers.length + diff.removedTriggers.length + diff.changedTriggers.length} storageKey="diff:triggers">
          {diff.addedTriggers.map((t, i) => (
            <DiffLine key={`a-${i}`} kind="add">
              {t}
            </DiffLine>
          ))}
          {diff.removedTriggers.map((t, i) => (
            <DiffLine key={`r-${i}`} kind="remove">
              {t}
            </DiffLine>
          ))}
          {diff.changedTriggers.map((t, i) => (
            <DiffLine key={`c-${i}`} kind="change">
              {t}
            </DiffLine>
          ))}
        </Section>
      )}
    </div>
  )
}
