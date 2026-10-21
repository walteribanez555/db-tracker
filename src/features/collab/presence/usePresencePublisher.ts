// Publica en awareness la ruta, la rama, la selección y lo que se está editando.
// El cursor lo publica cada lienzo (RemoteCursors), porque necesita las coordenadas del flujo.
import { useEffect } from 'react'
import { useLocation } from 'react-router'

import { updatePresence, type AwarenessState } from '@/collab'
import { useEditorUi, type InlineEdit } from '@/features/editor/lib/editorStore'
import { useCanvasUi } from '@/features/triggers/store'
import { useProjectStore } from '@/store/project'
import type { Schema } from '@/types/schema'

import { useIsCollaborating } from '../hooks'

type Editing = NonNullable<AwarenessState['editing']>

const EDIT_KIND: Record<InlineEdit['kind'], string> = {
  'table-name': 'table',
  'column-name': 'table',
  'column-type': 'table',
  normalization: 'table',
  'view-sql': 'view',
  trigger: 'trigger',
  'trigger-sql': 'trigger',
  note: 'note',
}

function labelFor(draft: Schema, kind: string, id: string): string {
  const list: { id: string; name?: string; title?: string }[] =
    kind === 'table'
      ? draft.tables
      : kind === 'view'
        ? draft.views
        : kind === 'trigger'
          ? draft.triggers
          : kind === 'function'
            ? draft.functions
            : kind === 'note'
              ? (draft.notes as { id: string }[])
              : []
  const item = list.find((x) => x.id === id)
  return item?.name ?? item?.title ?? 'nota'
}

export function usePresencePublisher() {
  const active = useIsCollaborating()
  const { pathname } = useLocation()
  const branchId = useProjectStore((s) => s.project.currentBranchId)
  const selection = useProjectStore((s) => s.selection)
  const editorEdit = useEditorUi((s) => s.editing)
  const triggerEdit = useCanvasUi((s) => s.editing)
  const draft = useProjectStore((s) => s.draft)

  useEffect(() => {
    if (!active) return
    // Al cambiar de pantalla el cursor anterior deja de tener sentido.
    updatePresence({ route: pathname, branchId, cursor: null })
  }, [active, pathname, branchId])

  useEffect(() => {
    if (!active) return
    updatePresence({ selection: selection ? { kind: selection.kind, id: selection.id } : null })
  }, [active, selection])

  // Solo cuenta la edición del lienzo visible.
  const raw: { kind: string; id: string } | null =
    pathname.startsWith('/triggers') ? triggerEdit : pathname.startsWith('/editor') && editorEdit ? { kind: EDIT_KIND[editorEdit.kind], id: editorEdit.id } : null
  const kind = raw?.kind ?? null
  const id = raw?.id ?? null
  const label = kind && id ? labelFor(draft, kind, id) : null
  useEffect(() => {
    if (!active) return
    const editing: Editing | null = kind && id ? { kind, id, label: label ?? '' } : null
    updatePresence({ editing })
  }, [active, kind, id, label])
}
