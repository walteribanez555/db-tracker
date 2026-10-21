import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { ACTION_MENU_GESTURE_LABEL } from '@/components/flow/use-action-menu'
import { useProjectStore } from '@/store/project'

import { findColumn, relationLabel } from '../../lib/relations'
import { compareTypes } from '../../lib/sqlTypes'
import { InspectorHeader, InspectorSection } from './primitives'

const DIALECT_LABEL = { postgresql: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', sqlserver: 'SQL Server' } as const

const SHORTCUTS: [string, string][] = [
  [ACTION_MENU_GESTURE_LABEL, 'Menú de acciones'],
  ['⇧F10', 'Menú del seleccionado'],
  ['T / N', 'Nueva tabla / nota'],
  ['V / H', 'Seleccionar / mano'],
  ['F2 / Enter', 'Renombrar / editar'],
  ['⌘C / ⌘V / ⌘D', 'Copiar / pegar / duplicar'],
  ['Supr', 'Eliminar selección'],
  ['⌘Z / ⇧⌘Z', 'Deshacer / rehacer'],
]

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{children}</dd>
    </div>
  )
}

export function SchemaSummary() {
  const draft = useProjectStore((s) => s.draft)
  const setSelection = useProjectStore((s) => s.setSelection)
  const columnCount = draft.tables.reduce((n, t) => n + t.columns.length, 0)

  const withoutPk = draft.tables.filter((t) => !t.columns.some((c) => c.pk))
  const linked = new Set(draft.relations.flatMap((r) => [r.sourceTableId, r.targetTableId]))
  const isolated = draft.tables.length > 1 ? draft.tables.filter((t) => !linked.has(t.id)) : []
  const mismatched = draft.relations.filter((r) => {
    const s = findColumn(draft, r.sourceTableId, r.sourceColumnId)
    const t = findColumn(draft, r.targetTableId, r.targetColumnId)
    return s && t && compareTypes(s.column.type, t.column.type) === 'mismatch'
  })

  const warnings = [
    ...withoutPk.map((t) => ({ id: t.id, kind: 'table' as const, text: `${t.name} no tiene clave primaria` })),
    ...mismatched.map((r) => ({
      id: r.id,
      kind: 'relation' as const,
      text: `Tipos incompatibles: ${relationLabel(draft, r).source} → ${relationLabel(draft, r).target}`,
    })),
    ...isolated.map((t) => ({ id: t.id, kind: 'table' as const, text: `${t.name} no tiene relaciones` })),
  ]

  return (
    <>
      <InspectorHeader kind="Esquema" title={DIALECT_LABEL[draft.dialect]} />
      <InspectorSection title="Resumen" id="summary">
        <dl className="grid gap-1.5">
          <Row label="Tablas">{draft.tables.length}</Row>
          <Row label="Columnas">{columnCount}</Row>
          <Row label="Relaciones">{draft.relations.length}</Row>
          <Row label="Índices">{draft.tables.reduce((n, t) => n + t.indexes.length, 0)}</Row>
          <Row label="Vistas">{draft.views.length}</Row>
          <Row label="Triggers">{draft.triggers.length}</Row>
          <Row label="Enums">{draft.enums.length}</Row>
          <Row label="Notas">{draft.notes.length}</Row>
        </dl>
      </InspectorSection>

      {warnings.length > 0 && (
        <InspectorSection title="Revisión" id="review" meta={warnings.length} className="gap-2">
          <ul className="grid gap-1">
            {warnings.map((w) => (
              <li key={`${w.kind}-${w.id}-${w.text}`}>
                <button
                  type="button"
                  onClick={() => setSelection({ kind: w.kind, id: w.id })}
                  className="flex w-full items-start gap-2 text-left text-xs hover:underline"
                >
                  <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span className="font-mono">{w.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </InspectorSection>
      )}

      <InspectorSection title="Atajos" id="shortcuts" className="gap-2">
        <dl className="grid gap-1">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-2 text-xs">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono">{keys}</dd>
            </div>
          ))}
        </dl>
        <p className="pt-1 text-xs text-muted-foreground">
          Arrastra desde el borde de una columna hasta otra para crear una relación. Doble clic en un nombre para renombrarlo; clic en un
          tipo para cambiarlo.
        </p>
      </InspectorSection>
    </>
  )
}
