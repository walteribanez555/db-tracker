// Análisis del flujo de efectos de triggers: escrituras de funciones, simulación y ciclos.
import type { DbFunction, Schema, Trigger, TriggerEvent, View } from '@/types/schema'

export type DmlEvent = Exclude<TriggerEvent, 'TRUNCATE'>

export interface WriteEffect {
  /** Id de la tabla (o de la vista, para escrituras sobre vistas con INSTEAD OF). */
  tableId: string
  tableName: string
  event: DmlEvent
  isView: boolean
}

const viewsOf = (schema: Schema): View[] => schema.views ?? []

/** Nombre de una tabla o vista por id. */
export function relationName(schema: Schema, id: string): string {
  return schema.tables.find((t) => t.id === id)?.name ?? viewsOf(schema).find((v) => v.id === id)?.name ?? '?'
}

/** Vistas materializadas que dependen (directa o transitivamente) de una tabla o vista. */
export function dependentMaterializedViews(schema: Schema, relId: string): View[] {
  const views = viewsOf(schema)
  const out = new Map<string, View>()
  const queue = [relId]
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const v of views)
      if (v.sourceIds.includes(id)) {
        if (v.materialized) out.set(v.id, v)
        queue.push(v.id)
      }
  }
  return [...out.values()]
}

const REFRESH_RE = /\bREFRESH\s+MATERIALIZED\s+VIEW\s+(?:CONCURRENTLY\s+)?((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)/gi

/** Vistas materializadas que refresca el cuerpo de una función. */
export function detectRefreshes(fn: Pick<DbFunction, 'body'>, schema: Schema): View[] {
  const body = stripNoise(fn.body)
  const out: View[] = []
  for (const m of body.matchAll(REFRESH_RE)) {
    const raw = m[1].split('.').pop()!.trim().replace(/^"|"$/g, '')
    const v = viewsOf(schema).find((x) => x.name.toLowerCase() === raw.toLowerCase())
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

/** Quita comentarios y literales para que el análisis no se confunda con texto. */
function stripNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
}

const WRITE_RE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)/gi

/** Detecta (con regex) en qué tablas escribe el cuerpo de una función. */
export function detectWrites(fn: Pick<DbFunction, 'body'>, schema: Schema): WriteEffect[] {
  const body = stripNoise(fn.body)
  const out: WriteEffect[] = []
  for (const m of body.matchAll(WRITE_RE)) {
    const before = body.slice(Math.max(0, m.index - 12), m.index)
    if (/\b(FOR|DO)\s+$/i.test(before)) continue // SELECT … FOR UPDATE, ON CONFLICT DO UPDATE
    const verb = m[1].toUpperCase()
    const event: DmlEvent = verb.startsWith('INSERT') ? 'INSERT' : verb.startsWith('DELETE') ? 'DELETE' : 'UPDATE'
    const raw = m[2].split('.').pop()!.trim().replace(/^"|"$/g, '')
    const lower = raw.toLowerCase()
    const table = schema.tables.find((t) => t.name.toLowerCase() === lower)
    const view = table ? undefined : viewsOf(schema).find((v) => v.name.toLowerCase() === lower)
    const target = table ?? view
    if (!target) continue
    if (!out.some((w) => w.tableId === target.id && w.event === event))
      out.push({ tableId: target.id, tableName: target.name, event, isView: !table })
  }
  return out
}

export type StepKind = 'trigger' | 'operation' | 'cycle' | 'limit' | 'refresh-view' | 'stale-view' | 'disabled'

export interface SimStep {
  index: number
  depth: number
  kind: StepKind
  phase?: Trigger['timing']
  tableId: string
  event: DmlEvent
  triggerId?: string
  functionId?: string
  /** Escrituras que provoca la función del trigger. */
  writes?: WriteEffect[]
  /** Vista materializada afectada (pasos refresh-view / stale-view). */
  viewId?: string
  label: string
  detail?: string
}

export interface CycleInfo {
  key: string
  /** Descripción legible: "pedidos UPDATE → trg_x → fn_x → UPDATE pedidos". */
  path: string
  triggerIds: string[]
  tableIds: string[]
}

export interface Simulation {
  steps: SimStep[]
  cycles: CycleInfo[]
}

interface Frame {
  tableId: string
  event: DmlEvent
  triggerId?: string
}

/**
 * Simula el orden de ejecución de una operación: BEFORE → operación → AFTER, recursivamente
 * para las escrituras de cada función. PostgreSQL dispara los triggers del mismo momento
 * en orden alfabético por nombre.
 */
export interface SimulateOptions {
  maxDepth?: number
  /** Triggers que se ignoran en la simulación (desactivados por el usuario). */
  disabled?: ReadonlySet<string>
}

export function simulate(schema: Schema, tableId: string, event: DmlEvent, opts: SimulateOptions | number = {}): Simulation {
  const { maxDepth = 6, disabled } = typeof opts === 'number' ? { maxDepth: opts } : opts
  const steps: SimStep[] = []
  const cycles: CycleInfo[] = []
  const tName = (id: string) => relationName(schema, id)
  const fns = new Map(schema.functions.map((f) => [f.id, f]))
  const writesCache = new Map<string, WriteEffect[]>()
  const writesOf = (fnId: string) => {
    if (!writesCache.has(fnId)) {
      const f = fns.get(fnId)
      writesCache.set(fnId, f ? detectWrites(f, schema) : [])
    }
    return writesCache.get(fnId)!
  }
  const add = (s: Omit<SimStep, 'index'>) => steps.push({ ...s, index: steps.length + 1 })

  const run = (tid: string, ev: DmlEvent, depth: number, stack: Frame[], origin?: string) => {
    const loopAt = stack.findIndex((f) => f.tableId === tid && f.event === ev)
    if (loopAt >= 0) {
      const loop = stack.slice(loopAt)
      const triggerIds = loop.map((f) => f.triggerId).filter((x): x is string => !!x)
      const key = [...triggerIds].sort().join('|') || `${tid}:${ev}`
      const parts: string[] = []
      for (const f of loop) {
        parts.push(`${f.event} ${tName(f.tableId)}`)
        const trg = schema.triggers.find((t) => t.id === f.triggerId)
        if (trg) parts.push(`${trg.name} → ${fns.get(trg.functionId)?.name ?? '?'}`)
      }
      parts.push(`${ev} ${tName(tid)}`)
      if (!cycles.some((c) => c.key === key))
        cycles.push({ key, path: parts.join(' → '), triggerIds, tableIds: [...new Set(loop.map((f) => f.tableId))] })
      add({ depth, kind: 'cycle', tableId: tid, event: ev, label: `Ciclo: ${ev} en ${tName(tid)} vuelve a disparar la cadena`, detail: parts.join(' → ') })
      return
    }
    if (depth > maxDepth) {
      add({ depth, kind: 'limit', tableId: tid, event: ev, label: `Profundidad máxima alcanzada (${maxDepth})` })
      return
    }
    const all = schema.triggers
      .filter((t) => t.tableId === tid && t.events.includes(ev) && !disabled?.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name))
    const fired = all.filter((t) => t.enabled !== false)
    const refreshed = new Set<string>()
    const fire = (t: Trigger) => {
      const writes = writesOf(t.functionId)
      const fn = fns.get(t.functionId)
      const refreshes = fn ? detectRefreshes(fn, schema) : []
      add({
        depth,
        kind: 'trigger',
        phase: t.timing,
        tableId: tid,
        event: ev,
        triggerId: t.id,
        functionId: t.functionId,
        writes,
        label: `${t.timing} ${ev} · ${t.name} → ${fns.get(t.functionId)?.name ?? 'sin función'}()`,
        detail: [
          t.level === 'ROW' ? 'por cada fila' : 'una vez por sentencia',
          t.condition?.trim() ? `solo si ${t.condition.trim()}` : null,
          writes.length ? `escribe en ${writes.map((w) => `${w.tableName} (${w.event})`).join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })
      for (const w of writes) run(w.tableId, w.event, depth + 1, [...stack, { tableId: tid, event: ev, triggerId: t.id }], fns.get(t.functionId)?.name)
      for (const v of refreshes) {
        refreshed.add(v.id)
        add({
          depth: depth + 1,
          kind: 'refresh-view',
          tableId: tid,
          event: ev,
          viewId: v.id,
          triggerId: t.id,
          functionId: t.functionId,
          label: `${v.name} se refresca`,
          detail: `REFRESH MATERIALIZED VIEW desde ${fn?.name ?? '?'}()`,
        })
      }
    }
    // Los triggers desactivados en la base de datos aparecen en su turno, pero no se ejecutan.
    const visit = (t: Trigger) =>
      t.enabled === false
        ? add({
            depth,
            kind: 'disabled',
            phase: t.timing,
            tableId: tid,
            event: ev,
            triggerId: t.id,
            label: `${t.name} desactivado en la BD`,
            detail: `${t.timing} ${ev}: no se ejecuta (ALTER TABLE … ENABLE TRIGGER para activarlo)`,
          })
        : fire(t)
    const instead = fired.filter((t) => t.timing === 'INSTEAD OF')
    all.filter((t) => t.timing === 'BEFORE').forEach(visit)
    all.filter((t) => t.timing === 'INSTEAD OF' && t.enabled === false).forEach(visit)
    if (instead.length) instead.forEach(fire)
    else
      add({
        depth,
        kind: 'operation',
        tableId: tid,
        event: ev,
        label: `${ev} en ${tName(tid)}`,
        detail: origin ? `ejecutado por ${origin}()` : 'operación original',
      })
    all.filter((t) => t.timing === 'AFTER').forEach(visit)
    for (const v of dependentMaterializedViews(schema, tid)) {
      if (refreshed.has(v.id)) continue
      add({
        depth,
        kind: 'stale-view',
        tableId: tid,
        event: ev,
        viewId: v.id,
        label: `${v.name} queda desactualizada`,
        detail: `REFRESH MATERIALIZED VIEW ${v.name} para ver el cambio`,
      })
    }
  }

  run(tableId, event, 0, [])
  return { steps, cycles }
}

/** Busca ciclos simulando cada (tabla, evento) que tenga triggers. */
export function findCycles(schema: Schema): CycleInfo[] {
  const all: CycleInfo[] = []
  const seen = new Set<string>()
  for (const t of schema.triggers)
    for (const ev of t.events) {
      if (ev === 'TRUNCATE') continue
      for (const c of simulate(schema, t.tableId, ev, 8).cycles)
        if (!seen.has(c.key)) {
          seen.add(c.key)
          all.push(c)
        }
    }
  return all
}
