// Modelo de datos del informe PDF (puro: sin React ni store). Se construye antes de componer el documento.
import { format, formatDistanceStrict } from 'date-fns'
import { es } from 'date-fns/locale'

import { estimateQueryCost, versionDiff } from '@/lib/diff'
import { DIALECT_LABELS, generateMigration } from '@/lib/exporters'
import { emptySchema } from '@/store/project'
import type { QueryBenchmark, SchemaDiff } from '@/types/report'
import type { Branch, Project, Schema, Version } from '@/types/schema'

import { buildFlowRows, recommend, type DateRange, type FlowRow } from '../lib'

/** Mediciones con detalle opcional (las que registra la feature io cuando ejecuta en BD remota). */
export type BenchmarkWithDetail = QueryBenchmark & {
  minMs?: number
  maxMs?: number
  medianMs?: number
  rows?: number | null
  plan?: string
}

export interface OperationLog {
  title: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt?: number
  error?: string
  steps: { label: string; detail?: string; ms?: number; status: string }[]
}

export interface PdfSections {
  schemas: boolean
  migrations: boolean
  queries: boolean
  session: boolean
}

export interface PdfOptions {
  sections: PdfSections
  /** Ramas incluidas (ids). */
  branchIds: string[]
  range: DateRange
  /** Peso de la latencia en la recomendación (0–1). */
  latencyWeight: number
}

export interface QueryItem {
  label: string
  sql: string
  source: 'remote' | 'estimate'
  runs: number
  avgMs: number
  p95Ms: number
  minMs?: number
  maxMs?: number
  medianMs?: number
  rows?: number | null
  measuredAt?: string
  plan?: string
  /** Notas de la estimación heurística (índices, recorridos, triggers). */
  notes: string[]
  versionLabel: string
}

export interface VersionSection {
  id: string
  date: string
  author: string
  message: string
  sha?: string
  parentLabel: string | null
  jumps: number
  actions: string[]
  /** Pasos de datos nuevos en esta versión (Schema.dataMigrations que no estaban en el padre). */
  dataSteps: { description: string; sql: string }[]
  migrationSql: string | null
}

export interface FlowSection {
  id: string
  name: string
  description: string
  origin: string
  duration: string
  metrics: FlowRow | undefined
  schema: Schema | null
  schemaLabel: string
  versions: VersionSection[]
  queries: QueryItem[]
  queriesEstimated: boolean
}

export interface ReportData {
  projectName: string
  dialect: string
  generatedAt: string
  period: string
  flowsCount: number
  versionsCount: number
  github?: string
  rows: FlowRow[]
  recommendation: string | null
  /** Ramas excluidas de la puntuación y su motivo. */
  excludedNotes: string[]
  latencySourceNote: string
  flows: FlowSection[]
  operations: OperationLog[]
  sections: PdfSections
}

/* ------------------------------------------------------------------------ */

const fmt = (iso: string | number | Date, f = "d MMM yyyy, HH:mm") => format(new Date(iso), f, { locale: es })
const ts = (iso: string) => new Date(iso).getTime()

/** Frases de acciones a partir del diff (con tipos de columna del esquema destino). */
export function diffActions(d: SchemaDiff, to: Schema): string[] {
  const out: string[] = []
  for (const t of d.addedTables) {
    const table = to.tables.find((x) => x.name === t)
    out.push(`+ tabla ${t}${table ? ` (${table.columns.map((c) => `${c.name} ${c.type}`).join(', ')})` : ''}`)
  }
  for (const t of d.removedTables) out.push(`- tabla ${t}`)
  for (const r of d.renamedTables) out.push(`~ tabla ${r.from} renombrada a ${r.to}`)
  for (const m of d.modifiedTables) {
    const table = to.tables.find((x) => x.name === m.table)
    for (const c of m.addedColumns) {
      const col = table?.columns.find((x) => x.name === c)
      out.push(`+ columna ${m.table}.${c}${col ? ` ${col.type}${col.pk ? ' PK' : ''}${col.nullable ? '' : ' NOT NULL'}` : ''}`)
    }
    for (const c of m.removedColumns) out.push(`- columna ${m.table}.${c}`)
    for (const c of m.changedColumns) {
      if (c.column.startsWith('índice ')) {
        const kind = c.changes[0] === 'eliminado' ? '-' : c.changes[0]?.startsWith('añadido') ? '+' : '~'
        out.push(`${kind} ${c.column} en ${m.table}: ${c.changes.join('; ')}`)
      } else out.push(`~ ${m.table}.${c.column} ${c.changes.join('; ')}`)
    }
  }
  for (const r of d.addedRelations) out.push(`+ relación ${r}`)
  for (const r of d.removedRelations) out.push(`- relación ${r}`)
  for (const v of d.addedViews) out.push(`+ vista ${v}`)
  for (const v of d.removedViews) out.push(`- vista ${v}`)
  for (const v of d.changedViews) out.push(`~ vista ${v}`)
  for (const t of d.addedTriggers) out.push(`+ trigger ${t}`)
  for (const t of d.removedTriggers) out.push(`- trigger ${t}`)
  for (const t of d.changedTriggers) out.push(`~ trigger ${t}`)
  return out
}

function periodLabel(range: DateRange) {
  if (!range.from && !range.to) return 'Todo el historial'
  return `${range.from ? fmt(range.from, 'd MMM yyyy') : 'inicio'} – ${range.to ? fmt(range.to, 'd MMM yyyy') : 'hoy'}`
}

function inRange(v: Version, range: DateRange) {
  const t = ts(v.createdAt)
  return (!range.from || t >= range.from.getTime()) && (!range.to || t <= range.to.getTime())
}

/** Datos generales (portada, resumen y recomendación). */
export function buildReportBase(
  project: Project,
  benchmarks: BenchmarkWithDetail[],
  estimates: QueryBenchmark[],
  operations: OperationLog[],
  opts: PdfOptions,
): Omit<ReportData, 'flows'> {
  const rows = buildFlowRows(project, benchmarks, estimates, opts.range, opts.latencyWeight).filter((r) => opts.branchIds.includes(r.branchId))
  const rec = recommend(rows)
  const versions = project.versions.filter((v) => opts.branchIds.includes(v.branchId) && inRange(v, opts.range))
  const remote = benchmarks.some((b) => b.source === 'remote' && project.versions.some((v) => v.id === b.versionId))
  return {
    projectName: project.name,
    dialect: DIALECT_LABELS[project.dialect] ?? project.dialect,
    generatedAt: fmt(new Date()),
    period: periodLabel(opts.range),
    flowsCount: rows.length,
    versionsCount: versions.length,
    github: project.github ? `${project.github.owner}/${project.github.repo} (${project.github.url})` : undefined,
    rows,
    recommendation: rec?.text ?? null,
    excludedNotes: rows.filter((r) => r.scoreNote).map((r) => r.scoreNote!),
    latencySourceNote: remote
      ? 'Latencia medida en BD remota cuando existe; el resto, estimación heurística local.'
      : 'Latencia estimada con la heurística local (no hay mediciones remotas).',
    operations: opts.sections.session ? operations.filter((o) => o.status !== 'running') : [],
    sections: opts.sections,
  }
}

/** Sección de un flujo: versiones con acciones y migración, esquema final y consultas. */
export function buildFlowSection(
  project: Project,
  branch: Branch,
  rows: FlowRow[],
  benchmarks: BenchmarkWithDetail[],
  estimates: QueryBenchmark[],
  opts: PdfOptions,
): FlowSection {
  const all = project.versions.filter((v) => v.branchId === branch.id).sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
  const versions = all.filter((v) => inRange(v, opts.range))
  const byId = new Map(project.versions.map((v) => [v.id, v]))
  const label = (v: Version) => `${project.branches.find((b) => b.id === v.branchId)?.name ?? '?'} · ${v.message}`

  const origin = branch.forkedFromVersionId ? byId.get(branch.forkedFromVersionId) : undefined
  const head = branch.headVersionId ? byId.get(branch.headVersionId) : all.at(-1)
  const first = origin?.createdAt ?? all[0]?.createdAt ?? branch.createdAt
  const last = all.at(-1)?.createdAt ?? branch.createdAt

  const versionSections: VersionSection[] = versions.map((v) => {
    const parent = v.parentId ? byId.get(v.parentId) : undefined
    const d = versionDiff(project, v)
    return {
      id: v.id,
      date: fmt(v.createdAt),
      author: v.author,
      message: v.message,
      sha: v.githubSha,
      parentLabel: parent ? label(parent) : null,
      jumps: d.jumps,
      actions: diffActions(d, v.schema),
      dataSteps: (v.schema.dataMigrations ?? [])
        .filter((h) => !(parent?.schema.dataMigrations ?? []).some((p) => p.id === h.id))
        .map((h) => ({ description: h.description, sql: h.sql })),
      migrationSql: opts.sections.migrations ? generateMigration(parent?.schema ?? emptySchema(project.dialect), v.schema, project.dialect) : null,
    }
  })

  // Consultas: mediciones de la rama (remotas y/o registradas); si no hay, estimaciones de la cabeza.
  let queriesEstimated = false
  let queries: QueryItem[] = []
  if (opts.sections.queries) {
    const ids = new Set(versions.map((v) => v.id))
    const measured = benchmarks.filter((b) => ids.has(b.versionId))
    const toItem = (b: BenchmarkWithDetail): QueryItem => {
      const v = byId.get(b.versionId)
      return {
        label: b.label,
        sql: b.query,
        source: b.source,
        runs: b.runs,
        avgMs: b.avgMs,
        p95Ms: b.p95Ms,
        minMs: b.minMs,
        maxMs: b.maxMs,
        medianMs: b.medianMs,
        rows: b.rows,
        measuredAt: b.source === 'remote' ? fmt(b.measuredAt) : undefined,
        plan: b.plan,
        notes: b.source === 'estimate' && v ? estimateQueryCost(v.schema, b.query).notes : [],
        versionLabel: v ? `${fmt(v.createdAt, 'd MMM')} · ${v.message}` : b.versionId,
      }
    }
    if (measured.length) queries = measured.map(toItem)
    else if (head) {
      queriesEstimated = true
      queries = estimates.filter((b) => b.versionId === head.id).map(toItem)
    }
  }

  return {
    id: branch.id,
    name: branch.name,
    description: branch.description,
    origin: origin ? `fork desde «${origin.message}» (${label(origin).split(' · ')[0]}, ${fmt(origin.createdAt)})` : 'rama raíz (sin fork)',
    duration: `${fmt(first, 'd MMM yyyy')} – ${fmt(last, 'd MMM yyyy')} (${formatDistanceStrict(new Date(first), new Date(last), { locale: es })})`,
    metrics: rows.find((r) => r.branchId === branch.id),
    schema: opts.sections.schemas ? (head?.schema ?? null) : null,
    schemaLabel: head ? `${head.message} · ${fmt(head.createdAt)}` : 'sin versiones',
    versions: versionSections,
    queries,
    queriesEstimated,
  }
}

/** Nombre de archivo: informe-flujos-<proyecto>-<AAAA-MM-DD>.pdf */
export const reportFileName = (projectName: string, date = new Date()) =>
  `informe-flujos-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'proyecto'}-${format(date, 'yyyy-MM-dd')}.pdf`

export const GLOSSARY: { term: string; text: string }[] = [
  {
    term: 'Tiempo de respuesta (latencia)',
    text: 'Media y percentil 95 (p95) del tiempo de las consultas de prueba en la última versión medida de cada rama. Si existen mediciones en una BD remota (EXPLAIN/ejecución real) se usan esas; si no, una estimación heurística local que considera JOINs, índices en las columnas de unión y filtro, filas supuestas por tabla, vistas y el coste de los triggers en escrituras.',
  },
  {
    term: 'Agilidad',
    text: 'Horas medias entre cada versión y su versión padre (incluye el salto desde la versión de origen del fork) y versiones por día durante el periodo activo de la rama (mínimo un día). Menos horas y más versiones por día indican un flujo más ágil.',
  },
  {
    term: 'Saltos',
    text: 'Número de cambios estructurales entre una versión y su padre: tablas añadidas, eliminadas o renombradas; columnas añadidas, eliminadas o con cambios de tipo, PK, nulabilidad, unicidad o default (cada cambio cuenta); índices; relaciones; vistas y triggers añadidos, eliminados o modificados. Se informa el total por rama y el mayor salto individual.',
  },
  {
    term: 'Puntuación y recomendación',
    text: 'Para cada rama con datos se normalizan (mín–máx) el p95 y los saltos totales y se combinan con el peso de latencia elegido. La rama con menor puntuación es la que mejor equilibra rendimiento y estabilidad del esquema.',
  },
]
