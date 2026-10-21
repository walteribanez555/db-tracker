import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { QueryBenchmark } from '@/types/report'

const key = (b: QueryBenchmark) => `${b.versionId}|${b.query}|${b.measuredAt}|${b.source}`

export interface BenchmarkState {
  /** Mediciones registradas por otras features (p. ej. ejecución en BD remota). */
  benchmarks: QueryBenchmark[]
  /** Añade mediciones (deduplica por versión + consulta + fecha + origen). */
  addBenchmarks: (b: QueryBenchmark[]) => void
  /** Elimina todas las mediciones, o solo las de las versiones indicadas. */
  clearBenchmarks: (versionIds?: string[]) => void
}

/**
 * Store de benchmarks de consultas. Uso desde otras features:
 * `useBenchmarkStore.getState().addBenchmarks([{ versionId, query, label, runs, avgMs, p95Ms, source: 'remote', measuredAt }])`
 */
export const useBenchmarkStore = create<BenchmarkState>()(
  persist(
    (set) => ({
      benchmarks: [],
      addBenchmarks: (incoming) =>
        set((s) => {
          const map = new Map(s.benchmarks.map((b) => [key(b), b]))
          for (const b of incoming) map.set(key(b), b)
          return { benchmarks: [...map.values()] }
        }),
      clearBenchmarks: (versionIds) =>
        set((s) => ({
          benchmarks: versionIds ? s.benchmarks.filter((b) => !versionIds.includes(b.versionId)) : [],
        })),
    }),
    { name: 'db-tracker:benchmarks' },
  ),
)
