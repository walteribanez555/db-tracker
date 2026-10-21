// Acceso al proyecto compartido (Y.Doc de la sala) desde las herramientas MCP: resolución de ramas y
// versiones por id o nombre, lectura de borradores y escritura con el formato exacto de src/collab/doc.ts.
import * as Y from 'yjs'

import {
  createDraft,
  deepEqual,
  docToProject,
  headDraft,
  isDocEmpty,
  readBranches,
  readDraft,
  readMeta,
  readVersions,
  rootMaps,
  writeDraft,
  type DraftState,
} from '../../src/collab/doc.ts'
import { Y_KEYS } from '../../src/collab/protocol.ts'
import type { QueryBenchmark } from '../../src/types/report.ts'
import type { Branch, Dialect, Project, Schema, Version } from '../../src/types/schema.ts'

/** Error de herramienta: su mensaje (en español) llega tal cual al agente. */
export class ToolError extends Error {}

/** Copia de BRANCH_COLORS de src/store/project.ts (ese módulo crea el store de zustand: no se importa aquí). */
export const BRANCH_COLORS = ['#18181b', '#2563eb', '#ea580c', '#7c3aed', '#059669', '#db2777', '#0891b2']

export const emptySchema = (dialect: Dialect = 'postgresql'): Schema => ({
  dialect,
  tables: [],
  views: [],
  relations: [],
  enums: [],
  functions: [],
  triggers: [],
  notes: [],
})

/* ───────────────────────── Ramas y versiones ───────────────────────── */

const norm = (s: string) => s.trim().toLowerCase()

/** Rama por id o nombre (exacto, sin mayúsculas o con el prefijo «flujo/»). */
export function resolveBranch(doc: Y.Doc, ref: string): Branch {
  const branches = readBranches(doc)
  const r = ref.trim()
  const found =
    branches.find((b) => b.id === r) ??
    branches.find((b) => b.name === r) ??
    branches.find((b) => norm(b.name) === norm(r)) ??
    branches.find((b) => norm(b.name) === norm(`flujo/${r}`))
  if (!found) {
    const list = branches.map((b) => b.name).join(', ') || '(ninguna)'
    throw new ToolError(`No existe la rama «${ref}». Ramas disponibles: ${list}.`)
  }
  return found
}

/** Versión por id exacto o por prefijo único (mín. 6 caracteres, con o sin «ver_»). */
export function resolveVersion(doc: Y.Doc, ref: string): Version {
  const versions = readVersions(doc)
  const r = ref.trim()
  const exact = versions.find((v) => v.id === r)
  if (exact) return exact
  if (r.length >= 6) {
    const matches = versions.filter((v) => v.id.startsWith(r) || v.id.startsWith(`ver_${r}`))
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) throw new ToolError(`El prefijo «${ref}» coincide con varias versiones; usa el id completo.`)
  }
  throw new ToolError(`No existe la versión «${ref}».`)
}

export function versionById(doc: Y.Doc, id: string | null | undefined): Version | null {
  if (!id) return null
  const json = rootMaps(doc).versions.get(id)
  return json ? (JSON.parse(json) as Version) : null
}

/** Versión de la cabeza de la rama (o de la que nació), null si no tiene. */
export function branchHeadId(branch: Branch): string | null {
  return branch.headVersionId ?? branch.forkedFromVersionId ?? null
}

/** Borrador compartido de la rama; si aún no existe, la cabeza (como hace el binding de la app). */
export function branchDraft(doc: Y.Doc, branchId: string): DraftState {
  const ydraft = rootMaps(doc).drafts.get(branchId)
  return ydraft ? readDraft(ydraft) : headDraft(doc, branchId)
}

/** Esquema base del borrador (versión baseVersionId o vacío). */
export function baseSchema(doc: Y.Doc, draft: DraftState): Schema {
  return versionById(doc, draft.baseVersionId)?.schema ?? emptySchema(readMeta(doc).dialect)
}

/** true si el borrador tiene cambios sin confirmar respecto a su versión base. */
export function draftIsDirty(doc: Y.Doc, draft: DraftState): boolean {
  return !deepEqual(normalizeSchema(baseSchema(doc, draft)), normalizeSchema(draft.schema))
}

/** Rellena colecciones ausentes (las versiones antiguas pueden no tener `views`). */
export function normalizeSchema(schema: Schema): Schema {
  const out: Schema = {
    ...schema,
    tables: schema.tables ?? [],
    views: schema.views ?? [],
    relations: schema.relations ?? [],
    enums: schema.enums ?? [],
    functions: schema.functions ?? [],
    triggers: schema.triggers ?? [],
    notes: schema.notes ?? [],
  }
  if (!out.dataMigrations?.length) delete out.dataMigrations
  return out
}

export interface ResolvedRef {
  schema: Schema
  label: string
  branch?: Branch
  version?: Version
}

/**
 * Referencia de diff/migración: «rama» (cabeza), «rama@draft» (borrador compartido), «rama@head» o un id de
 * versión. Una rama sin versiones usa la versión de la que nació (o un esquema vacío).
 */
export function resolveRef(doc: Y.Doc, ref: string): ResolvedRef {
  const r = ref.trim()
  const at = r.lastIndexOf('@')
  if (at > 0) {
    const suffix = r.slice(at + 1).toLowerCase()
    const branch = resolveBranch(doc, r.slice(0, at))
    if (suffix === 'draft' || suffix === 'borrador') {
      return { schema: normalizeSchema(branchDraft(doc, branch.id).schema), label: `${branch.name}@draft`, branch }
    }
    if (suffix === 'head' || suffix === 'cabeza') return headRef(doc, branch)
    throw new ToolError(`Sufijo «@${suffix}» no válido: usa «${branch.name}@draft» o «${branch.name}@head».`)
  }
  const branches = readBranches(doc)
  const isBranch = branches.some((b) => b.id === r || norm(b.name) === norm(r) || norm(b.name) === norm(`flujo/${r}`))
  if (isBranch) return headRef(doc, resolveBranch(doc, r))
  try {
    const version = resolveVersion(doc, r)
    return { schema: normalizeSchema(version.schema), label: `versión ${version.id} («${version.message}»)`, version }
  } catch {
    throw new ToolError(`«${ref}» no es una rama ni una versión. Usa un nombre de rama, «rama@draft» o un id de versión.`)
  }
}

function headRef(doc: Y.Doc, branch: Branch): ResolvedRef {
  const version = versionById(doc, branchHeadId(branch))
  return {
    schema: normalizeSchema(version?.schema ?? emptySchema(readMeta(doc).dialect)),
    label: `${branch.name} (cabeza${version ? ` ${version.id}` : ', sin versiones'})`,
    branch,
    version: version ?? undefined,
  }
}

/* ───────────────────────── Escritura ───────────────────────── */

export const agentOrigin = (name: string) => `agent:${name}`

/** Escribe el borrador de una rama (lo crea si no existe) con diff mínimo, dentro de la transacción en curso. */
export function writeBranchDraft(doc: Y.Doc, branchId: string, next: DraftState, prev: DraftState | null) {
  const ydraft = rootMaps(doc).drafts.get(branchId)
  if (ydraft) writeDraft(ydraft, next, prev)
  else createDraft(doc, branchId, next)
}

/* ───────────────────────── Benchmarks (Y 'benchmarks') ───────────────────────── */

export interface StoredBenchmark extends QueryBenchmark {
  id: string
  branchId?: string
  agent?: string
  detail?: { minMs: number; maxMs: number; medianMs: number; rows: number | null; plan?: string }
}

export const benchmarksMap = (doc: Y.Doc) => doc.getMap<string>(Y_KEYS.benchmarks)

export function readBenchmarks(doc: Y.Doc): StoredBenchmark[] {
  const out: StoredBenchmark[] = []
  benchmarksMap(doc).forEach((json, id) => {
    try {
      out.push({ ...(JSON.parse(json) as StoredBenchmark), id })
    } catch {
      /* entrada corrupta: se ignora */
    }
  })
  return out.sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1))
}

/* ───────────────────────── Resúmenes ───────────────────────── */

export function projectOf(doc: Y.Doc): Project {
  return docToProject(doc).project
}

export function requireContent(doc: Y.Doc) {
  if (isDocEmpty(doc)) {
    throw new ToolError(
      'La sesión existe pero la app todavía no ha compartido el proyecto. Abre DB Tracker en este equipo (se une sola) y vuelve a intentarlo, o llama a session_open para esperar.',
    )
  }
}

export function schemaStats(schema: Schema) {
  return {
    tables: schema.tables.length,
    columns: schema.tables.reduce((n, t) => n + t.columns.length, 0),
    relations: schema.relations.length,
    views: schema.views.length,
    enums: schema.enums.length,
    functions: schema.functions.length,
    triggers: schema.triggers.length,
  }
}

/** Vista compacta del esquema por nombres (lo que un agente necesita para razonar y editar). */
export function compactSchema(schema: Schema) {
  const tableName = new Map(schema.tables.map((t) => [t.id, t.name]))
  const viewName = new Map(schema.views.map((v) => [v.id, v.name]))
  const colName = new Map(schema.tables.flatMap((t) => t.columns.map((c) => [c.id, c.name] as const)))
  const fnName = new Map(schema.functions.map((f) => [f.id, f.name]))
  return {
    dialect: schema.dialect,
    tables: schema.tables.map((t) => ({
      name: t.name,
      ...(t.comment ? { comment: t.comment } : {}),
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        ...(c.pk ? { pk: true } : {}),
        nullable: c.nullable,
        ...(c.unique ? { unique: true } : {}),
        ...(c.autoIncrement ? { autoIncrement: true } : {}),
        ...(c.default !== undefined ? { default: c.default } : {}),
        ...(c.comment ? { comment: c.comment } : {}),
      })),
      ...(t.indexes.length
        ? { indexes: t.indexes.map((i) => ({ name: i.name, columns: i.columnIds.map((id) => colName.get(id) ?? id), unique: i.unique })) }
        : {}),
    })),
    relations: schema.relations.map((r) => ({
      ...(r.name ? { name: r.name } : {}),
      source: `${tableName.get(r.sourceTableId) ?? '?'}.${colName.get(r.sourceColumnId) ?? '?'}`,
      target: `${tableName.get(r.targetTableId) ?? '?'}.${colName.get(r.targetColumnId) ?? '?'}`,
      cardinality: r.cardinality,
      onDelete: r.onDelete,
      onUpdate: r.onUpdate,
    })),
    views: schema.views.map((v) => ({
      name: v.name,
      materialized: v.materialized,
      sources: v.sourceIds.map((id) => tableName.get(id) ?? viewName.get(id) ?? id),
      definition: v.definition,
      ...(v.comment ? { comment: v.comment } : {}),
    })),
    enums: schema.enums.map((e) => ({ name: e.name, values: e.values })),
    functions: schema.functions.map((f) => ({ name: f.name, language: f.language, args: f.args, returns: f.returns, body: f.body })),
    triggers: schema.triggers.map((t) => ({
      name: t.name,
      table: tableName.get(t.tableId) ?? viewName.get(t.tableId) ?? t.tableId,
      function: fnName.get(t.functionId) ?? t.functionId,
      timing: t.timing,
      events: t.events,
      level: t.level,
      ...(t.condition ? { condition: t.condition } : {}),
      ...(t.enabled === false ? { enabled: false } : {}),
    })),
    ...(schema.notes.length ? { notes: schema.notes.map((n) => n.text) } : {}),
    ...(schema.dataMigrations?.length
      ? { dataMigrations: schema.dataMigrations.map((d) => ({ description: d.description, sql: d.sql })) }
      : {}),
  }
}

export { readBranches, readMeta, readVersions, rootMaps, type DraftState }
