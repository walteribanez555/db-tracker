// Sección "Datos de GitHub" del informe. No obtiene datos: el agente de GitHub la conecta pasándole
// `reports` (p. ej. desde `useGithubReport()`).
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import type { GithubBranchReport } from '@/types/report'

import { TruncatedTick } from './chart-tick'
import { fmtDay } from './format'

export interface GithubReportSlotProps {
  reports?: GithubBranchReport[]
  loading?: boolean
  error?: string | null
  /** Contenido opcional a la derecha del título (p. ej. botón "Actualizar"). */
  actions?: React.ReactNode
}

const config = {
  additions: { label: 'Adiciones', theme: { light: '#1baf7a', dark: '#199e70' } },
  deletions: { label: 'Eliminaciones', theme: { light: '#e34948', dark: '#e66767' } },
} satisfies ChartConfig

const n = (v: number) => v.toLocaleString('es')

export function GithubReportSlot({ reports, loading, error, actions }: GithubReportSlotProps) {
  const isMobile = useIsMobile()
  return (
    <CollapsibleSection
      title={<span className="text-base font-semibold text-foreground">Datos de GitHub</span>}
      meta={reports?.length ? `${reports.length} ramas` : undefined}
      actions={actions}
      storageKey="reports:github"
      contentClassName="space-y-4 pt-1"
    >
      <p className="text-sm text-muted-foreground">Commits, adiciones y eliminaciones por rama del repositorio enlazado.</p>
      {error ? (
        <p className="border-l-2 border-destructive pl-3 text-sm text-destructive">{error}</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Cargando datos de GitHub…</p>
      ) : !reports?.length ? (
        <p className="text-sm text-muted-foreground">
          Sin datos. Enlaza un repositorio y sincroniza las ramas desde la sección GitHub para ver su actividad aquí.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rama</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead className="text-right">Adiciones</TableHead>
                <TableHead className="text-right">Eliminaciones</TableHead>
                <TableHead className="text-right">Archivos</TableHead>
                <TableHead className="text-right">Delante / detrás</TableHead>
                <TableHead>Último commit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r) => (
                <TableRow key={r.branch}>
                  <TableCell className="font-mono text-xs">{r.branch}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(r.commits)}</TableCell>
                  <TableCell className="text-right text-emerald-700 tabular-nums dark:text-emerald-400">+{n(r.additions)}</TableCell>
                  <TableCell className="text-right text-red-700 tabular-nums dark:text-red-400">−{n(r.deletions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(r.filesChanged)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.aheadBy} / {r.behindBy}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.lastCommitAt ? fmtDay(r.lastCommitAt) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <figure className="space-y-2">
            <figcaption className="text-sm font-medium">Líneas añadidas y eliminadas por rama</figcaption>
            <ChartContainer config={config} className="aspect-auto h-64 w-full">
              <BarChart data={reports} margin={{ left: 4, right: 8 }} barGap={2}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="branch"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                  fontSize={11}
                  {...(isMobile && { tick: <TruncatedTick axis="x" max={Math.max(4, Math.floor(36 / Math.max(1, reports.length)))} /> })}
                />
                <YAxis tickLine={false} axisLine={false} width={48} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
                <Bar dataKey="additions" fill="var(--color-additions)" radius={[4, 4, 0, 0]} animationDuration={300} animationEasing="ease-out" />
                <Bar dataKey="deletions" fill="var(--color-deletions)" radius={[4, 4, 0, 0]} animationBegin={60} animationDuration={300} animationEasing="ease-out" />
              </BarChart>
            </ChartContainer>
          </figure>
        </div>
      )}
    </CollapsibleSection>
  )
}
