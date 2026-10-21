// Grafo "flujo de un trigger": tabla origen → triggers del mismo momento → función → efectos → cascada.
import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type { Schema, Trigger } from '@/types/schema'

import { dependentMaterializedViews, detectRefreshes, detectWrites, relationName } from './graph'

export type MiniKind = 'table' | 'view' | 'trigger' | 'function'

export type MiniNodeData = {
  kind: MiniKind
  label: string
  sub?: string
  /** El trigger del que trata el modal. */
  focus?: boolean
  /** Trigger desactivado en la BD. */
  disabled?: boolean
  /** Vista materializada que queda desactualizada. */
  stale?: boolean
}

export type MiniFlowNode = Node<MiniNodeData, 'mini'>

// Disposición vertical (de arriba abajo): cada "nivel" del flujo es una fila; los elementos del mismo nivel, columnas.
const ITEM_W = 220
const LEVEL_H = 92

const triggerSub = (t: Trigger) => `${t.timing} · ${t.events.join(', ')} · ${t.level === 'ROW' ? 'por fila' : 'por sentencia'}`

/**
 * Construye el flujo de un trigger. Ids de nodo compatibles con la simulación:
 * t:/v: (tablas/vistas), g: (triggers), f: (funciones). Un nodo ya presente se reutiliza
 * (así los ciclos se ven como aristas que vuelven).
 */
export function buildTriggerFlow(schema: Schema, triggerId: string, cascadeLevels = 2): { nodes: MiniFlowNode[]; edges: Edge[] } {
  const trigger = schema.triggers.find((t) => t.id === triggerId)
  if (!trigger) return { nodes: [], edges: [] }
  const views = schema.views ?? []
  const isView = (id: string) => views.some((v) => v.id === id)
  const relId = (id: string) => `${isView(id) ? 'v' : 't'}:${id}`

  const nodes = new Map<string, MiniFlowNode>()
  const edges = new Map<string, Edge>()
  const rows: number[] = []

  const node = (id: string, col: number, data: MiniNodeData) => {
    const existing = nodes.get(id)
    if (existing) return existing
    const row = rows[col] ?? 0
    rows[col] = row + 1
    const n: MiniFlowNode = { id, type: 'mini', position: { x: row * ITEM_W, y: col * LEVEL_H }, data }
    nodes.set(id, n)
    return n
  }
  const edge = (source: string, target: string, label: string, dashed = false) => {
    const id = `${source}->${target}:${label}`
    if (edges.has(id)) return
    edges.set(id, {
      id,
      source,
      target,
      label,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: dashed ? { strokeDasharray: '6 4' } : undefined,
    })
  }
  const relNode = (id: string, col: number) =>
    node(relId(id), col, { kind: isView(id) ? 'view' : 'table', label: relationName(schema, id), sub: isView(id) ? 'vista' : 'tabla' })
  const triggerNode = (t: Trigger, col: number, focus = false) =>
    node(`g:${t.id}`, col, { kind: 'trigger', label: t.name, sub: triggerSub(t), focus, disabled: t.enabled === false })

  /** Efectos de una función (escrituras, refrescos, vistas desactualizadas) y su cascada. */
  const expand = (fnId: string, col: number, level: number) => {
    const fn = schema.functions.find((f) => f.id === fnId)
    if (!fn) return
    const fnNode = `f:${fn.id}`
    const refreshed = detectRefreshes(fn, schema)
    for (const v of refreshed) {
      relNode(v.id, col + 1)
      edge(fnNode, `v:${v.id}`, 'refresca', true)
    }
    for (const w of detectWrites(fn, schema)) {
      const target = relNode(w.tableId, col + 1)
      edge(fnNode, target.id, `escribe en (${w.event})`, true)
      for (const mv of dependentMaterializedViews(schema, w.tableId)) {
        if (refreshed.some((r) => r.id === mv.id)) continue
        node(`v:${mv.id}`, col + 2, { kind: 'view', label: mv.name, sub: 'queda desactualizada', stale: true })
        edge(target.id, `v:${mv.id}`, 'desactualiza', true)
      }
      if (level >= cascadeLevels) continue
      const cascade = schema.triggers
        .filter((t) => t.tableId === w.tableId && t.events.includes(w.event))
        .sort((a, b) => a.name.localeCompare(b.name))
      for (const t of cascade) {
        const seen = nodes.has(`g:${t.id}`)
        triggerNode(t, col + 2)
        edge(target.id, `g:${t.id}`, 'dispara')
        if (seen || t.enabled === false) continue
        const f = schema.functions.find((x) => x.id === t.functionId)
        if (!f) continue
        const fSeen = nodes.has(`f:${f.id}`)
        node(`f:${f.id}`, col + 3, { kind: 'function', label: `${f.name}()`, sub: f.language })
        edge(`g:${t.id}`, `f:${f.id}`, 'ejecuta')
        if (!fSeen) expand(f.id, col + 3, level + 1)
      }
    }
  }

  const origin = relNode(trigger.tableId, 0)
  // Triggers de la misma tabla y momento que comparten evento, en su orden real (alfabético en PostgreSQL).
  const siblings = schema.triggers
    .filter((t) => t.tableId === trigger.tableId && t.timing === trigger.timing && t.events.some((e) => trigger.events.includes(e)))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const t of siblings) {
    triggerNode(t, 1, t.id === trigger.id)
    edge(origin.id, `g:${t.id}`, 'dispara')
  }
  const fn = schema.functions.find((f) => f.id === trigger.functionId)
  if (fn) {
    node(`f:${fn.id}`, 2, { kind: 'function', label: `${fn.name}()`, sub: `${fn.language} · RETURNS ${fn.returns || 'trigger'}` })
    edge(`g:${trigger.id}`, `f:${fn.id}`, 'ejecuta')
    expand(fn.id, 2, 0)
  }

  // Centra horizontalmente cada nivel respecto al más ancho.
  const maxItems = Math.max(...rows.map((r) => r ?? 0), 1)
  for (const n of nodes.values()) {
    const level = Math.round(n.position.y / LEVEL_H)
    n.position = { x: n.position.x + ((maxItems - (rows[level] ?? 1)) * ITEM_W) / 2, y: n.position.y }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

/** Efectos estáticos de un trigger, para la pestaña "Efectos". */
export function triggerEffects(schema: Schema, trigger: Trigger) {
  const fn = schema.functions.find((f) => f.id === trigger.functionId)
  if (!fn) return { writes: [], refreshes: [], stale: [], cascade: [] }
  const writes = detectWrites(fn, schema)
  const refreshes = detectRefreshes(fn, schema)
  const stale = writes.flatMap((w) =>
    dependentMaterializedViews(schema, w.tableId)
      .filter((v) => !refreshes.some((r) => r.id === v.id))
      .map((v) => ({ view: v, via: w.tableName })),
  )
  const cascade = writes.flatMap((w) =>
    schema.triggers
      .filter((t) => t.tableId === w.tableId && t.events.includes(w.event) && t.id !== trigger.id)
      .map((t) => ({ trigger: t, via: `${w.event} ${w.tableName}` })),
  )
  return { writes, refreshes, stale, cascade }
}
