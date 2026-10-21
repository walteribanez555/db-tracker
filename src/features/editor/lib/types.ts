import type { Edge, Node } from '@xyflow/react'

import type { Note, Relation, Table, Trigger, View } from '@/types/schema'

import type { ChangeKind } from './changes'

export type TableNodeData = {
  table: Table
  fkColumnIds: string[]
  highlightColumnIds: string[]
  /** Cambio sin confirmar de la tabla y de sus columnas (por id). */
  change?: ChangeKind
  columnChanges: Record<string, ChangeKind>
}

export type NoteNodeData = { note: Note }

export type ViewNodeData = { view: View; change?: ChangeKind }

export type TriggerNodeData = {
  trigger: Trigger
  functionName: string | null
  change?: ChangeKind
}

export type TableFlowNode = Node<TableNodeData, 'table'>
export type NoteFlowNode = Node<NoteNodeData, 'note'>
export type ViewFlowNode = Node<ViewNodeData, 'view'>
export type TriggerFlowNode = Node<TriggerNodeData, 'trigger'>
export type FlowNode = TableFlowNode | NoteFlowNode | ViewFlowNode | TriggerFlowNode

export type RelationEdgeData = {
  relation: Relation
  highlighted: boolean
  change?: ChangeKind
}

export type LinkEdgeData = {
  highlighted: boolean
}

export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>
export type LinkFlowEdge = Edge<LinkEdgeData, 'link'>
export type FlowEdge = RelationFlowEdge | LinkFlowEdge

export type EditorTool = 'select' | 'hand'

export type Layer = 'tables' | 'views' | 'triggers' | 'notes'

export interface PendingRelation {
  sourceTableId: string
  sourceColumnId: string
  targetTableId: string
  targetColumnId: string
}

/** Handles a nivel de nodo (no conectables) usados por las aristas de vistas y triggers. */
export const NODE_HANDLE = { left: 'node-l', right: 'node-r' } as const

/** Elemento sobre el que se abrió el menú de acciones. `position` del lienzo en coordenadas de flujo. */
export type MenuTarget =
  | { kind: 'table'; id: string; columnId?: string }
  | { kind: 'relation'; id: string }
  | { kind: 'view'; id: string }
  | { kind: 'trigger'; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'pane'; position: { x: number; y: number } }
