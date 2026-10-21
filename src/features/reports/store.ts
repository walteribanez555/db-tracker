import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { getSharedBenchmarks, useSharedBenchmarks } from '@/collab'
import type { QueryBenchmark } from '@/types/report'

const key = (b: QueryBenchmark) => `${b.versionId}|${b.query}|${b.measuredAt}|${b.source}`

/**
 * Mediciones locales + las del documento compartido (Y.Map 'benchmarks', escritas por agentes MCP).
 * Sin duplicados: los compartidos ya son únicos por id; contra los locales se compara versión + consulta + fecha + origen
 * (al dejar de compartir se guardan como locales y no deben contarse dos veces).
 */
export function mergeBenchmarks<T extends QueryBenchmark>(local: T[], shared: readonly QueryBenchmark[]): T[] {
  if (!shared.length) return local
  const seen = new Set(local.map(key))
  const ids = new Set<string>()
  const extra: T[] = []
  for (const b of shared) {
    const id = (b as { id?: string }).id ?? key(b)
    if (ids.has(id) || seen.has(key(b))) continue
    ids.add(id)
    seen.add(key(b))
    extra.push(b as T)
  }
  return extra.length ? [...local, ...extra] : local
}

/** Todas las mediciones para Informes (locales + compartidas en la sesión). */
export function useReportBenchmarks(): QueryBenchmark[] {
  const local = useBenchmarkStore((s) => s.benchmarks)
  const shared = useSharedBenchmarks()
  return useMemo(() => mergeBenchmarks(local, shared), [local, shared])
}

/** Igual que useReportBenchmarks, fuera de React (PDF). */
export const getReportBenchmarks = (): QueryBenchmark[] => mergeBenchmarks(useBenchmarkStore.getState().benchmarks, getSharedBenchmarks())

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
