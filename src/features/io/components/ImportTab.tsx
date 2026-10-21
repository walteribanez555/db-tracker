// Pestaña Importar: archivo o texto (DBML / SQL / JSON) → vista previa → borrador o rama nueva.
// Una copia de seguridad del proyecto (JSON) puede además restaurarse completa.
import { FileUp, Loader2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { CodeEditor, sqlLanguageFor, type CodeLanguage } from '@/components/code'
import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DIALECT_LABELS } from '@/lib/exporters'
import { IMPORT_FORMATS, detectFormat, detectSQLDialect, importSchema, type ImportFormat, type ImportResult } from '@/lib/importers'
import { cn } from '@/lib/utils'
import type { Dialect } from '@/types/schema'

import { runImportFlow, runRestoreFlow } from '../lib/flows'
import { slugBranch, type ImportTargetState } from '../lib/importInto'
import { ImportTargetForm } from './ImportTargetForm'
import { fadeIn } from '../lib/motion'
import { RadioList } from './RadioList'
import { SchemaPreview } from './SchemaPreview'

const MAX_FILE = 5 * 1024 * 1024

type FormatChoice = 'auto' | ImportFormat
type DialectChoice = 'auto' | Dialect

export function ImportTab() {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | undefined>()
  const [format, setFormat] = useState<FormatChoice>('auto')
  const [dialect, setDialect] = useState<DialectChoice>('auto')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [projectMode, setProjectMode] = useState<'schema' | 'project'>('project')
  const [target, setTarget] = useState<ImportTargetState>({ mode: 'branch', name: 'importado', message: 'Importación' })
  const fileInput = useRef<HTMLInputElement>(null)

  const effectiveFormat: ImportFormat = format === 'auto' ? detectFormat(text, fileName) : format
  const hasText = !!text.trim()
  const editorLanguage: CodeLanguage =
    effectiveFormat === 'json'
      ? 'json'
      : effectiveFormat === 'dbml'
        ? 'dbml'
        : sqlLanguageFor(dialect === 'auto' ? (hasText ? detectSQLDialect(text) : 'postgresql') : dialect)

  // Análisis con antirrebote al cambiar el texto o las opciones.
  useEffect(() => {
    if (!text.trim()) return
    let cancelled = false
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await importSchema(text, effectiveFormat, dialect === 'auto' ? undefined : dialect)
        if (cancelled) return
        setResult(r)
        setError(null)
        setProjectMode(r.project ? 'project' : 'schema')
        const stamp = new Date().toISOString().slice(0, 10)
        const base = slugBranch(r.name ?? fileName?.replace(/\.[^.]+$/, '') ?? `${effectiveFormat}-${stamp}`) || stamp
        setTarget((tg) => ({ ...tg, name: `importado/${base}`, message: `Importación ${effectiveFormat.toUpperCase()}${fileName ? ` de ${fileName}` : ''}` }))
      } catch (e) {
        if (cancelled) return
        setResult(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setBusy(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [text, effectiveFormat, dialect, fileName])

  const readFile = async (file: File) => {
    if (file.size > MAX_FILE) {
      toast.error('El archivo supera 5 MB')
      return
    }
    setFileName(file.name)
    setText(await file.text())
  }

  const [running, setRunning] = useState(false)

  const doImport = async () => {
    if (!result || running) return
    setRunning(true)
    const r = await runImportFlow({
      text,
      fileName,
      format,
      dialect: dialect === 'auto' ? undefined : dialect,
      target,
      description: `Importado desde ${fileName ?? 'texto pegado'} (${effectiveFormat.toUpperCase()})`,
    })
    setRunning(false)
    if (!r.ok) {
      toast.error('La importación falló', { description: r.error instanceof Error ? r.error.message : String(r.error) })
      return
    }
    toast.success(target.mode === 'draft' ? 'Borrador reemplazado' : `Rama «${r.branchName}» creada`, {
      description: `${r.schema?.tables.length ?? 0} tablas · ${r.schema?.relations.length ?? 0} relaciones`,
    })
  }

  const doRestore = async () => {
    if (!result?.project || running) return
    setRestoreOpen(false)
    setRunning(true)
    const r = await runRestoreFlow(text, fileName)
    setRunning(false)
    if (r.ok) toast.success(`Proyecto «${result.project.name}» restaurado`, {
      description: `${result.project.branches.length} ramas · ${result.project.versions.length} versiones`,
    })
    else toast.error('No se pudo restaurar el proyecto', { description: r.error instanceof Error ? r.error.message : String(r.error) })
  }

  return (
    <div className="grid gap-10 max-lg:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Entrada */}
      <section className="min-w-0 space-y-5">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void readFile(f)
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors duration-200',
            dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-muted-foreground/40',
          )}
        >
          <Upload className="size-5 text-muted-foreground" />
          <p className="text-sm">
            Arrastra un archivo <span className="text-muted-foreground">.sql, .dbml o .json</span>
          </p>
          <Button className="max-md:h-11" size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
            <FileUp />
            Elegir archivo
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".sql,.ddl,.dbml,.json,text/plain,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void readFile(f)
              e.target.value = ''
            }}
          />
          {fileName && <p className="font-mono text-xs text-muted-foreground">{fileName}</p>}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">O pega el contenido</span>
          <CodeEditor
            value={text}
            onChange={(v) => {
              setText(v)
              if (fileName) setFileName(undefined)
            }}
            language={editorLanguage}
            filename={fileName ?? `pegado.${effectiveFormat}`}
            height={300}
            ariaLabel="Contenido a importar"
          />
          {!text && <p className="text-xs text-muted-foreground">Ejemplo: CREATE TABLE clientes (id serial PRIMARY KEY, email varchar(255) UNIQUE);</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="imp-format">Formato</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as FormatChoice)}>
              <SelectTrigger id="imp-format" className="max-md:data-[size=default]:h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Detectar ({text.trim() ? effectiveFormat.toUpperCase() : '—'})</SelectItem>
                {IMPORT_FORMATS.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {effectiveFormat !== 'json' && (
            <div className="space-y-1.5">
              <Label htmlFor="imp-dialect">Dialecto</Label>
              <Select value={dialect} onValueChange={(v) => setDialect(v as DialectChoice)}>
                <SelectTrigger id="imp-dialect" className="max-md:data-[size=default]:h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Detectar{result ? ` (${DIALECT_LABELS[result.schema.dialect]})` : ''}</SelectItem>
                  {(Object.keys(DIALECT_LABELS) as Dialect[]).map((d) => (
                    <SelectItem key={d} value={d}>
                      {DIALECT_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          SQL: CREATE TABLE, ALTER TABLE … ADD FOREIGN KEY, CREATE TYPE … AS ENUM, CREATE INDEX, CREATE VIEW, funciones y triggers de
          PostgreSQL y MySQL. Los ids se regeneran y las tablas se colocan en rejilla.
        </p>
      </section>

      {/* Vista previa */}
      <section className="min-w-0 space-y-6">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-medium">Vista previa</h3>
          {hasText && busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {!text.trim() && <p className="text-sm text-muted-foreground">Añade un archivo o pega texto para ver qué se importará.</p>}

        {hasText && error && (
          <div className="border-l-2 border-destructive pl-3">
            <p className="text-sm font-medium text-destructive">No se pudo interpretar el contenido</p>
            <pre className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{error}</pre>
          </div>
        )}

        {hasText && result && (
          <div key={`${result.format}:${result.schema.tables.length}:${result.schema.relations.length}`} className={cn('space-y-6', fadeIn)}>
            {result.project && (
              <div className="space-y-2 border-b pb-5">
                <p className="text-sm">
                  Copia de seguridad del proyecto <span className="font-medium">«{result.project.name}»</span>:{' '}
                  {result.project.branches.length} ramas, {result.project.versions.length} versiones.
                </p>
                <RadioList
                  name="imp-project-mode"
                  value={projectMode}
                  onChange={setProjectMode}
                  className="-mx-2"
                  options={[
                    { value: 'project', label: 'Restaurar el proyecto completo', description: 'Reemplaza el proyecto actual (ramas, versiones y borrador).' },
                    { value: 'schema', label: 'Importar solo el esquema actual', description: 'Toma el borrador o la última versión de la rama activa.' },
                  ]}
                />
              </div>
            )}

            <SchemaPreview schema={result.schema} storagePrefix="io:import" />

            {result.warnings.length > 0 && (
              <CollapsibleSection title="Avisos" meta={result.warnings.length} storageKey="io:import:warnings" defaultOpen={false}>
                <ul className="mt-1 list-disc space-y-0.5 pl-6 text-xs text-muted-foreground">
                  {result.warnings.slice(0, 50).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </CollapsibleSection>
            )}

            <div className="space-y-4 border-t pt-5">
              {result.project && projectMode === 'project' ? (
                <Button className="max-md:h-11" onClick={() => setRestoreOpen(true)} disabled={running}>
                  Restaurar proyecto…
                </Button>
              ) : (
                <>
                  <ImportTargetForm idPrefix="imp" value={target} onChange={setTarget} />
                  <Button className="max-md:h-11" onClick={doImport} disabled={running || (!result.schema.tables.length && !result.schema.views.length)}>
                    Importar
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restaurar proyecto</DialogTitle>
            <DialogDescription>
              Se reemplazará el proyecto actual por «{result?.project?.name}». Las ramas, versiones y el borrador actuales se perderán si no los has
              exportado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="max-md:h-11" variant="ghost" onClick={() => setRestoreOpen(false)}>
              Cancelar
            </Button>
            <Button className="max-md:h-11" variant="destructive" onClick={doRestore}>
              Reemplazar proyecto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
