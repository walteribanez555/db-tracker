// Construcción del grafo React Flow (tablas → triggers → funciones → tablas) y auto-layout.
import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type { DbFunction, Position, Schema, Table, Trigger, View } from '@/types/schema'

import { detectRefreshes, detectWrites, relationName, type WriteEffect } from './graph'

export const COL_X = { table: 0, trigger: 320, fn: 640, view: 960 }

/** Resaltado durante la simulación. */
export type Highlight = 'active' | 'visited' | 'cycle' | 'stale' | undefined

export type TableNodeData = { table: Table; triggerCount: number; hl?: Highlight }
/** Cambio respecto a la versión base: `sig` cambia con cada edición (para el destello). */
export type LiveMark = { changed?: boolean; sig?: string }

export type TriggerNodeData = { trigger: Trigger; tableName: string; functionName: string; hl?: Highlight } & LiveMark
export type FunctionNodeData = { fn: DbFunction; writes: WriteEffect[]; usedBy: number; refreshes: View[]; hl?: Highlight } & LiveMark
export type ViewNodeData = { view: View; triggerCount: number; refreshedBy: string[]; hl?: Highlight } & LiveMark

/** Firma de contenido sin la posición (mover un nodo no cuenta como cambio). */
export const contentSig = (x: { position?: unknown } | undefined) => (x ? JSON.stringify({ ...x, position: undefined }) : '')

export type TableFlowNode = Node<TableNodeData, 'table'>
export type TriggerFlowNode = Node<TriggerNodeData, 'trigger'>
export type FunctionFlowNode = Node<FunctionNodeData, 'fn'>
export type ViewFlowNode = Node<ViewNodeData, 'view'>
export type FlowNode = TableFlowNode | TriggerFlowNode | FunctionFlowNode | ViewFlowNode

/** Prefijo del id de nodo para una tabla o vista. */
export const relNodeId = (schema: Schema, id: string) => ((schema.views ?? []).some((v) => v.id === id) ? `v:${id}` : `t:${id}`)

const tableHeight = (t: Table) => 40 + 22 * Math.min(t.columns.length, 8) + (t.columns.length > 8 ? 20 : 0)

/** Tablas que participan en algún trigger (lo disparan o reciben escrituras). */
export function involvedTableIds(schema: Schema): Set<string> {
  const ids = new Set(schema.triggers.map((t) => t.tableId))
  for (const f of schema.functions) {
    for (const w of detectWrites(f, schema)) ids.add(w.tableId)
    for (const v of detectRefreshes(f, schema)) v.sourceIds.forEach((id) => ids.add(id))
  }
  return ids
}

/** Coloca tablas en una columna y sus triggers/funciones alineados a su derecha. */
export function autoLayout(schema: Schema, tables: Table[], views: View[] = []) {
  const tablePos: Record<string, Position> = {}
  const triggerPos: Record<string, Position> = {}
  const fnPos: Record<string, Position> = {}
  let y = 0
  for (const t of tables) {
    tablePos[t.id] = { x: COL_X.table, y }
    const trgs = schema.triggers.filter((x) => x.tableId === t.id).sort((a, b) => a.name.localeCompare(b.name))
    let ty = y
    for (const trg of trgs) {
      triggerPos[trg.id] = { x: COL_X.trigger, y: ty }
      if (!fnPos[trg.functionId]) fnPos[trg.functionId] = { x: COL_X.fn, y: ty }
      ty += 200
    }
    y = Math.max(y + tableHeight(t) + 60, ty + 20)
  }
  for (const f of schema.functions)
    if (!fnPos[f.id]) {
      fnPos[f.id] = { x: COL_X.fn, y }
      y += 210
    }
  for (const trg of schema.triggers)
    if (!triggerPos[trg.id]) {
      triggerPos[trg.id] = { x: COL_X.trigger, y }
      y += 200
    }
  // Vistas a la derecha, alineadas con su primera tabla de origen.
  let vy = 0
  for (const v of views) {
    const anchor = v.sourceIds.map((id) => tablePos[id]?.y).find((n) => n !== undefined) ?? 0
    vy = Math.max(vy, anchor)
    tablePos[v.id] = { x: COL_X.view, y: vy }
    vy += 40 + 22 * Math.min(v.columns.length, 6) + 70
  }
  return { tablePos, triggerPos, fnPos }
}

export function buildFlow(
  schema: Schema,
  savedTablePos: Record<string, Position>,
  onlyInvolved: boolean,
  selected: { kind: string; id: string } | null,
): { nodes: FlowNode[]; edges: Edge[] } {
  const involved = involvedTableIds(schema)
  const allViews = schema.views ?? []
  const tables = onlyInvolved && involved.size ? schema.tables.filter((t) => involved.has(t.id)) : schema.tables
  const tableIds = new Set(tables.map((t) => t.id))
  const views = onlyInvolved && involved.size ? allViews.filter((v) => involved.has(v.id) || v.sourceIds.some((id) => tableIds.has(id))) : allViews
  const auto = autoLayout(schema, tables, views)
  const shown = new Set([...tables.map((t) => t.id), ...views.map((v) => v.id)])
  const tName = (id: string) => relationName(schema, id)
  const fName = (id: string) => schema.functions.find((f) => f.id === id)?.name ?? 'sin función'
  const isSel = (kind: string, id: string) => selected?.kind === kind && selected.id === id

  const nodes: FlowNode[] = [
    ...tables.map(
      (t): TableFlowNode => ({
        id: `t:${t.id}`,
        type: 'table',
        position: savedTablePos[t.id] ?? auto.tablePos[t.id],
        data: { table: t, triggerCount: schema.triggers.filter((x) => x.tableId === t.id).length },
        selected: isSel('table', t.id),
        deletable: false,
      }),
    ),
    ...schema.triggers.map(
      (trg): TriggerFlowNode => ({
        id: `g:${trg.id}`,
        type: 'trigger',
        position: trg.position,
        data: { trigger: trg, tableName: tName(trg.tableId), functionName: fName(trg.functionId) },
        selected: isSel('trigger', trg.id),
      }),
    ),
    ...schema.functions.map(
      (fn): FunctionFlowNode => ({
        id: `f:${fn.id}`,
        type: 'fn',
        position: fn.position,
        data: {
          fn,
          writes: detectWrites(fn, schema),
          usedBy: schema.triggers.filter((t) => t.functionId === fn.id).length,
          refreshes: detectRefreshes(fn, schema),
        },
        selected: isSel('function', fn.id),
      }),
    ),
    ...views.map(
      (v): ViewFlowNode => ({
        id: `v:${v.id}`,
        type: 'view',
        position: savedTablePos[v.id] ?? auto.tablePos[v.id],
        data: {
          view: v,
          triggerCount: schema.triggers.filter((x) => x.tableId === v.id).length,
          refreshedBy: schema.functions.filter((f) => detectRefreshes(f, schema).some((x) => x.id === v.id)).map((f) => f.name),
        },
        selected: isSel('view', v.id),
        deletable: false,
      }),
    ),
  ]
  const nodeId = (id: string) => relNodeId(schema, id)

  const edges: Edge[] = []
  for (const trg of schema.triggers) {
    if (shown.has(trg.tableId))
      edges.push({
        id: `e:fires:${trg.id}`,
        source: nodeId(trg.tableId),
        sourceHandle: 'out',
        target: `g:${trg.id}`,
        targetHandle: 'in',
        label: 'dispara',
        markerEnd: { type: MarkerType.ArrowClosed },
      })
    if (schema.functions.some((f) => f.id === trg.functionId))
      edges.push({
        id: `e:exec:${trg.id}`,
        source: `g:${trg.id}`,
        sourceHandle: 'out',
        target: `f:${trg.functionId}`,
        targetHandle: 'in',
        label: 'ejecuta',
        markerEnd: { type: MarkerType.ArrowClosed },
      })
  }
  for (const n of nodes) {
    if (n.type !== 'fn') continue
    for (const w of n.data.writes) {
      if (!shown.has(w.tableId)) continue
      edges.push({
        id: `e:writes:${n.data.fn.id}:${w.tableId}:${w.event}`,
        source: n.id,
        sourceHandle: 'writes',
        target: nodeId(w.tableId),
        targetHandle: 'written',
        label: `escribe en (${w.event})`,
        type: 'default',
        className: 'writes-edge',
        style: { strokeDasharray: '6 4' },
        markerEnd: { type: MarkerType.ArrowClosed },
      })
    }
    for (const v of n.data.refreshes) {
      if (!shown.has(v.id)) continue
      edges.push({
        id: `e:refresh:${n.data.fn.id}:${v.id}`,
        source: n.id,
        sourceHandle: 'out',
        target: `v:${v.id}`,
        targetHandle: 'in',
        label: 'refresca',
        style: { strokeDasharray: '2 4' },
        markerEnd: { type: MarkerType.ArrowClosed },
      })
    }
  }
  // Tablas (o vistas) de origen → vista.
  for (const v of views)
    for (const src of v.sourceIds) {
      if (!shown.has(src)) continue
      edges.push({
        id: `e:feeds:${src}:${v.id}`,
        source: nodeId(src),
        sourceHandle: 'feeds',
        target: `v:${v.id}`,
        targetHandle: 'in',
        label: v.materialized ? 'alimenta (materializada)' : 'alimenta',
        className: 'feeds-edge',
        style: { strokeDasharray: '1 5', strokeLinecap: 'round', opacity: 0.7 },
      })
    }
  return { nodes, edges }
}
