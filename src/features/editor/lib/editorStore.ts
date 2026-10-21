import { create } from 'zustand'

import type { Note, Table, Trigger } from '@/types/schema'

import type { EditorTool, Layer, PendingRelation } from './types'

/** Edición en línea activa en el lienzo (solo una a la vez). */
export type InlineEdit =
  | { kind: 'table-name'; id: string }
  /** `chain`: al pulsar Enter se añade otra columna y se sigue editando. */
  | { kind: 'column-name'; id: string; columnId: string; chain?: boolean }
  | { kind: 'column-type'; id: string; columnId: string }
  | { kind: 'normalization'; id: string }
  | { kind: 'view-sql'; id: string }
  | { kind: 'trigger'; id: string }
  | { kind: 'trigger-sql'; id: string }
  | { kind: 'note'; id: string }

/** Portapapeles interno: una tabla viaja con sus triggers. */
export interface Clipboard {
  tables: Table[]
  triggers: Trigger[]
  notes: Note[]
}

interface EditorUiState {
  tool: EditorTool
  pendingRelation: PendingRelation | null
  layers: Record<Layer, boolean>
  editing: InlineEdit | null
  clipboard: Clipboard | null
  /** Resalta en el lienzo lo que cambió respecto a la versión base. */
  showChanges: boolean
  /** Trigger abierto en el modal de flujo (feature triggers). */
  triggerModalId: string | null
  setTool: (tool: EditorTool) => void
  setPendingRelation: (pending: PendingRelation | null) => void
  setLayer: (layer: Layer, visible: boolean) => void
  setEditing: (editing: InlineEdit | null) => void
  setClipboard: (clipboard: Clipboard | null) => void
  setShowChanges: (show: boolean) => void
  setTriggerModalId: (id: string | null) => void
}

export const useEditorUi = create<EditorUiState>((set) => ({
  tool: 'select',
  pendingRelation: null,
  layers: { tables: true, views: true, triggers: true, notes: true },
  editing: null,
  clipboard: null,
  showChanges: true,
  triggerModalId: null,
  setTool: (tool) => set({ tool }),
  setPendingRelation: (pendingRelation) => set({ pendingRelation }),
  setLayer: (layer, visible) => set((s) => ({ layers: { ...s.layers, [layer]: visible } })),
  setEditing: (editing) => set({ editing }),
  setClipboard: (clipboard) => set({ clipboard }),
  setShowChanges: (showChanges) => set({ showChanges }),
  setTriggerModalId: (triggerModalId) => set({ triggerModalId }),
}))

export const startEditing = (editing: InlineEdit) => useEditorUi.getState().setEditing(editing)
export const stopEditing = () => useEditorUi.getState().setEditing(null)
export const closeTriggerModal = () => useEditorUi.getState().setTriggerModalId(null)

/** Selector: la edición activa si coincide con el tipo y el id dados. */
export const useEditing = <K extends InlineEdit['kind']>(kind: K, id: string) =>
  useEditorUi((s) => (s.editing?.kind === kind && s.editing.id === id ? (s.editing as Extract<InlineEdit, { kind: K }>) : null))
