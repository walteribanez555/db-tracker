// Operaciones de /datos mostradas como flujo de pasos en el dock "Flujo".
// Los pasos son los reales: lo que se ejecuta en el cliente usa runOperation; lo que hace el
// servidor de una vez (introspección, aplicar, medir) se refleja con start/setStep usando
// los tiempos que devuelve el servidor (sin inventar duraciones).
import { runOperation, useOperationStore, type Operation, type OperationStep, type StepKind } from '@/components/operation-flow'
import { DIALECT_LABELS, EXPORT_FORMATS, exportProject, exportSchema, type ExportResult } from '@/lib/exporters'
import { detectFormat, gridLayout, importSchema, reidSchema, splitStatements, type ImportFormat, type ImportResult } from '@/lib/importers'
import { useProjectStore } from '@/store/project'
import type { Dialect, Project, RemoteConnection, Schema } from '@/types/schema'

import type { ApplyResponse, BenchmarkRequest, BenchmarkResponse, IntrospectPhase, IntrospectResponse } from '../api-types'
import { dbApi, toPayload } from './api'
import { downloadMany, downloadResult } from './download'
import { uniqueBranchName, type ImportTargetState } from './importInto'
import { getPassword } from './passwords'

type Step = Omit<OperationStep, 'status'>

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
/** Pausa breve entre pasos ya resueltos para que el flujo se pueda seguir (0 con reduced-motion). */
const beat = () => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 140))

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------------------------------------------------------------------------
// SQL → pasos
// ---------------------------------------------------------------------------

/** Tipo de nodo según la sentencia (para el icono). */
export function statementKind(st: string): StepKind {
  const s = st.replace(/\s+/g, ' ').toUpperCase()
  if (/FOREIGN KEY|DROP FOREIGN KEY/.test(s)) return 'relation'
  if (/\b(CREATE|DROP)( UNIQUE)? INDEX\b|\bADD UNIQUE INDEX\b|\bDROP INDEX\b/.test(s)) return 'index'
  if (/\bTRIGGER\b/.test(s)) return 'trigger'
  if (/\bFUNCTION\b/.test(s)) return 'function'
  if (/\bVIEW\b/.test(s)) return 'view'
  if (/\b(ADD|DROP|ALTER|MODIFY|CHANGE|RENAME) COLUMN\b|\bALTER COLUMN\b/.test(s)) return 'column'
  if (/\bTABLE\b/.test(s)) return 'table'
  return 'sql'
}

/** Etiqueta corta: "ALTER TABLE pedidos", "CREATE INDEX ix_x"… */
export function statementLabel(st: string): string {
  const clean = st.replace(/\s+/g, ' ').trim()
  const m = /^((?:CREATE|ALTER|DROP|COMMENT ON|RENAME|EXEC|INSERT INTO|UPDATE|DELETE FROM)(?: OR REPLACE)?(?: UNIQUE)?(?: MATERIALIZED)?(?: (?:TABLE|INDEX|VIEW|TYPE|FUNCTION|TRIGGER|COLUMN|SEQUENCE|SCHEMA))?(?: IF (?:NOT )?EXISTS)?) ([`"[\]\w.$]+)/i.exec(clean)
  const label = m ? `${m[1].replace(/ IF (NOT )?EXISTS/i, '')} ${m[2].replace(/[`"[\]]/g, '')}` : clean
  return label.length > 42 ? `${label.slice(0, 41)}…` : label
}

const shortSql = (st: string) => {
  const s = st.replace(/\s+/g, ' ').trim()
  return s.length > 90 ? `${s.slice(0, 89)}…` : s
}

/** Pasos (pendientes) de un script SQL: uno por sentencia y, en Postgres, COMMIT/ROLLBACK final. */
export function sqlSteps(sql: string, dialect: Dialect, final: 'COMMIT' | 'ROLLBACK' | null = dialect === 'postgresql' ? 'COMMIT' : null): Step[] {
  const statements = splitStatements(sql).filter((s) => !/^(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i.test(s))
  const steps: Step[] = statements.map((st, i) => ({ id: `st-${i}`, label: statementLabel(st), detail: shortSql(st), kind: statementKind(st) }))
  if (final) steps.push({ id: 'final', label: final, detail: final === 'COMMIT' ? 'confirmar la transacción' : 'deshacer la transacción', kind: final === 'COMMIT' ? 'commit' : 'check' })
  return steps
}

/** Operación local (fuera del dock) con los pasos pendientes de una migración, para <FlowSteps>. */
export function migrationPreviewOperation(sql: string, dialect: Dialect, title: string): Operation {
  return {
    id: 'preview',
    title,
    status: 'running',
    startedAt: 0,
    steps: sqlSteps(sql, dialect).map((s) => ({ ...s, status: 'pending' as const })),
  }
}

// ---------------------------------------------------------------------------
// Importar archivo / texto
// ---------------------------------------------------------------------------

export interface ImportFlowInput {
  text: string
  fileName?: string
  format: ImportFormat | 'auto'
  dialect?: Dialect
  target: ImportTargetState
  description: string
}

const countObjects = (s: Schema) =>
  s.tables.length + s.tables.reduce((n, t) => n + t.columns.length + t.indexes.length, 0) + s.relations.length + (s.views ?? []).length + s.enums.length + s.functions.length + s.triggers.length

/** detectar formato → parsear → normalizar ids → posicionar → crear rama (si aplica) → confirmar. */
export async function runImportFlow(input: ImportFlowInput) {
  let format: ImportFormat = 'sql'
  // `as`: los valores se asignan dentro de los pasos (TS no ve esas asignaciones).
  let parsed = null as ImportResult | null
  let schema = null as Schema | null
  let branchName = ''
  let keepPositions = false
  const branchMode = input.target.mode === 'branch'
  const steps = [
    {
      id: 'detect',
      label: 'Detectar formato',
      kind: 'file' as const,
      run: () => {
        format = input.format === 'auto' ? detectFormat(input.text, input.fileName) : input.format
        return `${format.toUpperCase()}${input.fileName ? ` · ${input.fileName}` : ''}`
      },
    },
    {
      id: 'parse',
      label: 'Parsear',
      kind: 'file' as const,
      run: async () => {
        parsed = await importSchema(input.text, format, input.dialect, { layout: false, normalize: false })
        const s = parsed.schema
        return `${plural(s.tables.length, 'tabla', 'tablas')}, ${plural(s.relations.length, 'relación', 'relaciones')} · ${DIALECT_LABELS[s.dialect]}`
      },
    },
    {
      id: 'normalize',
      label: 'Normalizar ids',
      kind: 'check' as const,
      run: () => {
        const r = reidSchema(parsed!.schema, parsed!.schema.dialect)
        schema = r.schema
        // Las posiciones de un JSON se conservan; el resto se coloca en rejilla.
        keepPositions = format === 'json' && r.hadPositions && r.schema.tables.some((t) => t.position.x || t.position.y)
        return `${countObjects(schema)} ids nuevos`
      },
    },
    {
      id: 'layout',
      label: 'Posicionar',
      kind: 'table' as const,
      run: () => {
        if (keepPositions) return 'se conservan las posiciones del archivo'
        gridLayout(schema!)
        return `${plural(schema!.tables.length, 'tabla', 'tablas')} en rejilla`
      },
    },
    ...(branchMode
      ? [
          {
            id: 'branch',
            label: 'Crear rama',
            kind: 'branch' as const,
            run: () => {
              branchName = uniqueBranchName(input.target.name)
              useProjectStore.getState().createBranch(branchName, input.description)
              return branchName
            },
          },
        ]
      : []),
    {
      id: 'commit',
      label: branchMode ? 'Confirmar versión' : 'Reemplazar borrador',
      kind: 'commit' as const,
      run: () => {
        const store = useProjectStore.getState()
        store.replaceDraft(schema!)
        if (!branchMode) return `rama ${store.project.branches.find((b) => b.id === store.project.currentBranchId)?.name ?? ''}`
        const v = useProjectStore.getState().commit(input.target.message || `Importación en ${branchName}`, 'importación')
        return `${v.id.replace(/^ver_/, '').slice(0, 7)} · ${input.target.message}`
      },
    },
  ]
  const res = await runOperation(`Importar ${input.fileName ?? 'texto'}`, steps)
  return { ...res, schema, branchName }
}

/** Restaurar una copia de seguridad completa: detectar → parsear → cargar proyecto. */
export async function runRestoreFlow(text: string, fileName?: string) {
  let parsed = null as ImportResult | null
  return runOperation(`Restaurar ${fileName ?? 'proyecto'}`, [
    { id: 'detect', label: 'Detectar formato', kind: 'file', run: () => 'JSON · copia de proyecto' },
    {
      id: 'parse',
      label: 'Parsear',
      kind: 'file',
      run: async () => {
        parsed = await importSchema(text, 'json')
        if (!parsed.project) throw new Error('El JSON no es una copia de seguridad de proyecto.')
        return `${plural(parsed.project.branches.length, 'rama', 'ramas')}, ${plural(parsed.project.versions.length, 'versión', 'versiones')}`
      },
    },
    {
      id: 'load',
      label: 'Cargar proyecto',
      kind: 'branch',
      run: () => {
        const p = parsed!.project as Project
        useProjectStore.getState().loadProject(p)
        if (parsed!.projectDraft) useProjectStore.getState().replaceDraft(parsed!.projectDraft)
        return p.name
      },
    },
  ])
}

/** Esquema ya construido (p. ej. introspección) → rama nueva o borrador. */
export async function runSchemaToProjectFlow(schema: Schema, target: ImportTargetState, description: string, title: string) {
  let branchName = ''
  const branchMode = target.mode === 'branch'
  const res = await runOperation(title, [
    ...(branchMode
      ? [
          {
            id: 'branch',
            label: 'Crear rama',
            kind: 'branch' as const,
            run: () => {
              branchName = uniqueBranchName(target.name)
              useProjectStore.getState().createBranch(branchName, description)
              return branchName
            },
          },
        ]
      : []),
    {
      id: 'commit',
      label: branchMode ? 'Confirmar versión' : 'Reemplazar borrador',
      kind: 'commit' as const,
      run: () => {
        useProjectStore.getState().replaceDraft({ ...structuredClone(schema), views: schema.views ?? [] })
        if (!branchMode) return `${plural(schema.tables.length, 'tabla', 'tablas')}`
        const v = useProjectStore.getState().commit(target.message || `Importación en ${branchName}`, 'importación')
        return `${v.id.replace(/^ver_/, '').slice(0, 7)} · ${target.message}`
      },
    },
  ])
  return { ...res, branchName }
}

// ---------------------------------------------------------------------------
// Introspección remota
// ---------------------------------------------------------------------------

const INTROSPECT_STEPS: { id: string; label: string; kind: StepKind; phase?: IntrospectPhase['id'] }[] = [
  { id: 'connect', label: 'Conectar', kind: 'network', phase: 'connect' },
  { id: 'tables', label: 'Leer tablas', kind: 'table', phase: 'tables' },
  { id: 'columns', label: 'Columnas y claves', kind: 'column' },
  { id: 'relations', label: 'Relaciones', kind: 'relation', phase: 'relations' },
  { id: 'indexes', label: 'Índices', kind: 'index', phase: 'indexes' },
  { id: 'views', label: 'Vistas', kind: 'view', phase: 'views' },
  { id: 'routines', label: 'Funciones y triggers', kind: 'trigger', phase: 'routines' },
  { id: 'build', label: 'Construir esquema', kind: 'check', phase: 'build' },
]

function introspectDetails(r: IntrospectResponse): Record<string, string> {
  const s = r.schema
  const cols = s.tables.reduce((n, t) => n + t.columns.length, 0)
  const pks = s.tables.filter((t) => t.columns.some((c) => c.pk)).length
  const idx = s.tables.reduce((n, t) => n + t.indexes.length, 0)
  const ver = r.serverVersion.split(',')[0].split(' on ')[0]
  return {
    connect: ver,
    tables: `${plural(s.tables.length, 'tabla', 'tablas')}${s.views.length ? `, ${plural(s.views.length, 'vista', 'vistas')}` : ''}`,
    columns: `${plural(cols, 'columna', 'columnas')} · ${pks} PK · ${s.enums.length} enums`,
    relations: plural(s.relations.length, 'FK', 'FKs'),
    indexes: plural(idx, 'índice', 'índices'),
    views: plural(s.views.length, 'vista', 'vistas'),
    routines: `${plural(s.functions.length, 'función', 'funciones')}, ${plural(s.triggers.length, 'trigger', 'triggers')}`,
    build: `${r.durationMs} ms en total`,
  }
}

export async function runIntrospectFlow(connection: RemoteConnection, schemaName?: string): Promise<IntrospectResponse> {
  const ops = useOperationStore.getState()
  const opId = ops.start(
    `Leer esquema de ${connection.name}`,
    INTROSPECT_STEPS.map(({ id, label, kind }) => ({ id, label, kind, ...(id === 'connect' ? { detail: `${connection.host}:${connection.port}/${connection.database}` } : {}) })),
  )
  const set = useOperationStore.getState().setStep
  set(opId, 'connect', { status: 'running' })
  let r: IntrospectResponse
  try {
    r = await dbApi.introspect(toPayload(connection, getPassword(connection.id) ?? ''), schemaName)
  } catch (e) {
    set(opId, 'connect', { status: 'error', detail: errMsg(e) })
    useOperationStore.getState().finish(opId, 'error', errMsg(e))
    throw e
  }
  // El servidor responde de una vez: se marcan las fases en orden con sus tiempos reales.
  const ms = new Map((r.phases ?? []).map((p) => [p.id, p.ms]))
  // En Postgres las columnas y las claves son dos lecturas (columnas+enums y restricciones).
  const columnsMs = ms.has('columns') ? (ms.get('columns') ?? 0) + (ms.get('keys') ?? 0) : undefined
  const details = introspectDetails(r)
  for (const step of INTROSPECT_STEPS) {
    set(opId, step.id, { status: 'running' })
    await beat()
    const stepMs = step.id === 'columns' ? columnsMs : step.phase ? ms.get(step.phase) : undefined
    set(opId, step.id, {
      status: 'done',
      detail:
        details[step.id] +
        (step.id === 'relations' && !ms.has('relations') ? ' · leídas con las claves' : '') +
        (step.id === 'indexes' && !ms.has('indexes') ? ' · leídos con las claves' : ''),
      ...(stepMs !== undefined ? { ms: Math.round(stepMs) } : {}),
    })
  }
  useOperationStore.getState().finish(opId, 'done')
  return r
}

// ---------------------------------------------------------------------------
// Aplicar migración
// ---------------------------------------------------------------------------

export async function runApplyFlow(connection: RemoteConnection, sql: string, dryRun: boolean): Promise<ApplyResponse> {
  const pg = connection.dialect === 'postgresql'
  const steps = sqlSteps(sql, connection.dialect, pg ? (dryRun ? 'ROLLBACK' : 'COMMIT') : null)
  const opId = useOperationStore.getState().start(`${dryRun ? 'Validar' : 'Aplicar'} migración en ${connection.database}`, steps)
  const set = useOperationStore.getState().setStep
  const statementSteps = steps.filter((s) => s.id !== 'final')
  if (statementSteps[0]) set(opId, statementSteps[0].id, { status: 'running' })
  let r: ApplyResponse
  try {
    r = await dbApi.apply(toPayload(connection, getPassword(connection.id) ?? ''), sql, { dryRun })
  } catch (e) {
    if (statementSteps[0]) set(opId, statementSteps[0].id, { status: 'error', detail: errMsg(e) })
    useOperationStore.getState().finish(opId, 'error', errMsg(e))
    throw e
  }
  // Tiempos reales por sentencia devueltos por el servidor.
  for (const ex of r.executed) {
    set(opId, `st-${ex.index}`, { status: 'running' })
    await beat()
    set(opId, `st-${ex.index}`, { status: 'done', ms: Math.round(ex.ms * 10) / 10 })
  }
  if (r.failed) {
    set(opId, `st-${r.failed.index}`, { status: 'error', detail: r.failed.error })
    // Postgres deshizo todo: ROLLBACK como paso final.
    if (pg) {
      useOperationStore.getState().addStep(opId, { id: 'rollback', label: 'ROLLBACK', detail: 'la base de datos queda como estaba', kind: 'check' }, `st-${statementSteps.length - 1}`)
      set(opId, 'rollback', { status: 'done' })
      set(opId, 'final', { status: 'skipped' })
    }
    useOperationStore.getState().finish(opId, 'error', r.failed.error)
    return r
  }
  if (pg) set(opId, 'final', { status: 'done', detail: dryRun ? 'validación sin cambios' : `${Math.round(r.totalMs)} ms en total` })
  useOperationStore.getState().finish(opId, r.ok ? 'done' : 'error', r.ok ? undefined : r.notes[0])
  return r
}

// ---------------------------------------------------------------------------
// Medir rendimiento
// ---------------------------------------------------------------------------

export async function runBenchmarkFlow(connection: RemoteConnection, req: BenchmarkRequest): Promise<BenchmarkResponse> {
  const steps: Step[] = req.queries.map((q, i) => ({ id: `q-${i}`, label: q.label.length > 40 ? `${q.label.slice(0, 39)}…` : q.label, detail: shortSql(q.query), kind: 'sql' }))
  const opId = useOperationStore.getState().start(`Medir ${plural(req.queries.length, 'consulta', 'consultas')} en ${connection.name}`, steps)
  const set = useOperationStore.getState().setStep
  set(opId, 'q-0', { status: 'running', detail: `${req.runs ?? 5} repeticiones · solo lectura` })
  let r: BenchmarkResponse
  try {
    r = await dbApi.benchmark(req)
  } catch (e) {
    set(opId, 'q-0', { status: 'error', detail: errMsg(e) })
    useOperationStore.getState().finish(opId, 'error', errMsg(e))
    throw e
  }
  let anyError = false
  for (let i = 0; i < req.queries.length; i++) {
    const q = req.queries[i]
    const d = r.details.find((x) => x.label === q.label && x.query.trim() === q.query.trim().replace(/;+\s*$/, ''))
    const m = r.results.find((x) => x.label === q.label && x.query === d?.query)
    set(opId, `q-${i}`, { status: 'running' })
    await beat()
    if (!d) set(opId, `q-${i}`, { status: 'skipped', detail: 'sin medir (límite de tiempo)' })
    else if (d.error) {
      anyError = true
      set(opId, `q-${i}`, { status: 'error', detail: d.error })
    } else if (m) set(opId, `q-${i}`, { status: 'done', detail: `avg ${m.avgMs.toFixed(2)} ms · p95 ${m.p95Ms.toFixed(2)} ms · ${m.runs}×` })
  }
  useOperationStore.getState().finish(opId, anyError ? 'error' : 'done', anyError ? 'Alguna consulta falló' : undefined)
  return r
}

// ---------------------------------------------------------------------------
// Exportaciones compuestas
// ---------------------------------------------------------------------------

const kb = (s: string) => `${(new Blob([s]).size / 1024).toFixed(1)} KB`

/** Copia de seguridad: generar → descargar. */
export function runProjectBackupFlow(project: Project, draft: Schema) {
  let file: ExportResult
  return runOperation('Exportar proyecto completo', [
    {
      id: 'gen',
      label: 'Generar copia',
      kind: 'file',
      run: () => {
        file = exportProject(project, draft)
        return `${plural(project.branches.length, 'rama', 'ramas')}, ${plural(project.versions.length, 'versión', 'versiones')} · ${kb(file.content)}`
      },
    },
    { id: 'download', label: 'Descargar', kind: 'file', run: () => (downloadResult(file), file.filename) },
  ])
}

/** Borrador en todos los formatos: un paso de generación por formato → descargar. */
export function runAllFormatsFlow(project: Project, draft: Schema) {
  const files: ExportResult[] = []
  return runOperation(`Exportar borrador en ${EXPORT_FORMATS.length} formatos`, [
    ...EXPORT_FORMATS.map((f) => ({
      id: `gen-${f.id}`,
      label: `Generar ${f.label}`,
      kind: (f.id === 'sql' ? 'sql' : 'file') as StepKind,
      run: () => {
        const r = exportSchema(draft, f.id, { name: project.name, dialect: project.dialect, title: project.name })
        files.push(r)
        return `${r.filename} · ${kb(r.content)}`
      },
    })),
    {
      id: 'download',
      label: 'Descargar',
      kind: 'file' as const,
      run: async () => {
        await downloadMany(files)
        return plural(files.length, 'archivo', 'archivos')
      },
    },
  ])
}
