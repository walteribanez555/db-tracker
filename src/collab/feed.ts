// Datos de la sesión que no forman parte del proyecto: actividad (control {t:'activity'}, sobre todo de agentes MCP)
// y benchmarks compartidos (Y.Map 'benchmarks' del documento). Ligero: no importa Yjs. Lo alimenta session.ts.
import { create } from 'zustand'

import type { QueryBenchmark } from '@/types/report'

import type { ActivityEntry } from './protocol'

/** Máximo de entradas de actividad que se conservan (las más recientes). */
export const MAX_ACTIVITY = 200

/** Benchmark del Y.Map 'benchmarks': QueryBenchmark + detalle opcional + quién y dónde lo midió. */
export type SharedBenchmark = QueryBenchmark & {
  /** Clave en el Y.Map. */
  id: string
  minMs?: number
  maxMs?: number
  medianMs?: number
  rows?: number | null
  plan?: string
  /** Nombre del agente que lo midió (si lo indica). */
  agent?: string
  branchId?: string
}

interface FeedState {
  /** Lo más reciente primero. */
  activity: ActivityEntry[]
  benchmarks: SharedBenchmark[]
}

export const useCollabFeed = create<FeedState>()(() => ({ activity: [], benchmarks: [] }))

export function pushActivity(entry: ActivityEntry): void {
  if (!entry || typeof entry.id !== 'string' || !entry.actor) return
  useCollabFeed.setState((s) =>
    s.activity.some((e) => e.id === entry.id) ? s : { activity: [entry, ...s.activity].slice(0, MAX_ACTIVITY) },
  )
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/** Lee las entradas del Y.Map (id → JSON). Ignora las que no tienen la forma mínima de QueryBenchmark. */
export function parseSharedBenchmarks(entries: Iterable<[string, unknown]>): SharedBenchmark[] {
  const out: SharedBenchmark[] = []
  for (const [id, raw] of entries) {
    let b: Partial<SharedBenchmark> | null = null
    try {
      b = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<SharedBenchmark>
    } catch {
      continue
    }
    if (!b || typeof b.versionId !== 'string' || typeof b.query !== 'string' || !num(b.avgMs) || !num(b.p95Ms)) continue
    out.push({
      ...b,
      id,
      label: typeof b.label === 'string' ? b.label : b.query.slice(0, 60),
      runs: num(b.runs) ? b.runs! : 1,
      source: b.source === 'estimate' ? 'estimate' : 'remote',
      measuredAt: typeof b.measuredAt === 'string' ? b.measuredAt : new Date(0).toISOString(),
    } as SharedBenchmark)
  }
  return out.sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
}

export function setSharedBenchmarks(list: SharedBenchmark[]): void {
  useCollabFeed.setState({ benchmarks: list })
}

/** Al entrar en otra sesión: la actividad y los benchmarks de la anterior ya no aplican. */
export function resetFeed(): void {
  useCollabFeed.setState({ activity: [], benchmarks: [] })
}

/** Últimas entradas de actividad de la sesión ({t:'activity'}), lo más reciente primero. */
export const useActivity = (): ActivityEntry[] => useCollabFeed((s) => s.activity)

/** Benchmarks del documento compartido (los escriben agentes con db_benchmark). */
export const useSharedBenchmarks = (): SharedBenchmark[] => useCollabFeed((s) => s.benchmarks)

export const getSharedBenchmarks = (): SharedBenchmark[] => useCollabFeed.getState().benchmarks
