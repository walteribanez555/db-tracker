import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react'

import { useEffect, useRef } from 'react'

import { ActionMenu } from '@/components/flow/action-menu'
import { useTheme } from '@/components/theme/theme-provider'
// Colaboración: cursores y selección de los demás; rol "Solo lectura".
import { RemoteCursors, useIsReadOnly } from '@/features/collab'
import { useProjectStore } from '@/store/project'

import { LinkEdge } from '../edges/LinkEdge'
import { RelationEdge } from '../edges/RelationEdge'
import { useCanvasActions } from '../hooks/useCanvasActions'
import { useEditorMenu } from '../hooks/useEditorMenu'
import { useFlowGraph } from '../hooks/useFlowGraph'
import { useMinimapPreference } from '../hooks/useMinimapPreference'
import { FIT_PADDING, GRID_SIZE, HIGHLIGHT_COLOR } from '../lib/constants'
import { useEditorUi } from '../lib/editorStore'
import type { FlowEdge, FlowNode } from '../lib/types'
import { NoteNode } from '../nodes/NoteNode'
import { TableNode } from '../nodes/TableNode'
import { TriggerNode } from '../nodes/TriggerNode'
import { ViewNode } from '../nodes/ViewNode'
import { EmptyState } from './EmptyState'
import { MinimapToggle } from './MinimapToggle'
import { NewRelationDialog } from './NewRelationDialog'
import { Toolbar } from './Toolbar'
import { TriggerModalHost } from './TriggerModalHost'

const nodeTypes: NodeTypes = { table: TableNode, note: NoteNode, view: ViewNode, trigger: TriggerNode }
const edgeTypes: EdgeTypes = { relation: RelationEdge, link: LinkEdge }

const minimapColor = (node: FlowNode) => {
  switch (node.type) {
    case 'table':
      return node.data.table.color
    case 'note':
      return node.data.note.color
    case 'view':
      return 'var(--muted-foreground)'
    case 'trigger':
      return 'var(--brand)'
  }
}

export function Canvas() {
  const graph = useFlowGraph()
  const tool = useEditorUi((s) => s.tool)
  const isEmpty = useProjectStore((s) => s.draft.tables.length + s.draft.notes.length + s.draft.views.length === 0)
  const { addTable, fitVisible } = useCanvasActions()
  const nodesInitialized = useNodesInitialized()
  const fitted = useRef(false)
  useEffect(() => {
    if (!nodesInitialized || fitted.current) return
    fitted.current = true
    // Encuadre inicial cuando todos los nodos están medidos (respeta la barra flotante).
    requestAnimationFrame(() => void fitVisible(0))
  }, [nodesInitialized, fitVisible])
  const menu = useEditorMenu()
  const { resolved } = useTheme()
  const [minimapOpen, toggleMinimap] = useMinimapPreference()
  const readOnly = useIsReadOnly()
  const editable = tool === 'select' && !readOnly

  return (
    <div data-editor-canvas className="relative min-w-0 flex-1 bg-canvas" onContextMenu={(e) => e.preventDefault()}>
      <ReactFlow<FlowNode, FlowEdge>
        nodes={graph.nodes}
        edges={graph.edges}
        colorMode={resolved}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={graph.onNodesChange}
        onNodeClick={graph.onNodeClick}
        onNodeDragStart={graph.onNodeDragStart}
        onNodeDragStop={graph.onNodeDragStop}
        onEdgeClick={graph.onEdgeClick}
        onPaneClick={graph.onPaneClick}
        onNodeContextMenu={menu.onNodeContextMenu}
        onEdgeContextMenu={menu.onEdgeContextMenu}
        onPaneContextMenu={menu.onPaneContextMenu}
        onConnect={graph.onConnect}
        isValidConnection={graph.isValidConnection}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: HIGHLIGHT_COLOR, strokeWidth: 2 }}
        connectionRadius={24}
        snapToGrid
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={editable}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1.2} color="var(--canvas-dot)" />
        <Controls position="bottom-left" showInteractive={false} fitViewOptions={{ padding: FIT_PADDING, maxZoom: 1.2 }} />
        {minimapOpen && (
          <MiniMap<FlowNode>
            position="bottom-right"
            pannable
            zoomable
            nodeColor={minimapColor}
            nodeBorderRadius={4}
            className="opacity-60 transition-opacity duration-200 ease-out hover:opacity-100"
          />
        )}
        {/* Colaboración: cursores remotos y nodos que tienen seleccionados o editando. */}
        <RemoteCursors />
      </ReactFlow>

      <MinimapToggle open={minimapOpen} onToggle={toggleMinimap} />
      {/* Colaboración: en solo lectura la barra queda visible pero inactiva. */}
      <div inert={readOnly} className={readOnly ? 'contents [&>*]:opacity-50' : 'contents'}>
        <Toolbar />
      </div>
      {isEmpty && <EmptyState onCreate={addTable} />}
      <NewRelationDialog />
      <TriggerModalHost />
      <ActionMenu {...menu.menuProps} groups={menu.groups} />
    </div>
  )
}
