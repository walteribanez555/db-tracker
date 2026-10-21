import { ScanSearch } from 'lucide-react'
import { useId, useState } from 'react'

import { CodeEditor, sqlLanguageFor } from '@/components/code'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TABLE_COLORS, useProjectStore } from '@/store/project'
import type { View } from '@/types/schema'

import { deleteSelection, discrete, updateView } from '../../lib/actions'
import { VIEW_COLOR } from '../../lib/constants'
import { parseViewDefinition } from '../../lib/viewParser'
import { ColorSwatches } from '../ColorSwatches'
import { Field, InspectorHeader, InspectorSection } from './primitives'

const VIEW_COLORS = [VIEW_COLOR, ...TABLE_COLORS.filter((c) => c !== VIEW_COLOR)]

export function ViewInspector({ view }: { view: View }) {
  const draft = useProjectStore((s) => s.draft)
  const id = useId()
  const [report, setReport] = useState<string | null>(null)

  const candidates = [
    ...draft.tables.map((t) => ({ id: t.id, name: t.name, kind: 'tabla' })),
    ...draft.views.filter((v) => v.id !== view.id).map((v) => ({ id: v.id, name: v.name, kind: 'vista' })),
  ]

  const toggleSource = (sourceId: string, checked: boolean) => {
    const next = checked ? [...view.sourceIds, sourceId] : view.sourceIds.filter((s) => s !== sourceId)
    discrete(() => updateView(view.id, { sourceIds: candidates.map((c) => c.id).filter((c) => next.includes(c)) }))
  }

  const detect = () => {
    const parsed = parseViewDefinition(view.definition, draft, view.id)
    discrete(() => updateView(view.id, { sourceIds: parsed.sourceIds, columns: parsed.columns }))
    const parts = [`${parsed.columns.length} columnas`, `${parsed.sourceIds.length} orígenes`]
    if (parsed.unknownSources.length) parts.push(`sin resolver: ${parsed.unknownSources.join(', ')}`)
    setReport(`Detectado: ${parts.join(' · ')}`)
  }

  return (
    <>
      <InspectorHeader
        kind={view.materialized ? 'Vista materializada' : 'Vista'}
        title={<span className="font-mono">{view.name}</span>}
        onDelete={deleteSelection}
      />

      <InspectorSection title="General" id="view-general">
        <Field label="Nombre" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={view.name}
            onChange={(e) => updateView(view.id, { name: e.target.value })}
            className="font-mono"
          />
        </Field>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${id}-mat`} className="text-sm font-normal">
            Materializada
          </Label>
          <Switch
            id={`${id}-mat`}
            checked={view.materialized}
            onCheckedChange={(v) => discrete(() => updateView(view.id, { materialized: v }))}
          />
        </div>
        <Field label="Color">
          <ColorSwatches colors={VIEW_COLORS} value={view.color} onChange={(color) => updateView(view.id, { color })} />
        </Field>
      </InspectorSection>

      <InspectorSection title="Definición SQL" id="view-sql">
        <Field label="Definición SQL">
          <CodeEditor
            className="nokey"
            value={view.definition}
            onChange={(definition) => updateView(view.id, { definition })}
            language={sqlLanguageFor(draft.dialect)}
            filename={`${view.name || 'vista'}.sql`}
            schema={draft}
            height="auto"
            minHeight={160}
            maxHeight={360}
            lineNumbers={false}
            wordWrap
            statusBar={false}
            ariaLabel={`SQL de la vista ${view.name}`}
          />
        </Field>
        <Button variant="outline" size="sm" onClick={detect} disabled={!view.definition.trim()}>
          <ScanSearch />
          Detectar columnas y orígenes
        </Button>
        {report && <p className="text-xs text-muted-foreground">{report}</p>}
      </InspectorSection>

      <InspectorSection title="Tablas de origen" id="view-sources" meta={view.sourceIds.length} className="gap-2">
        {candidates.length === 0 && <p className="text-xs text-muted-foreground">No hay tablas en el esquema.</p>}
        {candidates.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-xs">
            <Checkbox checked={view.sourceIds.includes(c.id)} onCheckedChange={(v) => toggleSource(c.id, v === true)} />
            <span className="font-mono">{c.name}</span>
            {c.kind === 'vista' && <span className="text-muted-foreground">vista</span>}
          </label>
        ))}
      </InspectorSection>

      <InspectorSection title="Columnas expuestas" id="view-columns" meta={view.columns.length} className="gap-2">
        {view.columns.length === 0 && <p className="text-xs text-muted-foreground">Usa «Detectar columnas y orígenes» a partir del SQL.</p>}
        <ul className="grid gap-1">
          {view.columns.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-2 font-mono text-xs">
              <span className="truncate">{c.name}</span>
              <span className="truncate text-muted-foreground">{c.type ?? '—'}</span>
            </li>
          ))}
        </ul>
      </InspectorSection>
    </>
  )
}
