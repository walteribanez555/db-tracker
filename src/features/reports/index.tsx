import { endOfDay, format, startOfDay, subDays } from 'date-fns'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { useGithubReport } from '@/features/github/useGithubReport'
import { LoadSampleButton } from '@/features/versions'
import { STAGGER_LIST, useLaneColor } from '@/features/versions/lib'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'

import { fmtDay, fmtNum, fmtShort } from './format'
import { GithubReportSlot } from './github-slot'
import { ReportPdfButton } from './pdf/ReportPdfButton'
import { buildFlowRows, estimatedBenchmarks, fmtMs, jumpSeries, recommend, sourceLabel, type DateRange, type FlowRow } from './lib'
import { useBenchmarkStore } from './store'

export { GithubReportSlot, type GithubReportSlotProps } from './github-slot'
export { useBenchmarkStore, type BenchmarkState } from './store'
export { ReportPdfButton } from './pdf/ReportPdfButton'
export type { BenchmarkWithDetail } from './pdf/data'

type Preset = 'todo' | '7' | '30' | '90' | 'custom'

// Paleta categórica validada (light / dark) para series que no son ramas.
const SERIES = [
  { light: '#2a78d6', dark: '#3987e5' },
  { light: '#eb6834', dark: '#d95926' },
  { light: '#1baf7a', dark: '#199e70' },
  { light: '#eda100', dark: '#c98500' },
  { light: '#e87ba4', dark: '#d55181' },
  { light: '#008300', dark: '#008300' },
]

const latencyConfig = {
  avg: { label: 'Media', theme: SERIES[0] },
  p95: { label: 'p95', theme: SERIES[1] },
} satisfies ChartConfig

const jumpsConfig = {
  tables: { label: 'Tablas', theme: SERIES[0] },
  columns: { label: 'Columnas', theme: SERIES[1] },
  indexes: { label: 'Índices', theme: SERIES[2] },
  relations: { label: 'Relaciones', theme: SERIES[3] },
  views: { label: 'Vistas', theme: SERIES[4] },
  triggers: { label: 'Triggers', theme: SERIES[5] },
} satisfies ChartConfig

const JUMP_KEYS = Object.keys(jumpsConfig) as (keyof typeof jumpsConfig)[]

const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Props comunes de animación de entrada de las barras (desactivadas con reduced-motion). */
const barAnim = (i = 0) => ({
  isAnimationActive: !prefersReducedMotion(),
  animationBegin: i * 60,
  animationDuration: 300,
  animationEasing: 'ease-out' as const,
})

/** Título de bloque del informe para CollapsibleSection (jerarquía tipográfica de sección). */
const BlockTitle = ({ children }: { children: React.ReactNode }) => <span className="text-base font-semibold text-foreground">{children}</span>

const toInput = (d: Date | null) => (d ? format(d, 'yyyy-MM-dd') : '')
const fromInput = (s: string, end = false) => {
  if (!s) return null
  const d = new Date(`${s}T00:00:00`)
  return end ? endOfDay(d) : startOfDay(d)
}

export function ReportsView() {
  const project = useProjectStore((s) => s.project)
  const remote = useBenchmarkStore((s) => s.benchmarks)

  const [preset, setPreset] = useState<Preset>('todo')
  const [range, setRange] = useState<DateRange>({ from: null, to: null })
  const [weight, setWeight] = useState(60)

  const applyPreset = (p: Preset) => {
    setPreset(p)
    if (p === 'todo') setRange({ from: null, to: null })
    else if (p !== 'custom') setRange({ from: startOfDay(subDays(new Date(), Number(p))), to: endOfDay(new Date()) })
  }

  const estimates = useMemo(() => estimatedBenchmarks(project), [project])
  const rows = useMemo(() => buildFlowRows(project, remote, estimates, range, weight / 100), [project, remote, estimates, range, weight])
  const rec = useMemo(() => recommend(rows), [rows])
  const jumps = useMemo(() => jumpSeries(project, range), [project, range])

  const ownIds = useMemo(() => new Set(project.versions.map((v) => v.id)), [project.versions])
  const remoteCount = remote.filter((b) => b.source === 'remote' && ownIds.has(b.versionId)).length
  const active = rows.filter((r) => r.versions > 0)
  const versionsInRange = active.reduce((n, r) => n + r.versions, 0)
  const biggest = jumps.reduce<(typeof jumps)[number] | null>((m, j) => (!m || j.total > m.total ? j : m), null)
  // Si hay mediciones reales, la menor latencia se elige solo entre ramas medidas (no se mezclan fuentes).
  const anyMeasured = active.some((r) => r.latencySource === 'remote')
  const fastest = [...active]
    .filter((r) => r.p95QueryMs !== null && (!anyMeasured || r.latencySource === 'remote'))
    .sort((a, b) => a.p95QueryMs! - b.p95QueryMs!)[0]
  const agile = [...active].filter((r) => r.avgHoursBetweenVersions > 0).sort((a, b) => a.avgHoursBetweenVersions - b.avgHoursBetweenVersions)[0]

  if (project.versions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-base font-semibold">Sin datos para informar</h1>
          <p className="text-sm text-muted-foreground">
            Los informes comparan los flujos (ramas) por latencia, agilidad y saltos entre versiones. Confirma versiones o carga el
            proyecto de ejemplo.
          </p>
          <LoadSampleButton variant="default" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-8 px-6 py-6">
        {/* Cabecera + filtros */}
        <header className="space-y-4 border-b pb-5">
          <div>
            <h1 className="text-xl font-semibold">Informes de flujos</h1>
            <p className="text-sm text-muted-foreground">
              {project.name} · compara cada rama por tiempo de respuesta, agilidad y saltos estructurales.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rng-preset">Periodo</Label>
              <Select value={preset} onValueChange={(v) => applyPreset(v as Preset)}>
                <SelectTrigger id="rng-preset" size="sm" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">Todo el historial</SelectItem>
                  <SelectItem value="7">Últimos 7 días</SelectItem>
                  <SelectItem value="30">Últimos 30 días</SelectItem>
                  <SelectItem value="90">Últimos 90 días</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rng-from">Desde</Label>
              <Input
                id="rng-from"
                type="date"
                className="h-7 w-40"
                value={toInput(range.from)}
                onChange={(e) => {
                  setPreset('custom')
                  setRange((r) => ({ ...r, from: fromInput(e.target.value) }))
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rng-to">Hasta</Label>
              <Input
                id="rng-to"
                type="date"
                className="h-7 w-40"
                value={toInput(range.to)}
                onChange={(e) => {
                  setPreset('custom')
                  setRange((r) => ({ ...r, to: fromInput(e.target.value, true) }))
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rng-weight">
                Peso de la latencia en la recomendación: <span className="tabular-nums">{weight}%</span>
              </Label>
              <input
                id="rng-weight"
                type="range"
                min={0}
                max={100}
                step={5}
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="h-7 w-56 accent-brand"
                aria-valuetext={`${weight}% latencia, ${100 - weight}% saltos`}
              />
            </div>
            <div className="ml-auto flex flex-col items-end gap-2">
              <ReportPdfButton range={range} latencyWeight={weight / 100} />
              <p className="text-xs text-muted-foreground">
                Latencia:{' '}
                {remoteCount > 0
                  ? `${remoteCount} mediciones en BD remota (las ramas sin medir usan estimación)`
                  : 'estimación heurística local (sin mediciones remotas)'}
              </p>
            </div>
          </div>
        </header>

        {/* Cifras clave en una fila con divisores */}
        <dl className="grid grid-cols-2 gap-y-4 border-b pb-6 md:grid-cols-4 md:divide-x">
          <Figure label="Versiones en el periodo" value={String(versionsInRange)} detail={`${active.length} de ${rows.length} ramas con actividad`} />
          <Figure
            label="Menor latencia p95"
            value={fastest ? fmtMs(fastest.p95QueryMs) : '—'}
            tag={fastest ? sourceLabel(fastest.latencySource) : undefined}
            detail={fastest ? <span className="font-mono">{fastest.branchName}</span> : 'sin datos'}
          />
          <Figure
            label="Flujo más ágil"
            value={agile ? `${fmtNum(agile.avgHoursBetweenVersions)} h` : '—'}
            detail={agile ? <><span className="font-mono">{agile.branchName}</span> · entre versiones</> : 'sin datos'}
          />
          <Figure
            label="Mayor salto"
            value={biggest ? String(biggest.total) : '—'}
            detail={biggest ? <><span className="font-mono">{biggest.branch}</span> · {biggest.message}</> : 'sin datos'}
          />
        </dl>

        {/* Recomendación */}
        <section aria-labelledby="rec-title" className="space-y-1.5 border-b pb-6">
          <h2 id="rec-title" className="text-base font-semibold">
            Recomendación
          </h2>
          {rec ? (
            <>
              <p className="max-w-3xl text-sm leading-relaxed">{rec.text}</p>
              {rec.excluded.length > 0 && (
                <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                  {rec.excluded.map((r) => (
                    <li key={r.branchId}>
                      <span aria-hidden>! </span>
                      {r.scoreNote}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Puntuación = {weight}% p95 normalizado + {100 - weight}% saltos totales normalizados (menor es mejor). Ajusta el peso arriba.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No hay ramas con versiones y latencia en el periodo elegido.</p>
          )}
        </section>

        {/* Gráficos */}
        <div className="grid gap-x-10 gap-y-8 border-b pb-8 lg:grid-cols-2">
          <LatencyChart rows={active} />
          <AgilityCharts rows={active} />
        </div>

        <CollapsibleSection
          title={<BlockTitle>Saltos por versión</BlockTitle>}
          meta={biggest ? `mayor salto ${biggest.total}` : undefined}
          storageKey="reports:saltos"
          className="border-b pb-8"
          contentClassName="space-y-3 pt-1"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-muted-foreground">Cambios estructurales de cada versión respecto a la anterior, por tipo, en orden temporal.</p>
            {biggest && (
              <p className="text-sm">
                Mayor salto: <span className="font-semibold tabular-nums">{biggest.total}</span>{' '}
                <span className="text-muted-foreground">
                  en <span className="font-mono">{biggest.branch}</span> el {fmtDay(biggest.date)}
                </span>
              </p>
            )}
          </div>
          {jumps.length ? (
            <ChartContainer config={jumpsConfig} className="aspect-auto h-72 w-full">
              <BarChart data={jumps} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="versionId" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tickFormatter={(id: string) => {
                  const p = jumps.find((j) => j.versionId === id)
                  return p ? fmtShort(p.date) : ''
                }} />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const p = payload?.[0]?.payload as (typeof jumps)[number] | undefined
                        return p ? `${p.message} · ${p.branch} · ${fmtShort(p.date)} (${p.total} saltos)` : ''
                      }}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
                {JUMP_KEYS.map((k, i) => (
                  <Bar key={k} dataKey={k} stackId="j" fill={`var(--color-${k})`} stroke="var(--background)" strokeWidth={1} maxBarSize={36} {...barAnim(i)} />
                ))}
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="text-sm text-muted-foreground">No hay versiones en el periodo.</p>
          )}
        </CollapsibleSection>

        <ComparisonTable rows={rows} bestId={rec?.best.branchId ?? null} />

        <div className="pb-6">
          <GithubReport />
        </div>
      </div>
    </div>
  )
}

function Figure({ label, value, detail, tag }: { label: string; value: string; detail: React.ReactNode; tag?: string }) {
  return (
    <div className="min-w-0 px-0 md:px-5 md:first:pl-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd key={value} className="mt-1 animate-in text-2xl font-semibold tabular-nums duration-300 fade-in">
        {value}
        {tag && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{tag}</span>}
      </dd>
      <dd className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</dd>
    </div>
  )
}

function LatencyChart({ rows }: { rows: FlowRow[] }) {
  const mixed = rows.some((r) => r.latencySource === 'remote') && rows.some((r) => r.latencySource === 'estimate')
  const data = rows
    .filter((r) => r.avgQueryMs !== null)
    .map((r) => ({ name: mixed ? `${r.branchName} (${sourceLabel(r.latencySource)})` : r.branchName, avg: r.avgQueryMs, p95: r.p95QueryMs, src: r.latencySource }))
  return (
    <CollapsibleSection title={<BlockTitle>Tiempo de respuesta</BlockTitle>} storageKey="reports:latencia" contentClassName="space-y-3 pt-1">
      <p className="text-sm text-muted-foreground">Latencia media y p95 de las consultas de prueba en la última versión medida de cada rama (ms).</p>
      {data.length ? (
        <ChartContainer config={latencyConfig} className="aspect-auto w-full" style={{ height: Math.max(160, data.length * 52 + 60) }}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }} barGap={2}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} unit=" ms" fontSize={11} />
            <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={150} fontSize={11} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
            <Bar dataKey="avg" fill="var(--color-avg)" radius={[0, 4, 4, 0]} maxBarSize={16} {...barAnim(0)} />
            <Bar dataKey="p95" fill="var(--color-p95)" radius={[0, 4, 4, 0]} maxBarSize={16} {...barAnim(1)} />
          </BarChart>
        </ChartContainer>
      ) : (
        <p className="text-sm text-muted-foreground">Sin mediciones ni estimaciones en el periodo.</p>
      )}
    </CollapsibleSection>
  )
}

function BranchBars({ rows, dataKey, unit, label }: { rows: FlowRow[]; dataKey: 'avgHoursBetweenVersions' | 'versionsPerDay'; unit: string; label: string }) {
  const laneColor = useLaneColor()
  const config = { [dataKey]: { label } } satisfies ChartConfig
  const data = rows.map((r) => ({ name: r.branchName, [dataKey]: r[dataKey], color: laneColor(r.color) }))
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(140, data.length * 34 + 40) }}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} unit={unit} fontSize={11} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={150} fontSize={11} />
        <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey={dataKey} radius={[0, 4, 4, 0]} maxBarSize={18} {...barAnim(0)}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

function AgilityCharts({ rows }: { rows: FlowRow[] }) {
  return (
    <CollapsibleSection title={<BlockTitle>Agilidad</BlockTitle>} storageKey="reports:agilidad" contentClassName="space-y-3 pt-1">
      <p className="text-sm text-muted-foreground">Menos horas entre versiones y más versiones por día indican un flujo más ágil.</p>
      {rows.length ? (
        <div className="space-y-4">
          <figure className="space-y-1">
            <figcaption className="text-xs font-medium text-muted-foreground">Horas medias entre versiones</figcaption>
            <BranchBars rows={rows} dataKey="avgHoursBetweenVersions" unit=" h" label="Horas entre versiones" />
          </figure>
          <figure className="space-y-1">
            <figcaption className="text-xs font-medium text-muted-foreground">Versiones por día</figcaption>
            <BranchBars rows={rows} dataKey="versionsPerDay" unit="" label="Versiones/día" />
          </figure>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sin versiones en el periodo.</p>
      )}
    </CollapsibleSection>
  )
}

function ComparisonTable({ rows, bestId }: { rows: FlowRow[]; bestId: string | null }) {
  const laneColor = useLaneColor()
  return (
    <CollapsibleSection
      title={<BlockTitle>Comparativa de flujos</BlockTitle>}
      meta={`${rows.length} ramas`}
      storageKey="reports:comparativa"
      className="border-b pb-8"
      contentClassName="space-y-3 pt-1"
    >
      <p className="text-sm text-muted-foreground">Cada latencia indica si es «medido» (BD remota) o «estimado». Si hay ramas medidas, las estimadas no puntúan.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Flujo</TableHead>
            <TableHead className="text-right">Versiones</TableHead>
            <TableHead className="text-right">h entre versiones</TableHead>
            <TableHead className="text-right">Versiones/día</TableHead>
            <TableHead className="text-right">Saltos</TableHead>
            <TableHead className="text-right">Mayor salto</TableHead>
            <TableHead className="text-right">Latencia media</TableHead>
            <TableHead className="text-right">p95</TableHead>
            <TableHead className="text-right">Puntuación</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className={STAGGER_LIST}>
          {rows.map((r) => {
            const best = r.branchId === bestId
            return (
              <TableRow key={r.branchId} className={cn('transition-colors', best && 'bg-brand/10 hover:bg-brand/15')}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: laneColor(r.color) }} />
                    <span className="font-mono text-xs">{r.branchName}</span>
                    {best && <span className="text-xs font-medium">★ recomendado</span>}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.versions}</TableCell>
                <TableCell className="text-right tabular-nums">{r.versions ? fmtNum(r.avgHoursBetweenVersions) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.versions ? fmtNum(r.versionsPerDay, 2) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.totalJumps}</TableCell>
                <TableCell className="text-right tabular-nums">{r.maxJump}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtMs(r.avgQueryMs)}
                  {r.latencySource && <span className="ml-1 text-xs text-muted-foreground">{sourceLabel(r.latencySource)}</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtMs(r.p95QueryMs)}</TableCell>
                <TableCell className="text-right tabular-nums" title={r.scoreNote}>
                  {r.score !== null ? fmtNum(r.score, 2) : r.scoreNote ? <span className="text-xs text-muted-foreground">sin medir</span> : '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </CollapsibleSection>
  )
}

function GithubReport() {
  const { reports, loading, error, needsAuth } = useGithubReport()
  const message = needsAuth ? 'Conecta tu cuenta en GitHub para ver estos datos.' : error?.message
  return <GithubReportSlot reports={reports} loading={loading} error={message} />
}
