import { ArrowRight, Eye, Plus, Search, Zap } from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'

import { CollapsiblePanel } from '@/components/layout/collapsible-panel'
import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useProjectStore, type ProjectState } from '@/store/project'

import { useCanvasActions } from '../hooks/useCanvasActions'
import { useChangeSet } from '../lib/changes'
import { useEditorUi } from '../lib/editorStore'
import { relationLabel } from '../lib/relations'
import type { Layer } from '../lib/types'
import { EnumPopover } from './EnumPopover'

type Selection = NonNullable<ProjectState['selection']>

const LAYERS: { key: Layer; label: string }[] = [
  { key: 'tables', label: 'Tablas' },
  { key: 'views', label: 'Vistas' },
  { key: 'triggers', label: 'Triggers' },
  { key: 'notes', label: 'Notas' },
]

function Section({
  id,
  title,
  count,
  action,
  children,
}: {
  id: string
  title: string
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="border-b px-2.5 py-2 last:border-b-0">
      <CollapsibleSection title={title} meta={count} actions={action} storageKey={`editor:sidebar:${id}`} contentClassName="-mx-2.5 pt-1">
        {children}
      </CollapsibleSection>
    </div>
  )
}

const rowClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors hover:bg-muted/60',
    'animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out [animation-fill-mode:both] motion-reduce:animate-none',
    active && 'bg-brand/10 text-foreground hover:bg-brand/15',
  )

/** Retardo escalonado para la entrada de los primeros elementos de una lista. */
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 20}ms` })

const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-1 text-xs text-muted-foreground">{children}</p>

function Layers() {
  const layers = useEditorUi((s) => s.layers)
  const setLayer = useEditorUi((s) => s.setLayer)
  const showChanges = useEditorUi((s) => s.showChanges)
  const setShowChanges = useEditorUi((s) => s.setShowChanges)
  const changes = useChangeSet()
  const pending = changes.tables.size + changes.relations.size + changes.views.size + changes.triggers.size
  const id = useId()
  return (
    <Section id="layers" title="Capas">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 pt-1 pb-1">
        {LAYERS.map((l) => (
          <label key={l.key} htmlFor={`${id}-${l.key}`} className="flex items-center gap-2 text-sm">
            <Checkbox id={`${id}-${l.key}`} checked={layers[l.key]} onCheckedChange={(v) => setLayer(l.key, v === true)} />
            {l.label}
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t px-4 pt-2.5 pb-1">
        <Switch id={`${id}-changes`} size="sm" checked={showChanges} onCheckedChange={setShowChanges} />
        <label htmlFor={`${id}-changes`} className="min-w-0 flex-1 text-sm leading-tight">
          Resaltar cambios sin confirmar
        </label>
        {showChanges && pending > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums transition-opacity">
            <span className="size-1.5 rounded-full bg-brand" />
            {pending}
          </span>
        )}
      </div>
    </Section>
  )
}

export function Sidebar() {
  const draft = useProjectStore((s) => s.draft)
  const selection = useProjectStore((s) => s.selection)
  const setSelection = useProjectStore((s) => s.setSelection)
  const { addTable, addView, focusNode } = useCanvasActions()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const match = (...names: string[]) => !q || names.some((n) => n.toLowerCase().includes(q))
  const isActive = (kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id
  const selectAndFocus = (kind: Selection['kind'], id: string) => {
    setSelection({ kind, id })
    focusNode(id)
  }

  const tables = draft.tables.filter((t) => match(t.name))
  const relations = useMemo(() => draft.relations.map((relation) => ({ relation, label: relationLabel(draft, relation) })), [draft]).filter(
    ({ label }) => match(label.source, label.target),
  )
  const views = draft.views.filter((v) => match(v.name))
  const tableName = new Map(draft.tables.map((t) => [t.id, t.name]))
  const triggers = draft.triggers.filter((t) => match(t.name, tableName.get(t.tableId) ?? ''))
  const enums = draft.enums.filter((e) => match(e.name))

  return (
    <CollapsiblePanel side="left" width={264} title="Explorador" storageKey="editor-sidebar" shortcut="[">
      <div className="flex min-h-full flex-col">
        <div className="border-b px-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar…" className="h-8 pl-8 text-sm" />
          </div>
        </div>

        <div className="flex-1">
          <Layers />

          <Section id="tables" title="Tablas" count={tables.length}>
            {tables.length === 0 && <Empty>{q ? 'Sin resultados' : 'Aún no hay tablas'}</Empty>}
            {tables.map((t, i) => (
              <button
                key={t.id}
                type="button"
                style={stagger(i)}
                className={rowClass(isActive('table', t.id))}
                onClick={() => selectAndFocus('table', t.id)}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{t.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{t.columns.length}</span>
              </button>
            ))}
          </Section>

          <Section id="relations" title="Relaciones" count={relations.length}>
            {relations.length === 0 && <Empty>{q ? 'Sin resultados' : 'Arrastra de una columna a otra para relacionarlas'}</Empty>}
            {relations.map(({ relation, label }, i) => (
              <button
                key={relation.id}
                type="button"
                style={stagger(i)}
                className={rowClass(isActive('relation', relation.id))}
                onClick={() => setSelection({ kind: 'relation', id: relation.id })}
                title={`${label.source}.${label.sourceColumn} → ${label.target}.${label.targetColumn}`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[13px]">
                  <span className="truncate">{label.source}</span>
                  <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{label.target}</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">{relation.cardinality}</span>
              </button>
            ))}
          </Section>

          <Section
            id="views"
            title="Vistas"
            count={views.length}
            action={
              <Button variant="ghost" size="icon-xs" aria-label="Nueva vista" onClick={addView}>
                <Plus />
              </Button>
            }
          >
            {views.length === 0 && <Empty>{q ? 'Sin resultados' : 'Sin vistas'}</Empty>}
            {views.map((v, i) => (
              <button
                key={v.id}
                type="button"
                style={stagger(i)}
                className={rowClass(isActive('view', v.id))}
                onClick={() => selectAndFocus('view', v.id)}
              >
                <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{v.name}</span>
                <span className="text-xs text-muted-foreground">{v.materialized ? 'mat.' : ''}</span>
              </button>
            ))}
          </Section>

          <Section id="triggers" title="Triggers" count={triggers.length}>
            {triggers.length === 0 && <Empty>{q ? 'Sin resultados' : 'Sin triggers'}</Empty>}
            {triggers.map((t, i) => (
              <button
                key={t.id}
                type="button"
                style={stagger(i)}
                className={rowClass(isActive('trigger', t.id))}
                onClick={() => selectAndFocus('trigger', t.id)}
              >
                <Zap className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{t.name}</span>
                <span className="max-w-[40%] truncate font-mono text-xs text-muted-foreground">{tableName.get(t.tableId)}</span>
              </button>
            ))}
          </Section>

          <Section
            id="enums"
            title="Enums"
            count={enums.length}
            action={
              <EnumPopover>
                <Button variant="ghost" size="icon-xs" aria-label="Nuevo enum">
                  <Plus />
                </Button>
              </EnumPopover>
            }
          >
            {enums.length === 0 && <Empty>{q ? 'Sin resultados' : 'Sin enums'}</Empty>}
            {enums.map((e, i) => (
              <EnumPopover key={e.id} enumType={e}>
                <button type="button" style={stagger(i)} className={rowClass(false)}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{e.name}</span>
                  <span className="max-w-[55%] truncate text-xs text-muted-foreground">{e.values.join(', ')}</span>
                </button>
              </EnumPopover>
            ))}
          </Section>
        </div>

        <div className="sticky bottom-0 border-t bg-background p-3">
          <Button variant="outline" className="w-full" onClick={addTable}>
            <Plus />
            Nueva tabla
          </Button>
        </div>
      </div>
    </CollapsiblePanel>
  )
}
