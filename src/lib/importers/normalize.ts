// Normalización de esquemas importados: valores por defecto, ids nuevos y colores.
import { uid } from '@/lib/id'
import type { Cardinality, Column, Dialect, ReferentialAction, Schema, TriggerEvent, TriggerTiming } from '@/types/schema'

import { IMPORT_TABLE_COLORS } from './layout'
import { VIEW_COLOR } from './views'

/** Opciones comunes de los importadores: permiten separar parseo, normalización y posicionado. */
export interface ParseOptions {
  /** Colocar las tablas en rejilla (por defecto true). */
  layout?: boolean
  /** Regenerar ids y completar campos (solo JSON; por defecto true). */
  normalize?: boolean
}

const ACTIONS: ReferentialAction[] = ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT']
const DIALECTS: Dialect[] = ['postgresql', 'mysql', 'sqlite', 'sqlserver']

export function toAction(v: unknown): ReferentialAction {
  const s = String(v ?? '')
    .toUpperCase()
    .replace(/_/g, ' ')
    .trim()
  return (ACTIONS as string[]).includes(s) ? (s as ReferentialAction) : 'NO ACTION'
}

const str = (v: unknown, def = '') => (typeof v === 'string' ? v : v === undefined || v === null ? def : String(v))
const arr = <T = unknown,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const pos = (v: unknown) => {
  const p = v as { x?: unknown; y?: unknown } | undefined
  return { x: Number(p?.x) || 0, y: Number(p?.y) || 0 }
}

/**
 * Convierte un objeto con forma de `Schema` (posiblemente incompleto) en un `Schema` válido
 * con ids nuevos y referencias internas reasignadas.
 * Devuelve además si todas las tablas traían posición.
 */
export function reidSchema(input: unknown, fallbackDialect: Dialect = 'postgresql'): { schema: Schema; hadPositions: boolean } {
  const src = (input ?? {}) as Record<string, unknown>
  const ids = new Map<string, string>()
  const map = (old: unknown, prefix: string) => {
    const k = `${prefix}:${str(old)}`
    if (!ids.has(k)) ids.set(k, uid(prefix))
    return ids.get(k)!
  }
  const colKey = (tableId: unknown, colId: unknown) => `${str(tableId)}::${str(colId)}`
  let hadPositions = true

  const tables = arr<Record<string, unknown>>(src.tables).map((t, ti) => {
    if (!t.position) hadPositions = false
    const tableId = map(t.id ?? `t${ti}`, 'tbl_')
    const columns: Column[] = arr<Record<string, unknown>>(t.columns).map((c, ci) => ({
      id: map(colKey(t.id ?? `t${ti}`, c.id ?? `c${ci}`), 'col_'),
      name: str(c.name, `columna_${ci + 1}`),
      type: str(c.type, 'text'),
      pk: !!c.pk,
      nullable: c.nullable === undefined ? !c.pk : !!c.nullable,
      unique: !!c.unique,
      autoIncrement: !!c.autoIncrement,
      ...(c.default !== undefined && c.default !== null && c.default !== '' ? { default: str(c.default) } : {}),
      ...(c.comment ? { comment: str(c.comment) } : {}),
    }))
    return {
      id: tableId,
      name: str(t.name, `tabla_${ti + 1}`),
      color: /^#[0-9a-f]{3,8}$/i.test(str(t.color)) ? str(t.color) : IMPORT_TABLE_COLORS[ti % IMPORT_TABLE_COLORS.length],
      ...(t.comment ? { comment: str(t.comment) } : {}),
      columns,
      indexes: arr<Record<string, unknown>>(t.indexes).map((i, ii) => ({
        id: uid('idx_'),
        name: str(i.name, `idx_${ii + 1}`),
        unique: !!i.unique,
        columnIds: arr(i.columnIds)
          .map((cid) => ids.get(`col_:${colKey(t.id ?? `t${ti}`, cid)}`))
          .filter((x): x is string => !!x),
      })),
      position: pos(t.position),
    }
  })

  const tableIdOf = (old: unknown) => ids.get(`tbl_:${str(old)}`)
  const colIdOf = (oldTable: unknown, oldCol: unknown) => ids.get(`col_:${colKey(oldTable, oldCol)}`)

  const relations = arr<Record<string, unknown>>(src.relations).flatMap((r) => {
    const sourceTableId = tableIdOf(r.sourceTableId)
    const targetTableId = tableIdOf(r.targetTableId)
    const sourceColumnId = colIdOf(r.sourceTableId, r.sourceColumnId)
    const targetColumnId = colIdOf(r.targetTableId, r.targetColumnId)
    if (!sourceTableId || !targetTableId || !sourceColumnId || !targetColumnId) return []
    const card = str(r.cardinality)
    return [
      {
        id: uid('rel_'),
        ...(r.name ? { name: str(r.name) } : {}),
        sourceTableId,
        sourceColumnId,
        targetTableId,
        targetColumnId,
        cardinality: (['1:1', '1:N', 'N:M'].includes(card) ? card : '1:N') as Cardinality,
        onDelete: toAction(r.onDelete),
        onUpdate: toAction(r.onUpdate),
      },
    ]
  })

  const enums = arr<Record<string, unknown>>(src.enums).map((e) => ({
    id: uid('enum_'),
    name: str(e.name, 'enum'),
    values: arr(e.values).map((v) => str(v)),
  }))

  const functions = arr<Record<string, unknown>>(src.functions).map((f) => ({
    id: map(f.id, 'fn_'),
    name: str(f.name, 'funcion'),
    language: (f.language === 'sql' ? 'sql' : 'plpgsql') as 'sql' | 'plpgsql',
    args: str(f.args),
    returns: str(f.returns, 'trigger'),
    body: str(f.body),
    ...(f.comment ? { comment: str(f.comment) } : {}),
    position: pos(f.position),
  }))

  const triggers = arr<Record<string, unknown>>(src.triggers).flatMap((t) => {
    const tableId = tableIdOf(t.tableId)
    const functionId = ids.get(`fn_:${str(t.functionId)}`)
    if (!tableId || !functionId) return []
    return [
      {
        id: uid('trg_'),
        name: str(t.name, 'trigger'),
        tableId,
        functionId,
        timing: (['BEFORE', 'AFTER', 'INSTEAD OF'].includes(str(t.timing)) ? t.timing : 'BEFORE') as TriggerTiming,
        events: arr(t.events).filter((e): e is TriggerEvent => ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].includes(str(e))),
        level: (t.level === 'STATEMENT' ? 'STATEMENT' : 'ROW') as 'ROW' | 'STATEMENT',
        ...(t.condition ? { condition: str(t.condition) } : {}),
        ...(t.enabled === false ? { enabled: false } : {}),
        position: pos(t.position),
      },
    ]
  })

  const notes = arr<Record<string, unknown>>(src.notes).map((n) => ({
    id: uid('note_'),
    text: str(n.text),
    color: str(n.color, '#fef08a'),
    position: pos(n.position),
  }))

  const views = arr<Record<string, unknown>>(src.views).map((v) => ({
    id: map(v.id, 'view_'),
    name: str(v.name, 'vista'),
    definition: str(v.definition),
    materialized: !!v.materialized,
    sourceIds: [] as string[],
    columns: arr<Record<string, unknown>>(v.columns).map((c) => ({ name: str(c.name), ...(c.type ? { type: str(c.type) } : {}) })),
    color: /^#[0-9a-f]{3,8}$/i.test(str(v.color)) ? str(v.color) : VIEW_COLOR,
    ...(v.comment ? { comment: str(v.comment) } : {}),
    position: pos(v.position),
    _sources: arr(v.sourceIds),
  }))
  const finalViews = views.map(({ _sources, ...v }) => ({
    ...v,
    sourceIds: _sources.map((sid) => ids.get(`tbl_:${str(sid)}`) ?? ids.get(`view_:${str(sid)}`)).filter((x): x is string => !!x),
  }))

  const dialect = (DIALECTS as string[]).includes(str(src.dialect)) ? (src.dialect as Dialect) : fallbackDialect
  // Las pistas de migración de datos se refieren a nombres (no a ids): se conservan tal cual.
  const dataMigrations = arr<Record<string, unknown>>(src.dataMigrations)
    .filter((h) => typeof h.sql === 'string')
    .map((h) => ({
      id: str(h.id, uid('dm_')),
      description: str(h.description),
      sql: str(h.sql),
      sourceColumns: arr(h.sourceColumns).map((x) => str(x)),
      requiresTables: arr(h.requiresTables).map((x) => str(x)),
    }))
  return {
    schema: { dialect, tables, views: finalViews, relations, enums, functions, triggers, notes, ...(dataMigrations.length ? { dataMigrations } : {}) },
    hadPositions: hadPositions && tables.length > 0,
  }
}

/** Cardinalidad inferida: si la FK es única (o la única PK) es 1:1. */
export function inferCardinality(fk: Pick<Column, 'unique' | 'pk'>, pkCount: number): Cardinality {
  return fk.unique || (fk.pk && pkCount === 1) ? '1:1' : '1:N'
}
