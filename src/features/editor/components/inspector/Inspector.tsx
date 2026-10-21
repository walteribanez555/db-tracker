import { CollapsiblePanel } from '@/components/layout/collapsible-panel'
import { useProjectStore } from '@/store/project'

import { NoteInspector } from './NoteInspector'
import { RelationInspector } from './RelationInspector'
import { SchemaSummary } from './SchemaSummary'
import { TableInspector } from './TableInspector'
import { TriggerInspector } from './TriggerInspector'
import { ViewInspector } from './ViewInspector'

function InspectorBody() {
  const selection = useProjectStore((s) => s.selection)
  const draft = useProjectStore((s) => s.draft)

  if (selection?.kind === 'table') {
    const table = draft.tables.find((t) => t.id === selection.id)
    if (table) return <TableInspector key={table.id} table={table} />
  }
  if (selection?.kind === 'relation') {
    const relation = draft.relations.find((r) => r.id === selection.id)
    if (relation) return <RelationInspector key={relation.id} relation={relation} />
  }
  if (selection?.kind === 'note') {
    const note = draft.notes.find((n) => n.id === selection.id)
    if (note) return <NoteInspector key={note.id} note={note} />
  }
  if (selection?.kind === 'view') {
    const view = draft.views.find((v) => v.id === selection.id)
    if (view) return <ViewInspector key={view.id} view={view} />
  }
  if (selection?.kind === 'trigger') {
    const trigger = draft.triggers.find((t) => t.id === selection.id)
    if (trigger) return <TriggerInspector key={trigger.id} trigger={trigger} />
  }
  return <SchemaSummary />
}

export function Inspector() {
  return (
    <CollapsiblePanel side="right" width={320} title="Inspector" storageKey="editor-inspector" shortcut="]">
      <InspectorBody />
    </CollapsiblePanel>
  )
}
