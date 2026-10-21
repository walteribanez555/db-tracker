// Diff estructurado por objeto (con ids) para los cambios en vivo, validación del esquema y hooks reactivos.
import { useEffect, useMemo, useState } from 'react'

import { columnFieldChanges, diffSchemas, relationLabel, triggerFieldChanges, viewFieldChanges } from '@/lib/diff'
import { emptySchema, useProjectStore } from '@/store/project'
import type { SchemaDiff } from '@/types/report'
import type { Relation, Schema, Version } from '@/types/schema'

import type { DiffKind } from './lib'

export type ObjectKind = 'table' | 'view' | 'trigger' | 'relation'

export interface ChangeLine {
  key: string
  kind: DiffKind
  text: string
  /** Texto secundario (detalle del cambio). */
  detail?: string
}

export interface ObjectChange {
  key: string
  objectKind: ObjectKind
  id: string
  name: string
  status: DiffKind
  lines: ChangeLine[]
  /** Existe en el borrador (se puede seleccionar en el editor). */
  inDraft: boolean
}

const colDesc = (type: string, pk: boolean, nullable: boolean) => `${type}${pk ? ' PK' : ''}${nullable ? '' : ' NOT NULL'}`

function relationChanges(a: Relation, b: Relation, from: Schema, to: Schema): string[] {
  const out: string[] = []
  if (relationLabel({ ...a, name: undefined }, from) !== relationLabel({ ...b, name: undefined }, to)) {
    out.push(`extremos: ${relationLabel({ ...a, name: undefined }, from)} → ${relationLabel({ ...b, name: undefined }, to)}`)
  }
  if ((a.name ?? '') !== (b.name ?? '')) out.push(`nombre: ${a.name || '∅'} → ${b.name || '∅'}`)
  if (a.cardinality !== b.cardinality) out.push(`cardinalidad: ${a.cardinality} → ${b.cardinality}`)
  if (a.onDelete !== b.onDelete) out.push(`ON DELETE: ${a.onDelete} → ${b.onDelete}`)
  if (a.onUpdate !== b.onUpdate) out.push(`ON UPDATE: ${a.onUpdate} → ${b.onUpdate}`)
  return out
}

/** Cambios `base → draft` agrupados por objeto (tabla, vista, trigger, relación), en orden estable. */
export function objectChanges(base: Schema, draft: Schema): ObjectChange[] {
  const out: ObjectChange[] = []

  // Tablas
  const bT = new Map(base.tables.map((t) => [t.id, t]))
  const dT = new Map(draft.tables.map((t) => [t.id, t]))
  for (const t of draft.tables) {
    const prev = bT.get(t.id)
    if (!prev) {
      out.push({
        key: `table:${t.id}`,
        objectKind: 'table',
        id: t.id,
        name: t.name,
        status: 'add',
        inDraft: true,
        lines: t.columns.map((c) => ({ key: c.id, kind: 'add', text: c.name, detail: colDesc(c.type, c.pk, c.nullable) })),
      })
      continue
    }
    const lines: ChangeLine[] = []
    if (prev.name !== t.name) lines.push({ key: 'rename', kind: 'change', text: `${prev.name} → ${t.name}`, detail: 'renombrada' })
    const pc = new Map(prev.columns.map((c) => [c.id, c]))
    const nc = new Map(t.columns.map((c) => [c.id, c]))
    for (const c of t.columns) {
      const o = pc.get(c.id)
      if (!o) lines.push({ key: c.id, kind: 'add', text: c.name, detail: colDesc(c.type, c.pk, c.nullable) })
      else {
        const ch = columnFieldChanges(o, c)
        if (ch.length) lines.push({ key: c.id, kind: 'change', text: c.name, detail: ch.join('; ') })
      }
    }
    for (const c of prev.columns) if (!nc.has(c.id)) lines.push({ key: c.id, kind: 'remove', text: c.name })
    const pi = new Map(prev.indexes.map((i) => [i.id, i]))
    const ni = new Map(t.indexes.map((i) => [i.id, i]))
    for (const i of t.indexes) {
      const o = pi.get(i.id)
      if (!o) lines.push({ key: `idx:${i.id}`, kind: 'add', text: `índice ${i.name}` })
      else if (o.name !== i.name || o.unique !== i.unique || o.columnIds.join() !== i.columnIds.join())
        lines.push({ key: `idx:${i.id}`, kind: 'change', text: `índice ${i.name}` })
    }
    for (const i of prev.indexes) if (!ni.has(i.id)) lines.push({ key: `idx:${i.id}`, kind: 'remove', text: `índice ${i.name}` })
    if (lines.length) out.push({ key: `table:${t.id}`, objectKind: 'table', id: t.id, name: t.name, status: 'change', inDraft: true, lines })
  }
  for (const t of base.tables) {
    if (!dT.has(t.id)) out.push({ key: `table:${t.id}`, objectKind: 'table', id: t.id, name: t.name, status: 'remove', inDraft: false, lines: [] })
  }

  // Vistas
  const bV = new Map((base.views ?? []).map((v) => [v.id, v]))
  const dV = new Map((draft.views ?? []).map((v) => [v.id, v]))
  for (const v of draft.views ?? []) {
    const prev = bV.get(v.id)
    if (!prev) {
      out.push({
        key: `view:${v.id}`,
        objectKind: 'view',
        id: v.id,
        name: v.name,
        status: 'add',
        inDraft: true,
        lines: [{ key: 'def', kind: 'add', text: v.materialized ? 'vista materializada' : 'vista', detail: v.columns.map((c) => c.name).join(', ') }],
      })
    } else {
      const ch = viewFieldChanges(prev, v)
      if (ch.length)
        out.push({
          key: `view:${v.id}`,
          objectKind: 'view',
          id: v.id,
          name: v.name,
          status: 'change',
          inDraft: true,
          lines: ch.map((c, i) => ({ key: `c${i}:${c}`, kind: 'change', text: c })),
        })
    }
  }
  for (const v of base.views ?? []) {
    if (!dV.has(v.id)) out.push({ key: `view:${v.id}`, objectKind: 'view', id: v.id, name: v.name, status: 'remove', inDraft: false, lines: [] })
  }

  // Triggers
  const bG = new Map(base.triggers.map((t) => [t.id, t]))
  const dG = new Map(draft.triggers.map((t) => [t.id, t]))
  const tableName = (s: Schema, id: string) => s.tables.find((t) => t.id === id)?.name ?? '?'
  for (const t of draft.triggers) {
    const prev = bG.get(t.id)
    if (!prev) {
      out.push({
        key: `trigger:${t.id}`,
        objectKind: 'trigger',
        id: t.id,
        name: t.name,
        status: 'add',
        inDraft: true,
        lines: [{ key: 'def', kind: 'add', text: `${t.timing} ${t.events.join('/')}`, detail: `ON ${tableName(draft, t.tableId)}` }],
      })
    } else {
      const ch = triggerFieldChanges(prev, t, base, draft)
      if (ch.length)
        out.push({
          key: `trigger:${t.id}`,
          objectKind: 'trigger',
          id: t.id,
          name: t.name,
          status: 'change',
          inDraft: true,
          lines: ch.map((c, i) => ({ key: `c${i}:${c}`, kind: 'change', text: c })),
        })
    }
  }
  for (const t of base.triggers) {
    if (!dG.has(t.id)) out.push({ key: `trigger:${t.id}`, objectKind: 'trigger', id: t.id, name: t.name, status: 'remove', inDraft: false, lines: [] })
  }

  // Relaciones
  const bR = new Map(base.relations.map((r) => [r.id, r]))
  const dR = new Map(draft.relations.map((r) => [r.id, r]))
  for (const r of draft.relations) {
    const prev = bR.get(r.id)
    if (!prev) {
      out.push({ key: `relation:${r.id}`, objectKind: 'relation', id: r.id, name: relationLabel(r, draft), status: 'add', inDraft: true, lines: [] })
    } else {
      const ch = relationChanges(prev, r, base, draft)
      if (ch.length)
        out.push({
          key: `relation:${r.id}`,
          objectKind: 'relation',
          id: r.id,
          name: relationLabel(r, draft),
          status: 'change',
          inDraft: true,
          lines: ch.map((c, i) => ({ key: `c${i}:${c}`, kind: 'change', text: c })),
        })
    }
  }
  for (const r of base.relations) {
    if (!dR.has(r.id)) out.push({ key: `relation:${r.id}`, objectKind: 'relation', id: r.id, name: relationLabel(r, base), status: 'remove', inDraft: false, lines: [] })
  }

  return out
}

type Positioned = { id: string; position: { x: number; y: number } }

/** Elementos (tablas, vistas, notas, triggers, funciones) presentes en ambos esquemas con distinta posición. */
export function movedElements(base: Schema, draft: Schema): number {
  const count = (a: Positioned[] = [], b: Positioned[] = []) => {
    const prev = new Map(a.map((x) => [x.id, x.position]))
    return b.filter((x) => {
      const p = prev.get(x.id)
      return p && (Math.round(p.x) !== Math.round(x.position.x) || Math.round(p.y) !== Math.round(x.position.y))
    }).length
  }
  return (
    count(base.tables, draft.tables) +
    count(base.views, draft.views) +
    count(base.notes, draft.notes) +
    count(base.triggers, draft.triggers) +
    count(base.functions, draft.functions)
  )
}

/** Comprobaciones estructurales del esquema antes de confirmar (avisos, no bloquean). */
export function validateSchema(schema: Schema): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const t of schema.tables) {
    const n = t.name.trim().toLowerCase()
    if (!n) problems.push('Hay una tabla sin nombre')
    else if (seen.has(n)) problems.push(`Nombre de tabla duplicado: ${t.name}`)
    seen.add(n)
    if (!t.columns.length) problems.push(`${t.name} no tiene columnas`)
    else if (!t.columns.some((c) => c.pk)) problems.push(`${t.name} no tiene clave primaria`)
    const cols = new Set<string>()
    for (const c of t.columns) {
      const cn = c.name.trim().toLowerCase()
      if (cols.has(cn)) problems.push(`Columna duplicada ${t.name}.${c.name}`)
      cols.add(cn)
    }
  }
  const tables = new Map(schema.tables.map((t) => [t.id, t]))
  for (const r of schema.relations) {
    const s = tables.get(r.sourceTableId)
    const t = tables.get(r.targetTableId)
    if (!s?.columns.some((c) => c.id === r.sourceColumnId) || !t?.columns.some((c) => c.id === r.targetColumnId))
      problems.push(`Relación ${r.name ?? r.id} apunta a columnas inexistentes`)
  }
  for (const g of schema.triggers) {
    if (!tables.has(g.tableId)) problems.push(`Trigger ${g.name} sin tabla`)
    if (!schema.functions.some((f) => f.id === g.functionId)) problems.push(`Trigger ${g.name} sin función`)
    if (!g.events.length) problems.push(`Trigger ${g.name} sin eventos`)
  }
  for (const v of schema.views ?? []) {
    if (!v.definition.trim()) problems.push(`Vista ${v.name} sin definición`)
  }
  return problems
}

/** Valor que sigue a `value` con un retraso de `ms` (el primero, al instante). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    if (Object.is(v, value)) return
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms, v])
  return v
}

export interface LiveDiff {
  base: Version | undefined
  diff: SchemaDiff
  changes: ObjectChange[]
  /** Elementos con cambio de posición (sin efecto estructural). */
  moved: number
}

/** Diff en vivo versión base → borrador, recalculado con un pequeño debounce (~120 ms). */
export function useLiveDiff(ms = 120): LiveDiff {
  const draft = useDebounced(
    useProjectStore((s) => s.draft),
    ms,
  )
  const base = useProjectStore((s) => (s.baseVersionId ? s.project.versions.find((v) => v.id === s.baseVersionId) : undefined))
  const dialect = useProjectStore((s) => s.project.dialect)
  return useMemo(() => {
    const baseSchema = base?.schema ?? emptySchema(dialect)
    return { base, diff: diffSchemas(baseSchema, draft), changes: objectChanges(baseSchema, draft), moved: movedElements(baseSchema, draft) }
  }, [base, draft, dialect])
}
