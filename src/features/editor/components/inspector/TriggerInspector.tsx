import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'

import { CodeEditor, sqlLanguageFor } from '@/components/code'
import { Button } from '@/components/ui/button'
import { useProjectStore } from '@/store/project'
import type { Trigger } from '@/types/schema'

import { deleteSelection } from '../../lib/actions'
import { InspectorHeader, InspectorSection } from './primitives'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-mono break-words">{children}</dd>
    </div>
  )
}

export function TriggerInspector({ trigger }: { trigger: Trigger }) {
  const navigate = useNavigate()
  const table = useProjectStore((s) => s.draft.tables.find((t) => t.id === trigger.tableId))
  const draft = useProjectStore((s) => s.draft)
  const dialect = draft.dialect
  const fn = draft.functions.find((f) => f.id === trigger.functionId)

  return (
    <>
      <InspectorHeader kind="Trigger" title={<span className="font-mono">{trigger.name}</span>} onDelete={deleteSelection} />
      <InspectorSection title="Definición" id="trigger-def">
        <dl className="grid gap-1.5">
          <Row label="Tabla">{table?.name ?? '—'}</Row>
          <Row label="Estado">{trigger.enabled === false ? 'desactivado' : 'activo'}</Row>
          <Row label="Momento">{trigger.timing}</Row>
          <Row label="Eventos">{trigger.events.join(', ') || '—'}</Row>
          <Row label="Nivel">FOR EACH {trigger.level}</Row>
          <Row label="Función">{fn ? `${fn.name}(${fn.args})` : '—'}</Row>
          {trigger.condition && <Row label="WHEN">{trigger.condition}</Row>}
        </dl>
      </InspectorSection>
      {fn && (
        <InspectorSection title={`Cuerpo de ${fn.name}`} id="trigger-body" className="gap-2">
          <CodeEditor
            className="nokey"
            value={fn.body}
            onChange={(body) => useProjectStore.getState().mutate((d) => void Object.assign(d.functions.find((f) => f.id === fn.id) ?? {}, { body }))}
            language={fn.language === 'plpgsql' ? 'pgsql' : sqlLanguageFor(dialect)}
            filename={`${fn.name}.sql`}
            schema={draft}
            height="auto"
            minHeight={120}
            maxHeight={360}
            lineNumbers={false}
            wordWrap
            statusBar={false}
            ariaLabel={`Cuerpo de ${fn.name}`}
          />
        </InspectorSection>
      )}
      <InspectorSection>
        <Button variant="outline" size="sm" onClick={() => navigate('/triggers')}>
          <ExternalLink />
          Editar en Triggers
        </Button>
      </InspectorSection>
    </>
  )
}
