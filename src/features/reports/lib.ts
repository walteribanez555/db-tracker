import { computeBranchMetrics, estimateVersionBenchmarks, jumpBreakdown, versionDiff } from '@/lib/diff'
import { SAMPLE_PROJECT_ID, sampleBenchmarks } from '@/data/sample-project'
import type { BranchMetrics, QueryBenchmark } from '@/types/report'
import type { Project } from '@/types/schema'

export type LatencySource = 'remote' | 'estimate' | null

export interface FlowRow extends BranchMetrics {
  color: string
  latencySource: LatencySource
  /** Puntuación 0–1 (menor = mejor equilibrio). null si faltan datos o si se excluye. */
  score: number | null
  /** Motivo por el que la rama no puntúa (p. ej. latencia solo estimada habiendo ramas medidas). */
  scoreNote?: string
}

export const sourceLabel = (s: LatencySource) => (s === 'remote' ? 'medido' : s === 'estimate' ? 'estimado' : '')

export interface DateRange {
  from: Date | null
  to: Date | null
}

/** Estimaciones para todas las versiones: las de ejemplo si es el proyecto de ejemplo; si no, carga sintética. */
export function estimatedBenchmarks(project: Project): QueryBenchmark[] {
  const sample = project.id === SAMPLE_PROJECT_ID ? new Set(sampleBenchmarks.map((b) => b.versionId)) : new Set<string>()
  return project.versions.flatMap((v) =>
    sample.has(v.id) ? sampleBenchmarks.filter((b) => b.versionId === v.id) : estimateVersionBenchmarks(v),
  )
}

/**
 * Métricas por flujo combinando mediciones remotas (prioritarias) y estimaciones (para las ramas sin medición),
 * con una puntuación de equilibrio latencia vs. saltos ponderada por `latencyWeight` (0–1).
 */
export function buildFlowRows(
  project: Project,
  remote: QueryBenchmark[],
  estimates: QueryBenchmark[],
  range: DateRange,
  latencyWeight: number,
): FlowRow[] {
  const ids = new Set(project.versions.map((v) => v.id))
  const remoteOwn = remote.filter((b) => ids.has(b.versionId) && b.source === 'remote')
  const base = { from: range.from, to: range.to }
  const withRemote = computeBranchMetrics(project, { ...base, benchmarks: remoteOwn })
  const withEstimate = computeBranchMetrics(project, { ...base, benchmarks: estimates })

  const rows: FlowRow[] = withRemote.map((m, i) => {
    const est = withEstimate[i]
    const hasRemote = m.avgQueryMs !== null
    const color = project.branches.find((b) => b.id === m.branchId)?.color ?? '#888888'
    return {
      ...m,
      avgQueryMs: hasRemote ? m.avgQueryMs : est.avgQueryMs,
      p95QueryMs: hasRemote ? m.p95QueryMs : est.p95QueryMs,
      latencySource: hasRemote ? 'remote' : est.avgQueryMs !== null ? 'estimate' : null,
      color,
      score: null,
    }
  })

  // No se comparan fuentes distintas: si alguna rama tiene mediciones reales, las estimadas no puntúan.
  const anyRemote = rows.some((r) => r.versions > 0 && r.latencySource === 'remote')
  for (const r of rows) {
    if (r.versions > 0 && anyRemote && r.latencySource === 'estimate') r.scoreNote = `${r.branchName} sin medir: mide su versión en Importar/Exportar`
  }
  const candidates = rows.filter((r) => r.versions > 0 && r.p95QueryMs !== null && !r.scoreNote)
  if (candidates.length) {
    const lat = candidates.map((r) => r.p95QueryMs!)
    const jumps = candidates.map((r) => r.totalJumps)
    const norm = (v: number, arr: number[]) => {
      const min = Math.min(...arr)
      const max = Math.max(...arr)
      return max === min ? 0 : (v - min) / (max - min)
    }
    for (const r of candidates) {
      r.score = latencyWeight * norm(r.p95QueryMs!, lat) + (1 - latencyWeight) * norm(r.totalJumps, jumps)
    }
  }
  return rows
}

export interface Recommendation {
  best: FlowRow
  runnerUp?: FlowRow
  fastest: FlowRow
  calmest: FlowRow
  /** Ramas excluidas de la puntuación (con su motivo en `scoreNote`). */
  excluded: FlowRow[]
  text: string
}

const ms = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('es', { maximumFractionDigits: 2 })} ms`)

export function recommend(rows: FlowRow[]): Recommendation | null {
  const scored = rows.filter((r) => r.score !== null).sort((a, b) => a.score! - b.score!)
  if (!scored.length) return null
  const [best, runnerUp] = scored
  const fastest = [...scored].sort((a, b) => a.p95QueryMs! - b.p95QueryMs!)[0]
  const calmest = [...scored].sort((a, b) => a.totalJumps - b.totalJumps)[0]

  const excluded = rows.filter((r) => r.scoreNote)
  const src = (r: FlowRow) => (r.latencySource === 'remote' ? 'medido' : 'estimado')
  let text = `${best.branchName} ofrece el mejor equilibrio: p95 ${src(best)} de ${ms(best.p95QueryMs)} con ${best.totalJumps} saltos en ${best.versions} ${best.versions === 1 ? 'versión' : 'versiones'}.`
  if (fastest.branchId !== best.branchId) {
    text += ` ${fastest.branchName} es más rápido (p95 ${src(fastest)} ${ms(fastest.p95QueryMs)}) pero acumula ${fastest.totalJumps} saltos.`
  } else if (calmest.branchId !== best.branchId) {
    text += ` ${calmest.branchName} cambia menos (${calmest.totalJumps} saltos) pero su p95 es de ${ms(calmest.p95QueryMs)}.`
  }
  if (runnerUp) text += ` Segunda opción: ${runnerUp.branchName}.`
  if (excluded.length) {
    text += ` Solo se comparan latencias medidas en BD remota; quedan fuera ${excluded.map((r) => r.branchName).join(', ')} (sin medir: mide su versión en Importar/Exportar).`
  }
  return { best, runnerUp, fastest, calmest, excluded, text }
}

export interface JumpPoint {
  versionId: string
  label: string
  message: string
  branch: string
  date: string
  tables: number
  columns: number
  indexes: number
  relations: number
  views: number
  triggers: number
  total: number
}

/** Saltos por versión (en orden temporal) desglosados por tipo de cambio. */
export function jumpSeries(project: Project, range: DateRange): JumpPoint[] {
  const from = range.from?.getTime() ?? -Infinity
  const to = range.to?.getTime() ?? Infinity
  return [...project.versions]
    .filter((v) => {
      const t = new Date(v.createdAt).getTime()
      return t >= from && t <= to
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((v) => {
      const d = versionDiff(project, v)
      const b = jumpBreakdown(d)
      return {
        versionId: v.id,
        label: v.id,
        message: v.message,
        branch: project.branches.find((x) => x.id === v.branchId)?.name ?? '?',
        date: v.createdAt,
        ...b,
        total: d.jumps,
      }
    })
}

export const fmtMs = ms
