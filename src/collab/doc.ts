// Mapeo del proyecto a un documento Yjs (estructura en protocol.ts → Y_KEYS) y escritura con diff mínimo.
// - Versiones: JSON inmutable (string) por id.
// - Ramas: Y.Map por rama, un campo por clave.
// - Borradores: Y.Map por rama; tablas con columnas en Y.Array<Y.Map>; SQL de vistas y cuerpo de funciones en Y.Text.
// El orden de tablas, vistas, relaciones… se guarda en la clave reservada ORDER_KEY de cada entidad.
import * as Y from 'yjs'

import type { Branch, Column, Project, Schema, Version } from '@/types/schema'

import { Y_KEYS } from './protocol'

export interface DraftState {
  schema: Schema
  baseVersionId: string | null
}

/** Clave reservada con el orden relativo de cada entidad dentro de su colección. */
export const ORDER_KEY = '$o'

/** Colecciones de entidades de un borrador. */
export const MAP_COLLECTIONS = ['tables', 'views', 'functions'] as const
export const JSON_COLLECTIONS = ['relations', 'triggers', 'notes', 'enums', 'dataMigrations'] as const
export const COLLECTIONS = [...MAP_COLLECTIONS, ...JSON_COLLECTIONS] as const
export type CollectionKey = (typeof COLLECTIONS)[number]

/** Campos Y.Text por colección. */
const TEXT_FIELD: Partial<Record<CollectionKey, string>> = { views: 'definition', functions: 'body' }

type Entity = { id: string } & Record<string, unknown>
type YDraft = Y.Map<unknown>

/* ───────────────────────── Utilidades ───────────────────────── */

/** Igualdad estructural de valores JSON (ignora claves con undefined). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined)
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!deepEqual(ra[k], rb[k])) return false
  return true
}

const clean = <T extends object>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T

/** Aplica a un Y.Text el cambio mínimo (prefijo y sufijo comunes) para que valga `next`. */
export function applyTextDiff(ytext: Y.Text, next: string): void {
  const prev = ytext.toString()
  if (prev === next) return
  let start = 0
  const minLen = Math.min(prev.length, next.length)
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--
    endNext--
  }
  if (endPrev > start) ytext.delete(start, endPrev - start)
  if (endNext > start) ytext.insert(start, next.slice(start, endNext))
}

/** Pone `value` en la clave solo si cambia (undefined borra la clave). */
function setField(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    if (map.has(key)) map.delete(key)
    return
  }
  const current = map.get(key)
  if (current instanceof Y.AbstractType) {
    map.set(key, value)
    return
  }
  if (!deepEqual(current, value)) map.set(key, structuredCloneSafe(value))
}

const structuredCloneSafe = <T,>(v: T): T => (v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v)

/* ───────────────────────── Raíces del documento ───────────────────────── */

export const rootMaps = (doc: Y.Doc) => ({
  meta: doc.getMap<unknown>(Y_KEYS.meta),
  branches: doc.getMap<Y.Map<unknown>>(Y_KEYS.branches),
  versions: doc.getMap<string>(Y_KEYS.versions),
  drafts: doc.getMap<YDraft>(Y_KEYS.drafts),
})

/** true si el documento aún no tiene proyecto (ni meta ni ramas). */
export const isDocEmpty = (doc: Y.Doc): boolean => {
  const { meta, branches } = rootMaps(doc)
  return !meta.get('projectId') && branches.size === 0
}

/* ───────────────────────── Entidades del borrador ───────────────────────── */

function columnToY(column: Column): Y.Map<unknown> {
  const m = new Y.Map<unknown>()
  for (const [k, v] of Object.entries(column)) if (v !== undefined) m.set(k, structuredCloneSafe(v))
  return m
}

function entityToY(collection: CollectionKey, entity: Entity, order: number): Y.Map<unknown> | Record<string, unknown> {
  if (!(MAP_COLLECTIONS as readonly string[]).includes(collection)) return { ...clean(structuredCloneSafe(entity)), [ORDER_KEY]: order }
  const m = new Y.Map<unknown>()
  const textField = TEXT_FIELD[collection]
  for (const [k, v] of Object.entries(entity)) {
    if (v === undefined) continue
    if (collection === 'tables' && k === 'columns') {
      const arr = new Y.Array<Y.Map<unknown>>()
      arr.push((v as Column[]).map(columnToY))
      m.set(k, arr)
    } else if (k === textField) {
      m.set(k, new Y.Text(String(v)))
    } else m.set(k, structuredCloneSafe(v))
  }
  m.set(ORDER_KEY, order)
  return m
}

function readColumn(m: Y.Map<unknown>): Column {
  return m.toJSON() as Column
}

function readEntity(collection: CollectionKey, value: unknown): Entity {
  if (!(value instanceof Y.Map)) {
    const { [ORDER_KEY]: _o, ...rest } = value as Record<string, unknown>
    void _o
    return rest as Entity
  }
  const out: Record<string, unknown> = {}
  value.forEach((v, k) => {
    if (k === ORDER_KEY) return
    if (v instanceof Y.Array) out[k] = (v.toArray() as Y.Map<unknown>[]).map(readColumn)
    else if (v instanceof Y.Text) out[k] = v.toString()
    else if (v instanceof Y.AbstractType) out[k] = v.toJSON()
    else out[k] = v
  })
  if (collection === 'tables') {
    out.columns ??= []
    out.indexes ??= []
  }
  return out as Entity
}

const orderOf = (value: unknown): number => {
  const o = value instanceof Y.Map ? value.get(ORDER_KEY) : (value as Record<string, unknown> | undefined)?.[ORDER_KEY]
  return typeof o === 'number' ? o : Number.MAX_SAFE_INTEGER
}

/** Ids de la colección en su orden (por ORDER_KEY y, a igualdad, por id). */
function orderedIds(map: Y.Map<unknown>): string[] {
  const entries: [string, number][] = []
  map.forEach((v, k) => entries.push([k, orderOf(v)]))
  entries.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return entries.map(([k]) => k)
}

/* ───────────────────────── Lectura ───────────────────────── */

export function readDraft(ydraft: YDraft): DraftState {
  const schema: Record<string, unknown> = { dialect: (ydraft.get('dialect') as string) ?? 'postgresql' }
  for (const c of COLLECTIONS) {
    const map = ydraft.get(c) as Y.Map<unknown> | undefined
    if (!map) {
      if (c !== 'dataMigrations') schema[c] = []
      continue
    }
    schema[c] = orderedIds(map).map((id) => readEntity(c, map.get(id)))
  }
  return { schema: schema as unknown as Schema, baseVersionId: (ydraft.get('baseVersionId') as string | null) ?? null }
}

export function readBranches(doc: Y.Doc): Branch[] {
  const list: Branch[] = []
  rootMaps(doc).branches.forEach((m) => list.push(m.toJSON() as Branch))
  return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
}

const versionCache = new Map<string, Version>()
/** Versiones ordenadas por fecha. Reutiliza el objeto si el JSON no cambió (evita renders). */
export function readVersions(doc: Y.Doc): Version[] {
  const list: Version[] = []
  rootMaps(doc).versions.forEach((json) => {
    let v = versionCache.get(json)
    if (!v) {
      v = JSON.parse(json) as Version
      versionCache.set(json, v)
    }
    list.push(v)
  })
  return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
}

export function readMeta(doc: Y.Doc): { projectId: string; name: string; dialect: Project['dialect'] } {
  const meta = rootMaps(doc).meta
  return {
    projectId: (meta.get('projectId') as string) ?? '',
    name: (meta.get('name') as string) ?? 'proyecto-compartido',
    dialect: (meta.get('dialect') as Project['dialect']) ?? 'postgresql',
  }
}

/**
 * Documento → proyecto. `currentBranchId` es la primera rama (la rama actual es local: la decide quien llama)
 * y `connections` va vacío (no se comparten).
 */
export function docToProject(doc: Y.Doc): { project: Project; drafts: Record<string, DraftState> } {
  const meta = readMeta(doc)
  const branches = readBranches(doc)
  const drafts: Record<string, DraftState> = {}
  rootMaps(doc).drafts.forEach((ydraft, branchId) => (drafts[branchId] = readDraft(ydraft)))
  return {
    project: {
      id: meta.projectId,
      name: meta.name,
      dialect: meta.dialect,
      branches,
      versions: readVersions(doc),
      currentBranchId: branches[0]?.id ?? '',
      connections: [],
    },
    drafts,
  }
}

/* ───────────────────────── Escritura con diff mínimo ───────────────────────── */

/** Reordena con el mínimo de cambios de ORDER_KEY para que el orden del documento sea `ids`. */
function fixOrder(map: Y.Map<unknown>, ids: string[]): void {
  let last = -Infinity
  for (const id of ids) {
    const value = map.get(id)
    if (value === undefined) continue
    const o = orderOf(value)
    if (o > last && o !== Number.MAX_SAFE_INTEGER) {
      last = o
      continue
    }
    const next = Number.isFinite(last) ? last + 1 : 0
    if (value instanceof Y.Map) value.set(ORDER_KEY, next)
    else map.set(id, { ...(value as Record<string, unknown>), [ORDER_KEY]: next })
    last = next
  }
}

/** Columnas: conserva la subsecuencia común más larga (LCS por id) y mueve/crea/borra el resto. */
function syncColumns(arr: Y.Array<Y.Map<unknown>>, next: Column[]): void {
  const current = arr.toArray()
  const curIds = current.map((m) => m.get('id') as string)
  const nextIds = next.map((c) => c.id)
  if (curIds.length === nextIds.length && curIds.every((id, i) => id === nextIds[i])) {
    next.forEach((col, i) => syncFields(current[i], col as unknown as Entity))
    return
  }
  const keep = lcs(curIds, nextIds)
  // Borra (de atrás hacia delante) lo que no está en la LCS: eliminadas y movidas.
  for (let i = curIds.length - 1; i >= 0; i--) if (!keep.has(curIds[i])) arr.delete(i, 1)
  // Inserta en su sitio las nuevas/movidas y actualiza campos de las que se quedan.
  next.forEach((col, i) => {
    const existing = i < arr.length ? arr.get(i) : undefined
    if (existing && existing.get('id') === col.id) syncFields(existing, col as unknown as Entity)
    else arr.insert(i, [columnToY(col)])
  })
}

function lcs(a: string[], b: string[]): Set<string> {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out = new Set<string>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.add(a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return out
}

/** Actualiza campo a campo un Y.Map de entidad (columnas de tabla en Y.Array, textos en Y.Text). */
function syncFields(m: Y.Map<unknown>, entity: Entity, opts: { text?: string; tableColumns?: boolean } = {}): void {
  for (const [k, v] of Object.entries(entity)) {
    if (opts.tableColumns && k === 'columns' && Array.isArray(v)) {
      const arr = m.get('columns')
      if (arr instanceof Y.Array) syncColumns(arr as Y.Array<Y.Map<unknown>>, v as Column[])
      else {
        const fresh = new Y.Array<Y.Map<unknown>>()
        fresh.push((v as Column[]).map(columnToY))
        m.set('columns', fresh)
      }
    } else if (k === opts.text) {
      const t = m.get(k)
      if (t instanceof Y.Text) applyTextDiff(t, String(v ?? ''))
      else m.set(k, new Y.Text(String(v ?? '')))
    } else setField(m, k, v)
  }
  // Campos que desaparecieron (opcionales puestos a undefined o borrados).
  for (const k of Array.from(m.keys())) if (k !== ORDER_KEY && entity[k] === undefined) m.delete(k)
}

const syncOpts = (c: CollectionKey) => ({ text: TEXT_FIELD[c], tableColumns: c === 'tables' })

function collectionMap(ydraft: YDraft, c: CollectionKey): Y.Map<unknown> {
  let map = ydraft.get(c) as Y.Map<unknown> | undefined
  if (!map) {
    map = new Y.Map<unknown>()
    ydraft.set(c, map)
  }
  return map
}

/**
 * Lleva el borrador del documento a `next`. Con `prev` (el último estado ya sincronizado) solo se miran las
 * entidades que cambiaron entre prev y next; aun así, cada escritura se compara con el documento, así que
 * es idempotente.
 */
export function writeDraft(ydraft: YDraft, next: DraftState, prev?: DraftState | null): void {
  if (ydraft.get('baseVersionId') !== next.baseVersionId) ydraft.set('baseVersionId', next.baseVersionId)
  if (ydraft.get('dialect') !== next.schema.dialect) ydraft.set('dialect', next.schema.dialect)
  const schema = next.schema as unknown as Record<string, Entity[] | undefined>
  const before = prev?.schema as unknown as Record<string, Entity[] | undefined> | undefined
  for (const c of COLLECTIONS) {
    const list = schema[c]
    const prevList = before?.[c]
    if (prev && list === prevList) continue
    if (list === undefined) {
      if (c === 'dataMigrations' && ydraft.has(c)) ydraft.delete(c)
      continue
    }
    const map = collectionMap(ydraft, c)
    const prevById = new Map((prevList ?? []).map((e) => [e.id, e]))
    const ids = new Set(list.map((e) => e.id))
    // Borradas.
    for (const id of Array.from(map.keys())) if (!ids.has(id)) map.delete(id)
    // Nuevas o modificadas.
    list.forEach((entity, i) => {
      const existing = map.get(entity.id)
      if (existing === undefined) {
        map.set(entity.id, entityToY(c, entity, i))
        return
      }
      const old = prevById.get(entity.id)
      if (prev && old !== undefined && (old === entity || deepEqual(old, entity))) return
      if (existing instanceof Y.Map) syncFields(existing, entity, syncOpts(c))
      else {
        const { [ORDER_KEY]: o, ...stored } = existing as Record<string, unknown>
        if (!deepEqual(stored, entity)) map.set(entity.id, { ...clean(structuredCloneSafe(entity)), [ORDER_KEY]: o })
      }
    })
    fixOrder(map, list.map((e) => e.id))
  }
}

/** Ramas: añade, borra y actualiza campo a campo. */
export function writeBranches(doc: Y.Doc, next: Branch[], removeMissing = true): void {
  const { branches } = rootMaps(doc)
  const ids = new Set(next.map((b) => b.id))
  if (removeMissing) for (const id of Array.from(branches.keys())) if (!ids.has(id)) branches.delete(id)
  for (const b of next) {
    const existing = branches.get(b.id)
    if (!existing) {
      const m = new Y.Map<unknown>()
      for (const [k, v] of Object.entries(b)) if (v !== undefined) m.set(k, v)
      branches.set(b.id, m)
    } else syncFields(existing, b as unknown as Entity)
  }
}

/** Versiones: JSON inmutable; solo se añaden (o se reemplazan si cambió algo como githubSha). */
export function writeVersions(doc: Y.Doc, next: Version[], removeMissing = false): void {
  const { versions } = rootMaps(doc)
  if (removeMissing) {
    const ids = new Set(next.map((v) => v.id))
    for (const id of Array.from(versions.keys())) if (!ids.has(id)) versions.delete(id)
  }
  for (const v of next) {
    const json = JSON.stringify(v)
    if (versions.get(v.id) !== json) {
      versionCache.set(json, v)
      versions.set(v.id, json)
    }
  }
}

export function writeMeta(doc: Y.Doc, project: Pick<Project, 'id' | 'name' | 'dialect'>): void {
  const { meta } = rootMaps(doc)
  if (meta.get('projectId') !== project.id) meta.set('projectId', project.id)
  if (meta.get('name') !== project.name) meta.set('name', project.name)
  if (meta.get('dialect') !== project.dialect) meta.set('dialect', project.dialect)
}

/** Crea (o reemplaza) el borrador de una rama. */
export function createDraft(doc: Y.Doc, branchId: string, draft: DraftState): YDraft {
  const ydraft = new Y.Map<unknown>()
  rootMaps(doc).drafts.set(branchId, ydraft)
  writeDraft(ydraft, draft, null)
  return ydraft
}

/** Escribe el proyecto completo en `doc` (dentro de una transacción con `origin`). */
export function writeProjectToDoc(doc: Y.Doc, project: Project, drafts: Record<string, DraftState>, origin?: unknown): void {
  doc.transact(() => {
    writeMeta(doc, project)
    writeVersions(doc, project.versions)
    writeBranches(doc, project.branches)
    const ydrafts = rootMaps(doc).drafts
    for (const [branchId, draft] of Object.entries(drafts)) {
      const existing = ydrafts.get(branchId)
      if (existing) writeDraft(existing, draft, null)
      else createDraft(doc, branchId, draft)
    }
  }, origin)
}

/** Proyecto → documento Yjs nuevo (o `doc` si se pasa). `drafts`: borrador por rama. */
export function projectToDoc(project: Project, drafts: Record<string, DraftState> = {}, doc: Y.Doc = new Y.Doc()): Y.Doc {
  writeProjectToDoc(doc, project, drafts)
  return doc
}

/* ───────────────────────── Cabeza de rama ───────────────────────── */

/** Esquema de la cabeza de una rama (o de su versión de origen) según el documento. */
export function headDraft(doc: Y.Doc, branchId: string): DraftState {
  const { branches, versions } = rootMaps(doc)
  const branch = branches.get(branchId)
  const meta = readMeta(doc)
  for (const key of ['headVersionId', 'forkedFromVersionId']) {
    const id = branch?.get(key) as string | null | undefined
    const json = id ? versions.get(id) : undefined
    if (id && json) return { schema: structuredClone((JSON.parse(json) as Version).schema), baseVersionId: id }
  }
  return {
    schema: { dialect: meta.dialect, tables: [], views: [], relations: [], enums: [], functions: [], triggers: [], notes: [] },
    baseVersionId: null,
  }
}
