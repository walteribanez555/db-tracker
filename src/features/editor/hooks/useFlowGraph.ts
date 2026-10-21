import { applyNodeChanges, type Connection, type IsValidConnection, type NodeChange, type NodeMouseHandler, type OnNodeDrag } from '@xyflow/react'
import { useCallback, useMemo, useState } from 'react'

import { useIsMobile } from '@/hooks/use-mobile'
import { useProjectStore, type ProjectState } from '@/store/project'
import type { Position } from '@/types/schema'

import { commitPositions } from '../lib/actions'
import { useChangeSet } from '../lib/changes'
import { TABLE_WIDTH } from '../lib/constants'
import { useEditorUi } from '../lib/editorStore'
import { fkColumnIdsByTable, orientRelation, parseHandleColumn } from '../lib/relations'
import { TriggerFlowModal } from '../lib/triggerModal'
import { NODE_HANDLE, type FlowEdge, type FlowNode } from '../lib/types'

type Selection = NonNullable<ProjectState['selection']>
type Side = 'l' | 'r'

const KIND_BY_TYPE: Record<FlowNode['type'], Selection['kind']> = {
  table: 'table',
  note: 'note',
  view: 'view',
  trigger: 'trigger',
}

const mergeNodes = (prev: FlowNode[], next: FlowNode[]): FlowNode[] => {
  const byId = new Map(prev.map((n) => [n.id, n]))
  return next.map((n) => {
    const old = byId.get(n.id)
    if (!old) return n
    return { ...n, measured: old.measured, dragging: old.dragging, position: old.dragging ? old.position : n.position } as FlowNode
  })
}

/** Elige los lados de conexión según la posición relativa de ambos nodos. */
function pickSides(a: FlowNode | undefined, b: FlowNode | undefined): [Side, Side] {
  if (!a || !b || a.id === b.id) return ['r', 'r']
  const ac = a.position.x + (a.measured?.width ?? TABLE_WIDTH) / 2
  const bc = b.position.x + (b.measured?.width ?? TABLE_WIDTH) / 2
  if (Math.abs(ac - bc) < TABLE_WIDTH * 0.75) return ['r', 'r']
  return ac < bc ? ['r', 'l'] : ['l', 'r']
}

const nodeHandle = (side: Side) => (side === 'l' ? NODE_HANDLE.left : NODE_HANDLE.right)

export function useFlowGraph() {
  const draft = useProjectStore((s) => s.draft)
  const selection = useProjectStore((s) => s.selection)
  const setSelection = useProjectStore((s) => s.setSelection)
  const tool = useEditorUi((s) => s.tool)
  const layers = useEditorUi((s) => s.layers)
  const setPendingRelation = useEditorUi((s) => s.setPendingRelation)
  const { tables, notes, relations, views, triggers, functions } = draft
  const changes = useChangeSet()
  // Móvil: solo se arrastra el nodo ya seleccionado; arrastrar uno sin seleccionar mueve el lienzo
  // (evita mover tablas por error al desplazarse con un dedo).
  const isMobile = useIsMobile()

  const derived = useMemo<FlowNode[]>(() => {
    const fks = fkColumnIdsByTable(relations)
    const selectedRelation = selection?.kind === 'relation' ? relations.find((r) => r.id === selection.id) : undefined
    const highlight = (tableId: string) =>
      selectedRelation
        ? [
            ...(selectedRelation.sourceTableId === tableId ? [selectedRelation.sourceColumnId] : []),
            ...(selectedRelation.targetTableId === tableId ? [selectedRelation.targetColumnId] : []),
          ]
        : []
    const isSelected = (kind: Selection['kind'], id: string) => selection?.kind === kind && selection.id === id
    // Seleccionado: decide `nodesDraggable` (herramienta, solo lectura); sin seleccionar: no arrastrable.
    const touch = (kind: Selection['kind'], id: string) => (isMobile && !isSelected(kind, id) ? { draggable: false } : {})
    const fnName = new Map(functions.map((f) => [f.id, f.name]))

    return [
      ...notes.map(
        (note): FlowNode => ({
          id: note.id,
          type: 'note',
          position: note.position,
          data: { note },
          selected: isSelected('note', note.id),
          ...touch('note', note.id),
          hidden: !layers.notes,
        }),
      ),
      ...tables.map(
        (table): FlowNode => ({
          id: table.id,
          type: 'table',
          position: table.position,
          data: {
            table,
            fkColumnIds: fks.get(table.id) ?? [],
            highlightColumnIds: highlight(table.id),
            change: changes.tables.get(table.id),
            columnChanges: Object.fromEntries(table.columns.flatMap((c) => (changes.columns.has(c.id) ? [[c.id, changes.columns.get(c.id)!]] : []))),
          },
          selected: isSelected('table', table.id),
          ...touch('table', table.id),
          hidden: !layers.tables,
        }),
      ),
      ...views.map(
        (view): FlowNode => ({
          id: view.id,
          type: 'view',
          position: view.position,
          data: { view, change: changes.views.get(view.id) },
          selected: isSelected('view', view.id),
          ...touch('view', view.id),
          hidden: !layers.views,
        }),
      ),
      ...triggers.map(
        (trigger): FlowNode => ({
          id: trigger.id,
          type: 'trigger',
          position: trigger.position,
          data: { trigger, functionName: fnName.get(trigger.functionId) ?? null, change: changes.triggers.get(trigger.id) },
          selected: isSelected('trigger', trigger.id),
          ...touch('trigger', trigger.id),
          hidden: !layers.triggers,
        }),
      ),
    ]
  }, [tables, notes, relations, views, triggers, functions, selection, layers, changes, isMobile])

  const [nodes, setNodes] = useState<FlowNode[]>(derived)
  const [lastDerived, setLastDerived] = useState(derived)
  if (derived !== lastDerived) {
    setLastDerived(derived)
    setNodes((prev) => mergeNodes(prev, derived))
  }

  const edges = useMemo<FlowEdge[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const visible = (id: string) => {
      const n = byId.get(id)
      return n !== undefined && !n.hidden
    }
    const sel = selection
    const touches = (...ids: string[]) => sel !== null && ids.includes(sel.id)
    const result: FlowEdge[] = []

    for (const relation of relations) {
      if (!visible(relation.sourceTableId) || !visible(relation.targetTableId)) continue
      const [s, t] = pickSides(byId.get(relation.sourceTableId), byId.get(relation.targetTableId))
      result.push({
        id: relation.id,
        type: 'relation',
        source: relation.sourceTableId,
        sourceHandle: `${relation.sourceColumnId}-${s}`,
        target: relation.targetTableId,
        targetHandle: `${relation.targetColumnId}-${t}`,
        selected: sel?.kind === 'relation' && sel.id === relation.id,
        data: {
          relation,
          highlighted: sel?.kind === 'table' && touches(relation.sourceTableId, relation.targetTableId),
          change: changes.relations.get(relation.id),
        },
      })
    }

    for (const view of views) {
      if (!visible(view.id)) continue
      for (const sourceId of view.sourceIds) {
        if (!visible(sourceId)) continue
        const [s, t] = pickSides(byId.get(sourceId), byId.get(view.id))
        result.push({
          id: `view:${view.id}:${sourceId}`,
          type: 'link',
          source: sourceId,
          sourceHandle: nodeHandle(s),
          target: view.id,
          targetHandle: nodeHandle(t),
          selectable: false,
          focusable: false,
          data: { highlighted: touches(view.id, sourceId) },
        })
      }
    }

    for (const trigger of triggers) {
      if (!visible(trigger.id) || !visible(trigger.tableId)) continue
      const [s, t] = pickSides(byId.get(trigger.id), byId.get(trigger.tableId))
      result.push({
        id: `trigger:${trigger.id}`,
        type: 'link',
        source: trigger.id,
        sourceHandle: nodeHandle(s),
        target: trigger.tableId,
        targetHandle: nodeHandle(t),
        selectable: false,
        focusable: false,
        data: { highlighted: touches(trigger.id, trigger.tableId) },
      })
    }
    return result
  }, [nodes, relations, views, triggers, selection, changes])

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    const relevant = changes.filter((c) => c.type !== 'select' && c.type !== 'remove')
    if (relevant.length) setNodes((nds) => applyNodeChanges(relevant, nds))
  }, [])

  const selectNode = useCallback((node: FlowNode) => setSelection({ kind: KIND_BY_TYPE[node.type], id: node.id }), [setSelection])

  const onNodeClick: NodeMouseHandler<FlowNode> = useCallback(
    (_, node) => {
      if (tool !== 'select') return
      selectNode(node)
      if (node.type === 'trigger' && TriggerFlowModal) useEditorUi.getState().setTriggerModalId(node.id)
    },
    [tool, selectNode],
  )

  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback((_, node) => selectNode(node), [selectNode])

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback((_, __, dragged) => {
    const d = useProjectStore.getState().draft
    const current = new Map<string, Position>(
      [...d.tables, ...d.notes, ...d.views, ...d.triggers].map((x) => [x.id, x.position] as const),
    )
    const moved = dragged.filter((n) => {
      const p = current.get(n.id)
      return !p || p.x !== n.position.x || p.y !== n.position.y
    })
    if (moved.length) commitPositions(Object.fromEntries(moved.map((n) => [n.id, { x: n.position.x, y: n.position.y }])))
  }, [])

  const onEdgeClick = useCallback(
    (_: unknown, edge: FlowEdge) => {
      if (tool === 'select' && edge.type === 'relation') setSelection({ kind: 'relation', id: edge.id })
    },
    [tool, setSelection],
  )

  const onPaneClick = useCallback(() => setSelection(null), [setSelection])

  const isValidConnection: IsValidConnection<FlowEdge> = useCallback((c) => {
    const s = parseHandleColumn(c.sourceHandle)
    const t = parseHandleColumn(c.targetHandle)
    if (!s || !t || s === 'node' || t === 'node') return false
    return !(c.source === c.target && s === t)
  }, [])

  const onConnect = useCallback(
    (c: Connection) => {
      const sourceColumnId = parseHandleColumn(c.sourceHandle)
      const targetColumnId = parseHandleColumn(c.targetHandle)
      const d = useProjectStore.getState().draft
      const isTable = (id: string) => d.tables.some((t) => t.id === id)
      if (!sourceColumnId || !targetColumnId || !isTable(c.source) || !isTable(c.target)) return
      setPendingRelation(orientRelation(d, { sourceTableId: c.source, sourceColumnId, targetTableId: c.target, targetColumnId }))
    },
    [setPendingRelation],
  )

  return {
    nodes,
    edges,
    onNodesChange,
    onNodeClick,
    onNodeDragStart,
    onNodeDragStop,
    onEdgeClick,
    onPaneClick,
    onConnect,
    isValidConnection,
  }
}
