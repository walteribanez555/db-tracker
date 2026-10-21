// Pestaña Exportar: esquema en varios formatos, migración entre versiones y proyecto completo.
import { FileArchive, Files } from 'lucide-react'
import { useMemo, useState } from 'react'

import { CodeEditor, sqlLanguageFor, type CodeLanguage } from '@/components/code'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DIALECT_LABELS,
  EXPORT_FORMATS,
  computeMigration,
  exportMigration,
  exportSchema,
  type ExportFormat,
  type ExportResult,
} from '@/lib/exporters'
import { useProjectStore } from '@/store/project'
import type { Dialect } from '@/types/schema'

import { runAllFormatsFlow, runProjectBackupFlow } from '../lib/flows'
import { DRAFT_SOURCE, useSchemaFor, useSchemaSources, withDefaults } from '../lib/sources'
import { fadeIn } from '../lib/motion'
import { FileActions } from './FileActions'
import { RadioList } from './RadioList'
import { SourceSelect } from './SourceSelect'

const LANG: Record<Exclude<ExportFormat, 'sql'>, CodeLanguage> = {
  dbml: 'dbml',
  json: 'json',
  prisma: 'prisma',
  mermaid: 'mermaid',
  markdown: 'markdown',
}

const DIALECTS = Object.keys(DIALECT_LABELS) as Dialect[]

const sizeNote = (content: string) => `${content.split('\n').length} líneas · ${(new Blob([content]).size / 1024).toFixed(1)} KB`

function DialectSelect({ value, onChange, id }: { value: Dialect; onChange: (d: Dialect) => void; id?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Dialect)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DIALECTS.map((d) => (
          <SelectItem key={d} value={d}>
            {DIALECT_LABELS[d]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SchemaExport() {
  const project = useProjectStore((s) => s.project)
  const [format, setFormat] = useState<ExportFormat>('sql')
  const [source, setSource] = useState(DRAFT_SOURCE)
  const [dialect, setDialect] = useState<Dialect>(project.dialect)
  const [opts, setOpts] = useState({ includeDrop: false, includeComments: true, includeTriggers: true })
  const schema = useSchemaFor(source)
  const sources = useSchemaSources()
  const info = EXPORT_FORMATS.find((f) => f.id === format)!

  const src = sources.all.find((s) => s.id === source)
  const baseName = `${project.name}${src && src.id !== DRAFT_SOURCE ? `-${src.branchName.replace(/\//g, '-')}` : ''}`

  const result = useMemo(() => {
    try {
      return exportSchema(withDefaults(schema), format, { name: baseName, dialect, title: project.name, sql: opts })
    } catch (e) {
      return { filename: 'error.txt', mime: 'text/plain', content: `-- Error al exportar: ${e instanceof Error ? e.message : String(e)}` }
    }
  }, [schema, format, baseName, dialect, project.name, opts])

  const empty = !schema.tables.length && !(schema.views ?? []).length

  return (
    <section className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="exp-source">Origen</Label>
          <SourceSelect id="exp-source" value={source} onChange={setSource} />
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Formato</span>
          <RadioList
            name="exp-format"
            value={format}
            onChange={setFormat}
            className="-mx-2"
            options={EXPORT_FORMATS.map((f) => ({ value: f.id, label: f.label, description: f.description }))}
          />
        </div>

        {info.usesDialect && (
          <div className="space-y-1.5">
            <Label htmlFor="exp-dialect">Dialecto</Label>
            <DialectSelect id="exp-dialect" value={dialect} onChange={setDialect} />
          </div>
        )}

        {format === 'sql' && (
          <div className="space-y-2">
            <span className="text-sm font-medium">Opciones</span>
            {(
              [
                ['includeDrop', 'DROP … IF EXISTS antes de crear'],
                ['includeComments', 'Comentarios de tablas y columnas'],
                ['includeTriggers', 'Funciones y triggers'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={opts[k]} onCheckedChange={(v) => setOpts((o) => ({ ...o, [k]: v === true }))} />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0">
        {empty ? (
          <p className="rounded-md border bg-muted/40 p-6 text-sm text-muted-foreground">El esquema seleccionado está vacío.</p>
        ) : (
          <div key={`${format}:${dialect}:${source}`} className={fadeIn}>
            <CodeEditor
              value={result.content}
              readOnly
              filename={result.filename}
              language={format === 'sql' ? sqlLanguageFor(dialect) : LANG[format]}
              height="auto"
              minHeight={240}
              maxHeight={680}
              ariaLabel={`Vista previa de ${result.filename}`}
              actions={<FileActions content={result.content} filename={result.filename} mime={result.mime} note={sizeNote(result.content)} />}
            />
          </div>
        )}
      </div>
    </section>
  )
}

function MigrationExport() {
  const project = useProjectStore((s) => s.project)
  const baseVersionId = useProjectStore((s) => s.baseVersionId)
  const [from, setFrom] = useState<string>(baseVersionId ?? DRAFT_SOURCE)
  const [to, setTo] = useState<string>(DRAFT_SOURCE)
  const [dialect, setDialect] = useState<Dialect>(project.dialect)
  const fromSchema = useSchemaFor(from)
  const toSchema = useSchemaFor(to)
  const sources = useSchemaSources()

  const migration = useMemo(() => computeMigration(withDefaults(fromSchema), withDefaults(toSchema), dialect), [fromSchema, toSchema, dialect])
  const name = (id: string) => {
    const s = sources.all.find((x) => x.id === id)
    return s ? (s.id === DRAFT_SOURCE ? 'borrador' : s.branchName.replace(/\//g, '-')) : id
  }
  const result: ExportResult = { ...exportMigration(fromSchema, toSchema, dialect, `migracion-${name(from)}-a-${name(to)}`), content: migration.sql }
  const s = migration.summary

  return (
    <section className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-5">
        <div>
          <h3 className="text-base font-medium">Migración entre versiones</h3>
          <p className="text-sm text-muted-foreground">SQL (ALTER/CREATE/DROP) para pasar de una versión a otra, p. ej. de main a una rama.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mig-from">Desde</Label>
          <SourceSelect id="mig-from" value={from} onChange={setFrom} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mig-to">Hasta</Label>
          <SourceSelect id="mig-to" value={to} onChange={setTo} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mig-dialect">Dialecto</Label>
          <DialectSelect id="mig-dialect" value={dialect} onChange={setDialect} />
        </div>
        {!migration.empty && (
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {s.createdTables.length > 0 && <li>{s.createdTables.length} tabla(s) nueva(s)</li>}
            {s.droppedTables.length > 0 && <li>{s.droppedTables.length} tabla(s) eliminada(s)</li>}
            {s.renamedTables.length > 0 && <li>{s.renamedTables.length} tabla(s) renombrada(s)</li>}
            {s.alteredTables.length > 0 && <li>{s.alteredTables.length} tabla(s) modificada(s)</li>}
            {(s.addedRelations > 0 || s.droppedRelations > 0) && (
              <li>
                FKs: +{s.addedRelations} / −{s.droppedRelations}
              </li>
            )}
            {s.dataMigrations > 0 && <li>{s.dataMigrations} migración(es) de datos</li>}
            {(s.createdViews.length > 0 || s.droppedViews.length > 0) && (
              <li>
                Vistas: {s.createdViews.length} creadas/recreadas, {s.droppedViews.length} eliminadas
              </li>
            )}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        {migration.warnings.length > 0 && (
          <ul className="mb-3 space-y-0.5 border-l-2 border-amber-600 pl-3 text-xs text-muted-foreground dark:border-[#f5a35c]">
            {migration.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <div key={`${from}:${to}:${dialect}`} className={fadeIn}>
          <CodeEditor
            value={migration.sql}
            readOnly
            filename={result.filename}
            language={sqlLanguageFor(dialect)}
            height="auto"
            minHeight={200}
            maxHeight={560}
            actions={
              <FileActions
                content={migration.sql}
                filename={result.filename}
                mime="text/sql"
                note={migration.empty ? 'sin diferencias' : `${s.statements} sentencias`}
              />
            }
          />
        </div>
      </div>
    </section>
  )
}

function ProjectExport() {
  const project = useProjectStore((s) => s.project)
  const draft = useProjectStore((s) => s.draft)
  const backup = () => void runProjectBackupFlow(project, draft)
  const all = () => void runAllFormatsFlow(project, withDefaults(draft))
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-medium">Proyecto completo</h3>
        <p className="text-sm text-muted-foreground">
          {project.branches.length} rama(s) · {project.versions.length} versión(es). La copia JSON incluye ramas, versiones, borrador y conexiones (sin
          contraseñas) y se puede reimportar desde la pestaña Importar.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={backup}>
          <FileArchive />
          Copia de seguridad (.json)
        </Button>
        <Button variant="ghost" onClick={all}>
          <Files />
          Borrador en todos los formatos ({EXPORT_FORMATS.length} archivos)
        </Button>
      </div>
    </section>
  )
}

export function ExportTab() {
  return (
    <div className="space-y-10 divide-y [&>*]:pb-10 [&>*:last-child]:pb-0">
      <SchemaExport />
      <MigrationExport />
      <ProjectExport />
    </div>
  )
}
