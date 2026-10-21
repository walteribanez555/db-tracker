import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'

import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import { githubUrls } from './api'
import { fmtAgo, fmtDate, fmtHours, plural } from './format'
import type { UseGithubReport } from './useGithubReport'

export function ReportSection({ report }: { report: UseGithubReport }) {
  const { data, loading, error, refresh, link } = report
  if (!link) return null
  const metrics = new Map(data?.metrics.map((m) => [m.branch, m]))

  return (
    <CollapsibleSection
      title="Informe"
      meta={data ? plural(data.summary.totalCommits, 'commit', 'commits') : undefined}
      storageKey="github:report"
      className="py-4"
      contentClassName="pt-3"
      actions={
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <a href={githubUrls.network(link.owner, link.repo)} target="_blank" rel="noreferrer">
              Grafo de red <ExternalLink />
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Actualizar
          </Button>
        </div>
      }
    >
      <p className="max-w-2xl text-sm text-muted-foreground">
        Commits y cambios de cada rama comparados con la rama por defecto. La agilidad es el tiempo medio entre commits; el lead time mide
        desde que el flujo se bifurcó hasta su último commit.
      </p>

      {error && (
        <p className="mt-4 text-sm text-destructive">
          {error.message}
          {error.code === 'rate_limited' && error.resetAt && <> (se restablece {fmtAgo(error.resetAt)})</>}
        </p>
      )}
      {!data && loading && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Consultando GitHub…
        </p>
      )}

      {data && (
        <>
          <p key={data.generatedAt} className="mt-4 text-sm text-muted-foreground animate-in fade-in duration-300">
            {plural(data.summary.branches, 'rama', 'ramas')} · {plural(data.summary.totalCommits, 'commit', 'commits')} · media entre commits{' '}
            <span className="text-foreground">{fmtHours(data.summary.avgHoursBetweenCommits)}</span> · lead time medio de los flujos{' '}
            <span className="text-foreground">{fmtHours(data.summary.avgLeadTimeHours)}</span>
          </p>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Rama</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead>Primer commit</TableHead>
                <TableHead>Último commit</TableHead>
                <TableHead className="text-right">Líneas</TableHead>
                <TableHead className="text-right">Archivos</TableHead>
                <TableHead className="text-right">Adelante / detrás</TableHead>
                <TableHead className="text-right">Entre commits</TableHead>
                <TableHead className="text-right">Lead time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.branches.map((b, i) => {
                const m = metrics.get(b.branch)
                return (
                  <TableRow
                    key={b.branch}
                    style={i < 8 ? { animationDelay: `${i * 30}ms` } : undefined}
                    className="transition-colors animate-in fade-in slide-in-from-top-1 fill-mode-backwards duration-200"
                  >
                    <TableCell>
                      <a
                        href={githubUrls.commits(link.owner, link.repo, b.branch)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono transition-colors hover:text-brand hover:underline"
                      >
                        {b.branch}
                      </a>
                      {m?.isDefault && <span className="ml-2 text-xs text-muted-foreground">por defecto</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.commits}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(b.firstCommitAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(b.lastCommitAt)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      <span className="text-emerald-700 dark:text-emerald-400">+{b.additions}</span>{' '}
                      <span className="text-red-700 dark:text-red-400">−{b.deletions}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.filesChanged}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m?.isDefault ? '—' : `${b.aheadBy} / ${b.behindBy}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHours(m?.avgHoursBetweenCommits)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtHours(m?.leadTimeHours)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Generado {fmtAgo(data.generatedAt)}
            {data.rateLimit.remaining !== null && <> · quedan {data.rateLimit.remaining} peticiones a la API</>}. En la rama por defecto,
            las líneas y archivos se cuentan desde su primer commit.
          </p>
        </>
      )}
    </CollapsibleSection>
  )
}
