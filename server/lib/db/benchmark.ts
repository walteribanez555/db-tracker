// Medición de consultas: N ejecuciones por consulta en una transacción de SOLO LECTURA
// que siempre termina en ROLLBACK (las consultas no pueden modificar datos).
import { splitStatements } from '../../../src/lib/importers/split.ts'
import type { BenchmarkDetail, BenchmarkResponse } from '../../../src/features/io/api-types.ts'
import type { QueryBenchmark } from '../../../src/types/report.ts'
import { elapsed, now, toDbError, type DbClient } from './client.ts'
import { LIMITS } from './validation.ts'

const round = (n: number) => Math.round(n * 1000) / 1000

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}

async function begin(client: DbClient) {
  if (client.dialect === 'postgresql') {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${LIMITS.benchmarkTimeoutMs}`)
  } else {
    await client.query('START TRANSACTION READ ONLY')
  }
}

async function explain(client: DbClient, query: string): Promise<string> {
  if (client.dialect === 'postgresql') {
    const r = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${query}`)
    return r.rows.map((x) => x['QUERY PLAN']).join('\n')
  }
  try {
    const r = await client.query<Record<string, string>>(`EXPLAIN ANALYZE ${query}`, undefined, { timeoutMs: LIMITS.benchmarkTimeoutMs })
    return r.rows.map((x) => Object.values(x).join('\n')).join('\n')
  } catch {
    // MySQL < 8.0.18 / MariaDB: EXPLAIN sin ANALYZE
    const r = await client.query<Record<string, unknown>>(`EXPLAIN ${query}`)
    return r.rows.map((x) => Object.entries(x).map(([k, v]) => `${k}=${v ?? ''}`).join('  ')).join('\n')
  }
}

export async function runBenchmark(
  client: DbClient,
  input: { queries: { label: string; query: string }[]; runs: number; explain: boolean; versionId: string },
): Promise<BenchmarkResponse> {
  // En Postgres el timeout va con SET LOCAL (sin viajes extra dentro de la medición);
  // en MySQL es una opción del cliente.
  const qopts = client.dialect === 'mysql' ? { timeoutMs: LIMITS.benchmarkTimeoutMs } : undefined
  const results: QueryBenchmark[] = []
  const details: BenchmarkDetail[] = []
  const start = now()
  let truncated = false

  for (const { label, query } of input.queries) {
    if (elapsed(start) > LIMITS.benchmarkBudgetMs) {
      truncated = true
      break
    }
    const q = query.trim().replace(/;+\s*$/, '')
    if (splitStatements(q).length !== 1) {
      details.push({ label, query: q, minMs: 0, maxMs: 0, medianMs: 0, rows: null, error: 'Cada consulta debe ser una única sentencia.' })
      continue
    }
    const times: number[] = []
    let rows: number | null = null
    let plan: string | undefined
    try {
      await begin(client)
      // Calentamiento (no se mide): carga caché y planes.
      await client.query(q, undefined, qopts)
      for (let i = 0; i < input.runs; i++) {
        const t = now()
        const r = await client.query(q, undefined, qopts)
        times.push(elapsed(t))
        rows = r.rowCount
        if (elapsed(start) > LIMITS.benchmarkBudgetMs) {
          truncated = true
          break
        }
      }
      if (input.explain) plan = await explain(client, q).catch((e) => `No se pudo obtener el plan: ${toDbError(e).message}`)
      await client.query('ROLLBACK')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      details.push({ label, query: q, minMs: 0, maxMs: 0, medianMs: 0, rows: null, error: toDbError(err).message })
      continue
    }
    const sorted = [...times].sort((a, b) => a - b)
    const avg = times.reduce((a, b) => a + b, 0) / (times.length || 1)
    results.push({
      versionId: input.versionId,
      query: q,
      label,
      runs: times.length,
      avgMs: round(avg),
      p95Ms: round(percentile(sorted, 95)),
      source: 'remote',
      measuredAt: new Date().toISOString(),
    })
    details.push({
      label,
      query: q,
      minMs: round(sorted[0] ?? 0),
      maxMs: round(sorted[sorted.length - 1] ?? 0),
      medianMs: round(percentile(sorted, 50)),
      rows,
      ...(plan ? { plan } : {}),
    })
  }
  return { ok: true, results, details, totalMs: round(elapsed(start)), truncated }
}
