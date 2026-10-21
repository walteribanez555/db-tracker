import { ScanSearch } from 'lucide-react'
import { useId, useState } from 'react'

import { sqlLanguageFor } from '@/components/code'
import { SharedCodeEditor } from '@/components/code/shared-code-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useProjectStore } from '@/store/project'

import { discrete, updateView } from '../../lib/actions'
import { stopEditing } from '../../lib/editorStore'
import { parseViewDefinition } from '../../lib/viewParser'

/** Edición en línea de una vista: nombre, SQL y detección de columnas/orígenes. */
export function ViewSqlPanel({ viewId }: { viewId: string }) {
  const draft = useProjectStore((s) => s.draft)
  const view = draft.views.find((v) => v.id === viewId)
  const id = useId()
  const [report, setReport] = useState<string | null>(null)
  if (!view) return null

  const detect = () => {
    const parsed = parseViewDefinition(view.definition, draft, view.id)
    discrete(() => updateView(view.id, { sourceIds: parsed.sourceIds, columns: parsed.columns }))
    const parts = [`${parsed.columns.length} columnas`, `${parsed.sourceIds.length} orígenes`]
    if (parsed.unknownSources.length) parts.push(`sin resolver: ${parsed.unknownSources.join(', ')}`)
    setReport(parts.join(' · '))
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={view.name}
          onChange={(e) => updateView(view.id, { name: e.target.value })}
          aria-label="Nombre de la vista"
          className="h-7 flex-1 font-mono text-xs md:text-xs"
        />
        <Label htmlFor={`${id}-mat`} className="text-xs font-normal text-muted-foreground">
          Materializada
        </Label>
        <Switch
          id={`${id}-mat`}
          size="sm"
          checked={view.materialized}
          onCheckedChange={(v) => discrete(() => updateView(view.id, { materialized: v }))}
        />
      </div>
      <SharedCodeEditor
            shared={{ kind: 'view-definition', id: view.id }}
        className="nokey"
        value={view.definition}
        onChange={(definition) => updateView(view.id, { definition })}
        language={sqlLanguageFor(draft.dialect)}
        filename={`${view.name || 'vista'}.sql`}
        schema={draft}
        height="auto"
        minHeight={180}
        maxHeight={380}
        statusBar
        ariaLabel={`SQL de la vista ${view.name}`}
      />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={detect} disabled={!view.definition.trim()}>
          <ScanSearch />
          Detectar columnas
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{report}</span>
        <Button variant="ghost" size="sm" onClick={stopEditing}>
          Listo
        </Button>
      </div>
    </div>
  )
}
