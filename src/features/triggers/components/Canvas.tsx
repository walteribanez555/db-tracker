import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type OnNodeDrag,
} from '@xyflow/react'
import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'

import { useTheme } from '@/components/theme/theme-provider'
import { useProjectStore } from '@/store/project'
import type { Position } from '@/types/schema'

import { findCycles } from '../lib/graph'
import { buildFlow, contentSig, type FlowNode, type Highlight } from '../lib/layout'
import { useCanvasUi, useSimHighlight, useTriggerLayout } from '../store'
import { useCanvasMenu } from './CanvasMenu'
import { FunctionNode, TableNode, TriggerNode, ViewNode } from './nodes'

const nodeTypes = { table: TableNode, trigger: TriggerNode, fn: FunctionNode, view: ViewNode }

const kindOf = (nodeId: string) => nodeId.slice(0, 1) as 't' | 'g' | 'f' | 'v'
const idOf = (nodeId: string) => nodeId.slice(2)

export function TriggerCanvas({ onSimulate }: { onSimulate: () => void }) {
  const draft = useProjectStore((s) => s.draft)
  const selection = useProjectStore((s) => s.selection)
  const setSelection = useProjectStore((s) => s.setSelection)
  const mutate = useProjectStore((s) => s.mutate)
  const removeTrigger = useProjectStore((s) => s.removeTrigger)
  const removeFunction = useProjectStore((s) => s.removeFunction)
  const tablePositions = useTriggerLayout((s) => s.tablePositions)
  const setTablePositions = useTriggerLayout((s) => s.setTablePositions)
  const onlyInvolved = useTriggerLayout((s) => s.onlyInvolved)
  const hl = useSimHighlight()
  const { resolved } = useTheme()
  const menu = useCanvasMenu(onSimulate)

  const flow = useMemo(() => buildFlow(draft, tablePositions, onlyInvolved, selection), [draft, tablePositions, onlyInvolved, selection])
  const cycles = useMemo(() => findCycles(draft), [draft])
  const cycleTriggerIds = useMemo(() => new Set(cycles.flatMap((c) => c.triggerIds)), [cycles])

  // Cambios en vivo: triggers, funciones y vistas que difieren de la versión base.
  const base = useProjectStore((s) => (s.baseVersionId ? s.project.versions.find((v) => v.id === s.baseVersionId)?.schema : undefined))
  const baseSigs = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of base?.triggers ?? []) m.set(`g:${t.id}`, contentSig(t))
    for (const f of base?.functions ?? []) m.set(`f:${f.id}`, contentSig(f))
    for (const v of base?.views ?? []) m.set(`v:${v.id}`, contentSig(v))
    return m
  }, [base])

  const derivedNodes = useMemo<FlowNode[]>(() => {
    const level = (id: string): Highlight =>
      hl.cycle.has(id) ? 'cycle' : hl.active.has(id) ? 'active' : hl.stale.has(id) ? 'stale' : hl.visited.has(id) ? 'visited' : undefined
    return flow.nodes.map((n) => {
      let h = level(n.id)
      if (h !== 'active' && n.type === 'trigger' && cycleTriggerIds.has(n.data.trigger.id)) h = 'cycle'
      if (n.type === 'table') return { ...n, data: { ...n.data, hl: h } } as FlowNode
      const sig = contentSig(n.type === 'trigger' ? n.data.trigger : n.type === 'fn' ? n.data.fn : n.data.view)
      return { ...n, data: { ...n.data, hl: h, sig, changed: baseSigs.get(n.id) !== sig } } as FlowNode
    })
  }, [flow.nodes, hl, cycleTriggerIds, baseSigs])

  const edges = useMemo<Edge[]>(() => {
    if (!hl.running) return flow.edges
    const lit = new Set([...hl.active, ...hl.visited, ...hl.stale])
    return flow.edges.map((e) => {
      const on = lit.has(e.source) && lit.has(e.target)
      return {
        ...e,
        animated: on,
        style: { ...e.style, opacity: on ? 1 : 0.25, stroke: on ? 'var(--brand)' : undefined, strokeWidth: on ? 2 : undefined },
      }
    })
  }, [flow.edges, hl])

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(derivedNodes)
  // Conserva las medidas ya calculadas: sin ellas React Flow oculta el nodo hasta volver a medirlo
  // (parpadeo que, entre otras cosas, rompía el doble clic tras seleccionar).
  useEffect(
    () =>
      setNodes((prev) => {
        const old = new Map(prev.map((n) => [n.id, n]))
        return derivedNodes.map((n) => {
          const o = old.get(n.id)
          return o?.measured ? ({ ...n, measured: o.measured } as FlowNode) : n
        })
      }),
    [derivedNodes, setNodes],
  )

  const onNodeDragStop: OnNodeDrag<Node> = useCallback(
    (_e, _node, dragged) => {
      const tablePos: Record<string, Position> = {}
      const trg: Record<string, Position> = {}
      const fns: Record<string, Position> = {}
      for (const n of dragged) {
        const k = kindOf(n.id)
        const p = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
        if (k === 't' || k === 'v') tablePos[idOf(n.id)] = p
        else if (k === 'g') trg[idOf(n.id)] = p
        else if (k === 'f') fns[idOf(n.id)] = p
      }
      if (Object.keys(tablePos).length) setTablePositions(tablePos)
      if (Object.keys(trg).length || Object.keys(fns).length)
        mutate((d) => {
          for (const t of d.triggers) if (trg[t.id]) t.position = trg[t.id]
          for (const f of d.functions) if (fns[f.id]) f.position = fns[f.id]
        })
    },
    [mutate, setTablePositions],
  )

  const isValidConnection: IsValidConnection = useCallback((c) => {
    const s = kindOf(c.source)
    const t = kindOf(c.target)
    return ((s === 't' || s === 'v') && t === 'g') || (s === 'g' && t === 'f')
  }, [])

  const onConnect = useCallback(
    (c: Connection) => {
      const s = kindOf(c.source)
      const t = kindOf(c.target)
      if ((s === 't' || s === 'v') && t === 'g')
        mutate((d) => {
          const trg = d.triggers.find((x) => x.id === idOf(c.target))
          if (trg) trg.tableId = idOf(c.source)
        })
      if (s === 'g' && t === 'f')
        mutate((d) => {
          const trg = d.triggers.find((x) => x.id === idOf(c.source))
          if (trg) trg.functionId = idOf(c.target)
        })
    },
    [mutate],
  )

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) {
        if (kindOf(n.id) === 'g') removeTrigger(idOf(n.id))
        if (kindOf(n.id) === 'f') removeFunction(idOf(n.id))
      }
    },
    [removeFunction, removeTrigger],
  )

  const setEditing = useCanvasUi((s) => s.setEditing)
  const onNodeDoubleClick = useCallback(
    (_: unknown, n: Node) => {
      const k = kindOf(n.id)
      if (k === 'g') useCanvasUi.getState().openFlowModal(idOf(n.id))
      else if (k === 'f') setEditing({ kind: 'function', id: idOf(n.id) })
      else if (k === 'v') setEditing({ kind: 'view', id: idOf(n.id) })
    },
    [setEditing],
  )

  const onNodeClick = useCallback(
    (_: unknown, n: Node) => {
      const map = { t: 'table', g: 'trigger', f: 'function', v: 'view' } as const
      setSelection({ kind: map[kindOf(n.id)], id: idOf(n.id) })
      // Seleccionar un trigger abre su flujo en el modal (no el panel SQL inferior).
      if (kindOf(n.id) === 'g') useCanvasUi.getState().openFlowModal(idOf(n.id))
    },
    [setSelection],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      {...menu.handlers}
      zoomOnDoubleClick={false}
      onPaneClick={() => setSelection(null)}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onNodesDelete={onNodesDelete}
      deleteKeyCode={['Backspace', 'Delete']}
      defaultEdgeOptions={{
        labelStyle: { fontSize: 10, fill: 'var(--muted-foreground)' },
        labelBgStyle: { fill: 'var(--canvas)' },
        labelBgPadding: [4, 2],
      }}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      colorMode={resolved}
      style={{ backgroundColor: 'var(--canvas)' }}
      className="triggers-canvas bg-canvas [&_.react-flow__edge-path]:transition-[stroke,stroke-width,opacity] [&_.react-flow__edge-path]:duration-300 [&_.react-flow__edge-path]:ease-out motion-reduce:[&_.react-flow__edge-path]:transition-none"
    >
      {menu.element}
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--canvas-dot)" bgColor="var(--canvas)" />
      <Controls showInteractive={false} position="bottom-left" />
      {cycles.length > 0 && (
        <Panel position="top-center" className="max-w-xl">
          <details role="alert" className="rounded-md border border-destructive/40 bg-popover px-3 py-1.5 text-xs animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-destructive">
              <TriangleAlert className="size-4 shrink-0" aria-hidden />
              {cycles.length === 1 ? 'Ciclo de triggers detectado' : `${cycles.length} ciclos de triggers detectados`}
              <span className="font-normal text-muted-foreground">· ver detalle</span>
            </summary>
            <div className="mt-1.5 space-y-1 pb-1">
              {cycles.map((c) => (
                <p key={c.key} className="font-mono text-[11px] text-muted-foreground">
                  {c.path}
                </p>
              ))}
              <p className="text-muted-foreground">
                Puede provocar recursión infinita. Corta la cadena con una condición WHEN, pg_trigger_depth() o moviendo la lógica.
              </p>
            </div>
          </details>
        </Panel>
      )}
    </ReactFlow>
  )
}
