// Pestaña de bases de datos remotas: conexiones, introspección, comparación, aplicar migración y rendimiento.
import { Database, Loader2, Plus, ScanSearch } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { CodeDiff, CodeEditor, sqlLanguageFor } from '@/components/code'
import { CollapsiblePanel } from '@/components/layout/collapsible-panel'
import { FlowSteps } from '@/components/operation-flow'
import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { computeMigration, generateSQL } from '@/lib/exporters'
import { uid } from '@/lib/id'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { RemoteConnection } from '@/types/schema'

import type { IntrospectResponse } from '../api-types'
import { migrationPreviewOperation, runIntrospectFlow, runSchemaToProjectFlow } from '../lib/flows'
import { slugBranch, type ImportTargetState } from '../lib/importInto'
import { enterItem, fadeIn, stagger } from '../lib/motion'
import { getPassword, usePasswordVersion } from '../lib/passwords'
import { setConnectionStatus, useConnectionStatus } from '../lib/status'
import { DRAFT_SOURCE, useSchemaFor, useSchemaSources, withDefaults } from '../lib/sources'
import { ApplySection } from './ApplySection'
import { BenchmarkSection } from './BenchmarkSection'
import { FileActions } from './FileActions'
import { ConnectionForm } from './ConnectionForm'
import { ImportTargetForm } from './ImportTargetForm'
import { SchemaPreview, SchemaStats } from './SchemaPreview'
import { SourceSelect } from './SourceSelect'
import { StatusDot } from './StatusDot'

const newConnection = (): RemoteConnection => ({
  id: uid('conn_'),
  name: '',
  dialect: 'postgresql',
  host: 'localhost',
  port: 5432,
  database: '',
  user: '',
  ssl: false,
})

// Esquemas remotos leídos en esta sesión (por conexión), para no repetir la introspección al cambiar de pestaña.
const introspectCache = new Map<string, IntrospectResponse>()

function CompareSection({
  connection,
  remote,
  onUseForApply,
}: {
  connection: RemoteConnection
  remote: IntrospectResponse
  onUseForApply: (sql: string) => void
}) {
  const [target, setTarget] = useState(DRAFT_SOURCE)
  const targetSchema = useSchemaFor(target)
  const sources = useSchemaSources()
  const migration = useMemo(
    () => computeMigration(withDefaults(remote.schema), withDefaults(targetSchema), connection.dialect),
    [remote.schema, targetSchema, connection.dialect],
  )
  const label = sources.all.find((s) => s.id === target)?.label ?? ''
  const preview = useMemo(
    () => migrationPreviewOperation(migration.sql, connection.dialect, `Migración hacia «${label}»`),
    [migration.sql, connection.dialect, label],
  )
  const s = migration.summary
  // DDL completo de ambos lados (sin cabecera con fecha, para que el diff solo muestre el esquema).
  const ddl = useMemo(
    () => ({
      remote: generateSQL(withDefaults(remote.schema), connection.dialect, { header: false }),
      target: generateSQL(withDefaults(targetSchema), connection.dialect, { header: false }),
    }),
    [remote.schema, targetSchema, connection.dialect],
  )
  const migFile = `migracion-${slugBranch(connection.name) || 'remoto'}.sql`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="cmp-target">Comparar la BD remota con</Label>
          <SourceSelect id="cmp-target" value={target} onChange={setTarget} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {migration.empty
          ? `La BD remota ya coincide con «${label}».`
          : `SQL para que ${connection.database} quede como «${label}»: ${s.statements} sentencia(s) · ${s.createdTables.length} tablas nuevas, ${s.droppedTables.length} eliminadas, ${s.alteredTables.length} modificadas, FKs +${s.addedRelations}/−${s.droppedRelations}.`}
      </p>
      {migration.warnings.length > 0 && (
        <ul className="space-y-0.5 border-l-2 border-amber-600 pl-3 text-xs text-muted-foreground dark:border-[#f5a35c]">
          {migration.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {!migration.empty && (
        <div key={`flow:${target}:${remote.durationMs}`} className={cn('space-y-1', fadeIn)}>
          <p className="text-xs text-muted-foreground">
            Pasos que se ejecutarán al aplicar ({migration.statements.length} sentencias{connection.dialect === 'postgresql' ? ' + COMMIT' : ''}):
          </p>
          <div className="border-y">
            <FlowSteps operation={preview} />
          </div>
        </div>
      )}
      <div key={`diff:${target}:${remote.durationMs}`} className={cn('space-y-1', fadeIn)}>
        <p className="text-xs text-muted-foreground">DDL de la BD remota frente al DDL de «{label}»</p>
        <CodeDiff
          original={ddl.remote}
          modified={ddl.target}
          language={sqlLanguageFor(connection.dialect)}
          originalLabel={`${connection.database} (remoto)`}
          modifiedLabel={label}
          height={440}
        />
      </div>
      <div key={`${target}:${remote.durationMs}`} className={fadeIn}>
        <CodeEditor
          value={migration.sql}
          readOnly
          filename={migFile}
          language={sqlLanguageFor(connection.dialect)}
          height="auto"
          minHeight={160}
          maxHeight={520}
          actions={
            <FileActions content={migration.sql} filename={migFile} mime="text/sql" note={migration.empty ? 'sin diferencias' : `${s.statements} sentencias`}>
              <Button size="xs" disabled={migration.empty} onClick={() => onUseForApply(migration.sql)}>
                Usar para aplicar
              </Button>
            </FileActions>
          }
        />
      </div>
    </div>
  )
}

const blockTitle = (t: string) => <span className="text-sm font-medium text-foreground">{t}</span>

function RemoteActions({ connection }: { connection: RemoteConnection }) {
  usePasswordVersion()
  const [remote, setRemote] = useState<IntrospectResponse | null>(() => introspectCache.get(connection.id) ?? null)
  const [schemaName, setSchemaName] = useState('public')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applySql, setApplySql] = useState('')
  const applyRef = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<ImportTargetState>({
    mode: 'branch',
    name: `remoto/${slugBranch(connection.name) || 'bd'}`,
    message: `Esquema de ${connection.name} (${connection.database})`,
  })
  const draft = useProjectStore((s) => s.draft)
  const hasPassword = getPassword(connection.id) !== undefined

  const introspect = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await runIntrospectFlow(connection, connection.dialect === 'postgresql' ? schemaName.trim() || 'public' : undefined)
      introspectCache.set(connection.id, r)
      setRemote(r)
      setConnectionStatus(connection.id, { state: 'ok', detail: `${r.durationMs} ms · ${r.serverVersion.split(',')[0]}` })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setConnectionStatus(connection.id, { state: 'error', detail: msg })
    } finally {
      setLoading(false)
    }
  }

  const [importing, setImporting] = useState(false)
  const doImport = async () => {
    if (!remote || importing) return
    setImporting(true)
    const r = await runSchemaToProjectFlow(
      remote.schema,
      target,
      `Introspección de ${connection.name} · ${connection.host}/${connection.database}`,
      `Importar esquema de ${connection.name}`,
    )
    setImporting(false)
    if (r.ok) toast.success(target.mode === 'draft' ? 'Borrador reemplazado por el esquema remoto' : `Rama «${r.branchName}» creada`)
    else toast.error('No se pudo importar', { description: r.error instanceof Error ? r.error.message : String(r.error) })
  }

  const k = (s: string) => `io:remote:${s}`
  const stats = remote?.stats

  return (
    <div className="space-y-6">
      {/* Resumen: leer el esquema e importarlo */}
      <CollapsibleSection
        title={blockTitle('Resumen')}
        meta={stats ? `${stats.tables} tablas · ${stats.views} vistas · ${stats.triggers} triggers` : undefined}
        storageKey={k('summary')}
        contentClassName="pt-3"
      >
        <div className="space-y-5">
          {!hasPassword && (
            <p className="text-xs text-muted-foreground">No hay contraseña en esta sesión: escríbela en el formulario si la BD la requiere.</p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            {connection.dialect === 'postgresql' && (
              <div className="space-y-1.5">
                <Label htmlFor="rm-schema">Esquema</Label>
                <Input id="rm-schema" value={schemaName} onChange={(e) => setSchemaName(e.target.value)} className="w-40 font-mono" />
              </div>
            )}
            <Button onClick={introspect} disabled={loading} variant={remote ? 'outline' : 'default'}>
              {loading ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              {remote ? 'Volver a leer' : 'Importar esquema (introspección)'}
            </Button>
            {remote && (
              <span className="pb-2 text-xs text-muted-foreground">
                {remote.serverVersion.split(',')[0]} · {remote.durationMs} ms
              </span>
            )}
          </div>
          {error && <p className={cn('text-sm text-destructive', fadeIn)}>{error}</p>}
          {!remote && !loading && (
            <p className="text-sm text-muted-foreground">Lee tablas, columnas, claves, índices, enums, vistas, funciones y triggers.</p>
          )}
          {remote && (
            <div key={remote.durationMs} className={cn('space-y-5', fadeIn)}>
              <SchemaStats schema={remote.schema} />
              {remote.warnings.length > 0 && (
                <CollapsibleSection title="Avisos" meta={remote.warnings.length} storageKey={k('warnings')} defaultOpen={false}>
                  <ul className="mt-1 list-disc space-y-0.5 pl-6 text-xs text-muted-foreground">
                    {remote.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </CollapsibleSection>
              )}
              <div className="max-w-2xl space-y-4">
                <ImportTargetForm idPrefix="rm" value={target} onChange={setTarget} />
                <Button onClick={doImport} disabled={importing || (!remote.schema.tables.length && !remote.schema.views.length)}>
                  Importar al proyecto
                </Button>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Objetos: tablas, vistas, relaciones, triggers, enums */}
      <CollapsibleSection
        title={blockTitle('Objetos')}
        meta={remote ? remote.schema.tables.length + remote.schema.views.length + remote.schema.triggers.length : undefined}
        storageKey={k('objects')}
        contentClassName="pt-3"
      >
        {remote ? (
          <SchemaPreview schema={remote.schema} rowEstimates={remote.stats.rowEstimates} storagePrefix={k('objects')} showStats={false} />
        ) : (
          <p className="text-sm text-muted-foreground">Primero lee el esquema remoto.</p>
        )}
      </CollapsibleSection>

      {/* Migración: comparar con una versión y aplicar */}
      <CollapsibleSection title={blockTitle('Migración')} storageKey={k('migration')} contentClassName="pt-3">
        <div className="space-y-8">
          {remote ? (
            <CompareSection
              connection={connection}
              remote={remote}
              onUseForApply={(sql) => {
                setApplySql(sql)
                requestAnimationFrame(() => applyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Lee el esquema remoto para compararlo con el borrador o una versión.</p>
          )}
          <div ref={applyRef} className="scroll-mt-4 border-t pt-6">
            <ApplySection
              connection={connection}
              schema={remote?.schema ?? draft}
              sql={applySql}
              onSqlChange={setApplySql}
              onApplied={() => {
                introspectCache.delete(connection.id)
                setRemote(null)
              }}
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* Rendimiento */}
      <CollapsibleSection title={blockTitle('Rendimiento')} storageKey={k('bench')} contentClassName="pt-3">
        <BenchmarkSection
          connection={connection}
          schema={remote?.schema ?? draft}
          schemaOrigin={remote ? 'esquema remoto leído' : 'borrador (lee el esquema remoto para afinar)'}
        />
      </CollapsibleSection>
    </div>
  )
}

export function RemoteTab() {
  const connections = useProjectStore((s) => s.project.connections)
  const [selected, setSelected] = useState<string | null>(connections[0]?.id ?? null)
  const [creating, setCreating] = useState<RemoteConnection | null>(connections.length ? null : newConnection())

  const current = creating ?? connections.find((c) => c.id === selected) ?? null

  return (
    <div className="-ml-2 flex min-h-[32rem] items-stretch">
      <CollapsiblePanel side="left" width={248} title="Conexiones" storageKey="io-connections" shortcut="[" className="rounded-l-md">
        <div className="space-y-2 px-2 pb-4">
          <div className="flex items-center justify-between pl-1">
            <h3 className="text-sm font-medium">Conexiones</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreating(newConnection())
                setSelected(null)
              }}
            >
              <Plus />
              Nueva
            </Button>
          </div>
          {connections.length === 0 && !creating && <p className="px-1 text-sm text-muted-foreground">No hay conexiones.</p>}
          <ul className="space-y-0.5">
            {connections.map((c, i) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                index={i}
                active={!creating && selected === c.id}
                onSelect={() => {
                  setSelected(c.id)
                  setCreating(null)
                }}
              />
            ))}
            {creating && (
              <li className={cn('rounded-md bg-brand/10 px-2 py-1.5 text-sm text-brand', enterItem)}>Nueva conexión…</li>
            )}
          </ul>
          <p className="px-1 pt-2 text-xs text-muted-foreground">Pulsa [ para plegar este panel.</p>
        </div>
      </CollapsiblePanel>

      <div className="min-w-0 flex-1 space-y-10 pl-8 transition-[padding] duration-300">
        {current ? (
          <div key={current.id} className={cn('space-y-10', fadeIn)}>
            <section>
              <h2 className="mb-4 text-lg font-medium">{creating ? 'Nueva conexión' : current.name}</h2>
              <ConnectionForm
                key={current.id}
                initial={current}
                isNew={!!creating}
                onSaved={(c) => {
                  setCreating(null)
                  setSelected(c.id)
                }}
                onDeleted={() => {
                  setSelected(connections.find((c) => c.id !== current.id)?.id ?? null)
                  toast.success('Conexión eliminada')
                }}
              />
            </section>
            {!creating && (
              <section className="border-t pt-8">
                <RemoteActions key={current.id} connection={current} />
              </section>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Crea una conexión a PostgreSQL o MySQL para leer su esquema, compararlo y medir consultas.</p>
        )}
      </div>
    </div>
  )
}

function ConnectionItem({
  connection: c,
  index,
  active,
  onSelect,
}: {
  connection: RemoteConnection
  index: number
  active: boolean
  onSelect: () => void
}) {
  const status = useConnectionStatus(c.id)
  return (
    <li className={enterItem} style={stagger(index)}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150',
          active ? 'bg-brand/10' : 'hover:bg-muted/60',
        )}
      >
        <Database className={cn('mt-0.5 size-3.5 shrink-0 transition-colors', active ? 'text-brand' : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm transition-colors', active && 'font-medium text-brand')}>{c.name}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {c.dialect === 'postgresql' ? 'pg' : 'mysql'} · {c.host}/{c.database}
          </span>
        </span>
        <StatusDot status={status} className="mt-1.5" />
      </button>
    </li>
  )
}
