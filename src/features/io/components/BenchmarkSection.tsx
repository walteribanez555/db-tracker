// Medir rendimiento: consultas sugeridas (o propias) ejecutadas N veces en la BD remota.
// Los resultados se registran en el store de informes (useBenchmarkStore).
import { Gauge, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { toast } from 'sonner'

import { CodeEditor, sqlLanguageFor } from '@/components/code'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useProjectStore } from '@/store/project'
import { cn } from '@/lib/utils'
import type { RemoteConnection, Schema } from '@/types/schema'

import type { BenchmarkResponse, SampleQuery } from '../api-types'
import { dbApi, toPayload } from '../lib/api'
import { recordBenchmarks } from '../lib/benchmarks'
import { runBenchmarkFlow } from '../lib/flows'
import { enterItem, fadeIn, stagger } from '../lib/motion'
import { getPassword } from '../lib/passwords'
import { GrowBar } from './GrowBar'
import { SourceSelect } from './SourceSelect'

interface Row extends Pick<SampleQuery, 'label' | 'query'> {
  key: string
  selected: boolean
}

let seq = 0
const key = () => `q${++seq}`

export function BenchmarkSection({ connection, schema, schemaOrigin }: { connection: RemoteConnection; schema: Schema; schemaOrigin: string }) {
  const versions = useProjectStore((s) => s.project.versions)
  const baseVersionId = useProjectStore((s) => s.baseVersionId)
  const latest = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const [versionId, setVersionId] = useState<string>(baseVersionId ?? latest?.id ?? '')
  const [rows, setRows] = useState<Row[]>([])
  const [runs, setRuns] = useState(5)
  const [explain, setExplain] = useState(false)
  const [busy, setBusy] = useState<'suggest' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BenchmarkResponse | null>(null)
  const [custom, setCustom] = useState({ label: '', query: '' })

  const suggest = async () => {
    setBusy('suggest')
    setError(null)
    try {
      const r = await dbApi.sampleQueries(schema, connection.dialect, 12)
      setRows(r.queries.map((q, i) => ({ key: key(), label: q.label, query: q.query, selected: i < 8 })))
      if (!r.queries.length) setError('El esquema no tiene tablas para generar consultas.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const addCustom = () => {
    if (!custom.query.trim()) return
    setRows((r) => [...r, { key: key(), label: custom.label.trim() || `Consulta ${r.length + 1}`, query: custom.query.trim(), selected: true }])
    setCustom({ label: '', query: '' })
  }

  // Progreso estimado (el servidor responde de una vez): curva asintótica hacia el 95 %
  // según el tiempo esperado y salto al 100 % al terminar.
  const [progress, setProgress] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), [])
  const startProgress = (queries: number) => {
    const expected = Math.max(1_500, queries * (runs + 1 + (explain ? 1 : 0)) * 60)
    const t0 = performance.now()
    setProgress(2)
    timer.current = setInterval(() => setProgress(95 * (1 - Math.exp(-(performance.now() - t0) / expected))), 200)
  }
  const stopProgress = (ok: boolean) => {
    if (timer.current) clearInterval(timer.current)
    setProgress(ok ? 100 : null)
    if (ok) setTimeout(() => setProgress(null), 700)
  }

  const run = async () => {
    const selected = rows.filter((r) => r.selected)
    if (!selected.length) return
    setBusy('run')
    setError(null)
    setResult(null)
    startProgress(selected.length)
    let ok = false
    try {
      const r = await runBenchmarkFlow(connection, {
        connection: toPayload(connection, getPassword(connection.id) ?? ''),
        queries: selected.map(({ label, query }) => ({ label, query })),
        runs,
        explain,
        versionId: versionId || 'borrador',
      })
      setResult(r)
      recordBenchmarks(r.results, r.details)
      ok = true
      toast.success(`${r.results.length} medición(es) registradas`, { description: 'Disponibles en Informes.' })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      stopProgress(ok)
    }
  }

  const selectedCount = rows.filter((r) => r.selected).length

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-medium">Medir rendimiento</h3>
        <p className="text-sm text-muted-foreground">
          Cada consulta se ejecuta en una transacción de solo lectura que termina en ROLLBACK. Consultas sugeridas a partir del {schemaOrigin}.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Button variant="outline" onClick={suggest} disabled={!!busy}>
          {busy === 'suggest' ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Sugerir consultas
        </Button>
        <div className="space-y-1.5">
          <Label htmlFor="bm-runs">Repeticiones</Label>
          <Input id="bm-runs" type="number" min={1} max={50} value={runs} onChange={(e) => setRuns(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} className="w-24" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox checked={explain} onCheckedChange={(v) => setExplain(v === true)} />
          EXPLAIN ANALYZE
        </label>
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="bm-version">Atribuir a la versión</Label>
          {versions.length ? (
            <SourceSelect id="bm-version" value={versionId} onChange={setVersionId} includeDraft={false} />
          ) : (
            <p className="text-xs text-muted-foreground">Sin versiones confirmadas: se registrará como «borrador».</p>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <ul className="divide-y border-y">
          {rows.map((r) => (
            <li key={r.key} className={cn('flex items-start gap-3 py-2', enterItem)} style={stagger(rows.indexOf(r))}>
              <Checkbox
                className="mt-0.5"
                checked={r.selected}
                onCheckedChange={(v) => setRows((all) => all.map((x) => (x.key === r.key ? { ...x, selected: v === true } : x)))}
                aria-label={`Incluir ${r.label}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{r.label}</p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={r.query}>
                  {r.query}
                </p>
              </div>
              <Button size="icon-xs" variant="ghost" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} aria-label="Quitar">
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Añadir una consulta propia</summary>
        <div className="mt-3 space-y-2">
          <Input placeholder="Etiqueta" value={custom.label} onChange={(e) => setCustom((c) => ({ ...c, label: e.target.value }))} />
          <CodeEditor
            value={custom.query}
            onChange={(v) => setCustom((c) => ({ ...c, query: v }))}
            language={sqlLanguageFor(connection.dialect)}
            filename="consulta.sql"
            schema={schema}
            height="auto"
            minHeight={110}
            maxHeight={260}
            ariaLabel="Consulta propia"
          />
          <Button size="sm" variant="outline" onClick={addCustom} disabled={!custom.query.trim()}>
            <Plus />
            Añadir
          </Button>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={!selectedCount || !!busy}>
          {busy === 'run' ? <Loader2 className="animate-spin" /> : <Gauge />}
          Medir {selectedCount ? `${selectedCount} consulta(s)` : ''}
        </Button>
        {busy === 'run' && <span className={cn('text-xs text-muted-foreground', fadeIn)}>Puede tardar hasta 90 s…</span>}
      </div>

      {progress !== null && (
        <div
          role="progressbar"
          aria-label="Progreso de la medición"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className={cn('h-1 overflow-hidden rounded-full bg-muted', fadeIn, progress >= 100 && 'opacity-0 transition-opacity delay-300 duration-300')}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className={cn('space-y-2', fadeIn)}>
          <p className="text-sm text-muted-foreground">
            {result.results.length} consulta(s) medidas en {(result.totalMs / 1000).toFixed(1)} s{result.truncated ? ' (cortado por tiempo)' : ''}. Registradas en{' '}
            <NavLink to="/informes" className="underline underline-offset-2">
              Informes
            </NavLink>
            .
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-normal">Consulta</th>
                  <th className="w-32 py-1.5 pr-3 font-normal" aria-label="Media relativa" />
                  <th className="py-1.5 pr-3 text-right font-normal">media</th>
                  <th className="py-1.5 pr-3 text-right font-normal">p95</th>
                  <th className="py-1.5 pr-3 text-right font-normal">mín</th>
                  <th className="py-1.5 pr-3 text-right font-normal">máx</th>
                  <th className="py-1.5 text-right font-normal">filas</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.details.map((d, i) => {
                  const r = result.results.find((x) => x.label === d.label && x.query === d.query)
                  const maxAvg = Math.max(...result.results.map((x) => x.avgMs), 0.001)
                  return (
                    <tr key={i} className={cn('align-top', enterItem)} style={stagger(i)}>
                      <td className="py-1.5 pr-3">
                        {d.label}
                        {d.error && <p className="text-xs text-destructive">{d.error}</p>}
                        {d.plan && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-muted-foreground">Plan</summary>
                            <pre className="mt-1 max-h-64 overflow-auto rounded border bg-muted/40 p-2 font-mono text-[11px] leading-snug">{d.plan}</pre>
                          </details>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">{r && <GrowBar value={(r.avgMs / maxAvg) * 100} />}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{r ? r.avgMs.toFixed(2) : '—'}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{r ? r.p95Ms.toFixed(2) : '—'}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-muted-foreground tabular-nums">{d.error ? '—' : d.minMs.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-muted-foreground tabular-nums">{d.error ? '—' : d.maxMs.toFixed(2)}</td>
                      <td className="py-1.5 text-right font-mono text-muted-foreground tabular-nums">{d.rows ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-muted-foreground">Tiempos en ms medidos desde el servidor de DB Tracker (incluyen la red hasta la BD).</p>
          </div>
        </div>
      )}
    </div>
  )
}
