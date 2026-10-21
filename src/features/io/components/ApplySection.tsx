// Aplicar SQL en la BD remota con confirmación explícita (escribir el nombre de la BD).
import { AlertTriangle, Loader2, Play, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { CodeEditor, sqlLanguageFor } from '@/components/code'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { splitStatements } from '@/lib/importers'
import { cn } from '@/lib/utils'
import type { RemoteConnection, Schema } from '@/types/schema'

import type { ApplyResponse } from '../api-types'
import { runApplyFlow } from '../lib/flows'
import { fadeIn } from '../lib/motion'

export function ApplySection({
  connection,
  sql,
  onSqlChange,
  onApplied,
  schema,
}: {
  connection: RemoteConnection
  /** Esquema para autocompletar (el remoto leído o el borrador). */
  schema?: Schema
  sql: string
  onSqlChange: (s: string) => void
  onApplied: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState<'dry' | 'apply' | null>(null)
  const [result, setResult] = useState<ApplyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const statements = useMemo(() => splitStatements(sql), [sql])
  const pg = connection.dialect === 'postgresql'
  const destructive = /\bDROP\s+(TABLE|COLUMN|TYPE|VIEW|MATERIALIZED)\b/i.test(sql)

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? 'dry' : 'apply')
    setError(null)
    setResult(null)
    try {
      setOpen(false)
      const r = await runApplyFlow(connection, sql, dryRun)
      setResult(r)
      if (r.ok && !dryRun) {
        toast.success(`Migración aplicada en ${connection.database}`, { description: `${r.executed.length} sentencias · ${Math.round(r.totalMs)} ms` })
        onApplied()
      } else if (r.ok) toast.success('Validación correcta: no se aplicó ningún cambio')
      else toast.error('La migración falló', { description: r.failed?.error })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setOpen(false)
      setConfirmText('')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-medium">Aplicar migración</h3>
        <p className="text-sm text-muted-foreground">
          {pg
            ? 'Se ejecuta en una única transacción: si una sentencia falla, se deshace todo.'
            : 'MySQL confirma cada sentencia DDL por separado: si una falla, las anteriores quedan aplicadas.'}
        </p>
      </div>
      <CodeEditor
        value={sql}
        onChange={onSqlChange}
        language={sqlLanguageFor(connection.dialect)}
        filename={`migracion-${connection.database}.sql`}
        schema={schema}
        height={320}
        ariaLabel="SQL a aplicar"
      />
      {!sql.trim() && <p className="text-xs text-muted-foreground">Genera el SQL en «Migración» → «Usar para aplicar» o escríbelo aquí.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">{statements.length} sentencia(s)</span>
        {pg && (
          <Button variant="outline" disabled={!statements.length || !!busy} onClick={() => run(true)}>
            {busy === 'dry' ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            Validar sin aplicar
          </Button>
        )}
        <Button variant="destructive" disabled={!statements.length || !!busy} onClick={() => setOpen(true)}>
          {busy === 'apply' ? <Loader2 className="animate-spin" /> : <Play />}
          Aplicar en {connection.database}…
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className={cn('space-y-2', fadeIn)}>
          <p className={cn('text-sm font-medium', result.ok ? 'text-emerald-700 dark:text-[#4fd1a5]' : 'text-destructive')}>
            {result.ok
              ? result.dryRun
                ? `Validación correcta (${result.executed.length} sentencias, ${Math.round(result.totalMs)} ms, ROLLBACK)`
                : `Aplicado: ${result.executed.length} sentencias en ${Math.round(result.totalMs)} ms`
              : `Falló la sentencia ${(result.failed?.index ?? 0) + 1}`}
          </p>
          {result.notes.map((n, i) => (
            <p key={i} className="text-xs text-muted-foreground">
              {n}
            </p>
          ))}
          {result.failed && (
            <div className="border-l-2 border-destructive pl-3">
              <p className="text-sm text-destructive">{result.failed.error}</p>
              <pre className="mt-1 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">{result.failed.statement}</pre>
            </div>
          )}
          {result.executed.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-normal">#</th>
                  <th className="py-1 pr-2 font-normal">Sentencia</th>
                  <th className="py-1 text-right font-normal">ms</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.executed.map((s) => (
                  <tr key={s.index}>
                    <td className="py-1 pr-2 align-top text-muted-foreground tabular-nums">{s.index + 1}</td>
                    <td className="max-w-0 truncate py-1 pr-2 font-mono">{s.statement.replace(/\s+/g, ' ')}</td>
                    <td className="py-1 text-right align-top tabular-nums">{s.ms.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setConfirmText('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar {statements.length} sentencia(s)</DialogTitle>
            <DialogDescription>
              Vas a modificar la base de datos <span className="font-mono">{connection.database}</span> en{' '}
              <span className="font-mono">
                {connection.host}:{connection.port}
              </span>
              . Esta acción no se puede deshacer desde DB Tracker.
            </DialogDescription>
          </DialogHeader>
          {destructive && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              El script contiene DROP: se eliminarán objetos y sus datos.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="apply-confirm">
              Escribe <span className="font-mono">{connection.database}</span> para confirmar
            </Label>
            <Input id="apply-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={confirmText !== connection.database || !!busy} onClick={() => run(false)}>
              {busy === 'apply' && <Loader2 className="animate-spin" />}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
