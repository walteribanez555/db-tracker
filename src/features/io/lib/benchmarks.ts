// Punto de integración con la feature de informes: las mediciones remotas se registran
// en `useBenchmarkStore` (src/features/reports/store.ts) para que aparezcan en /informes y en el PDF.
import type { BenchmarkWithDetail } from '@/features/reports/pdf/data'
import { useBenchmarkStore } from '@/features/reports/store'
import type { QueryBenchmark } from '@/types/report'

import type { BenchmarkDetail } from '../api-types'

/** Une cada medición con su detalle (mín/máx/mediana, filas y plan de EXPLAIN). */
export function withDetails(results: QueryBenchmark[], details: BenchmarkDetail[]): BenchmarkWithDetail[] {
  return results.map((r) => {
    const d = details.find((x) => x.label === r.label && x.query === r.query && !x.error)
    if (!d) return r
    return { ...r, minMs: d.minMs, maxMs: d.maxMs, medianMs: d.medianMs, rows: d.rows, ...(d.plan ? { plan: d.plan } : {}) }
  })
}

export function recordBenchmarks(results: QueryBenchmark[], details: BenchmarkDetail[] = []) {
  if (!results.length) return
  useBenchmarkStore.getState().addBenchmarks(withDetails(results, details))
}
