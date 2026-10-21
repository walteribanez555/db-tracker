import { runOperation, type RunnableStep } from '@/components/operation-flow'
import { useProjectStore } from '@/store/project'
import type { Column, Relation, Schema, Table } from '@/types/schema'

import { batchHistory } from './history'

const store = () => useProjectStore.getState()
const mutate = (fn: (d: Schema) => void) => store().mutate(fn)
const sig = (v: unknown) => JSON.stringify(v)
const withoutPosition = <T extends { position?: unknown }>(v: T) => sig({ ...v, position: undefined })
const tableIn = (d: Schema, id: string) => d.tables.find((t) => t.id === id)
const names = (cols: { name: string }[]) => cols.map((c) => c.name).join(', ')

function columnChange(a: Column, b: Column): string {
  const parts: string[] = []
  if (a.name !== b.name) parts.push(`${a.name} → ${b.name}`)
  if (a.type !== b.type) parts.push(`${b.name}: ${a.type} → ${b.type}`)
  if (a.pk !== b.pk) parts.push(`${b.name}: ${b.pk ? '+PK' : '−PK'}`)
  if (a.nullable !== b.nullable) parts.push(`${b.name}: ${b.nullable ? 'NULL' : 'NOT NULL'}`)
  if (a.unique !== b.unique) parts.push(`${b.name}: ${b.unique ? '+UNIQUE' : '−UNIQUE'}`)
  return parts.join(', ') || b.name
}

const relationText = (s: Schema, r: Relation) => {
  const st = tableIn(s, r.sourceTableId)
  const tt = tableIn(s, r.targetTableId)
  const sc = st?.columns.find((c) => c.id === r.sourceColumnId)
  const tc = tt?.columns.find((c) => c.id === r.targetColumnId)
  return `${st?.name}.${sc?.name} → ${tt?.name}.${tc?.name}`
}

/**
 * Descompone el paso de `before` a `after` en pasos reales que se aplican sobre el borrador en orden:
 * tablas nuevas → columnas → funciones → relaciones → índices → triggers → vistas → bajas.
 */
export function planTransition(before: Schema, after: Schema): RunnableStep[] {
  const steps: RunnableStep[] = []
  const prevTables = new Map(before.tables.map((t) => [t.id, t]))
  const nextTables = new Map(after.tables.map((t) => [t.id, t]))

  for (const t of after.tables) {
    if (prevTables.has(t.id)) continue
    steps.push({
      id: `table-add-${t.id}`,
      label: `Crear tabla ${t.name}`,
      detail: `${t.columns.length} columnas: ${names(t.columns)}`,
      kind: 'table',
      run: () => mutate((d) => void d.tables.push({ ...structuredClone(t), indexes: [] })),
    })
  }

  for (const t of after.tables) {
    const b = prevTables.get(t.id)
    if (!b) continue
    if (b.name !== t.name || b.comment !== t.comment || b.color !== t.color) {
      steps.push({
        id: `table-mod-${t.id}`,
        label: b.name !== t.name ? 'Renombrar tabla' : `Actualizar ${t.name}`,
        detail: b.name !== t.name ? `${b.name} → ${t.name}` : 'comentario / color',
        kind: 'table',
        run: () =>
          mutate((d) => {
            const x = tableIn(d, t.id)
            if (x) Object.assign(x, { name: t.name, comment: t.comment, color: t.color })
          }),
      })
    }
    const prevCols = new Map(b.columns.map((c) => [c.id, c]))
    const added = t.columns.filter((c) => !prevCols.has(c.id))
    if (added.length) {
      const ids = new Set(added.map((c) => c.id))
      steps.push({
        id: `cols-add-${t.id}`,
        label: `Añadir columnas a ${t.name}`,
        detail: names(added),
        kind: 'column',
        run: () =>
          mutate((d) => {
            const x = tableIn(d, t.id)
            if (!x) return
            const current = new Map(x.columns.map((c) => [c.id, c]))
            const ordered = t.columns
              .filter((c) => current.has(c.id) || ids.has(c.id))
              .map((c) => current.get(c.id) ?? structuredClone(c))
            const rest = x.columns.filter((c) => !t.columns.some((n) => n.id === c.id))
            x.columns = [...ordered, ...rest]
          }),
      })
    }
    const changed = t.columns.filter((c) => {
      const o = prevCols.get(c.id)
      return o && sig(o) !== sig(c)
    })
    if (changed.length) {
      steps.push({
        id: `cols-mod-${t.id}`,
        label: `Modificar columnas en ${t.name}`,
        detail: changed.map((c) => columnChange(prevCols.get(c.id)!, c)).join(' · '),
        kind: 'column',
        run: () =>
          mutate((d) => {
            const x = tableIn(d, t.id)
            for (const c of changed) {
              const col = x?.columns.find((y) => y.id === c.id)
              if (col) Object.assign(col, structuredClone(c))
            }
          }),
      })
    }
  }

  const prevFns = new Map(before.functions.map((f) => [f.id, f]))
  for (const f of after.functions) {
    const o = prevFns.get(f.id)
    if (o && withoutPosition(o) === withoutPosition(f)) continue
    steps.push({
      id: `fn-${f.id}`,
      label: o ? `Actualizar función ${f.name}()` : `Crear función ${f.name}()`,
      detail: `${f.language} · ${f.body.split('\n').length} líneas`,
      kind: 'function',
      run: () => mutate((d) => void (d.functions = [...d.functions.filter((x) => x.id !== f.id), structuredClone(f)])),
    })
  }

  const prevRels = new Map(before.relations.map((r) => [r.id, r]))
  for (const r of after.relations) {
    const o = prevRels.get(r.id)
    if (o && sig(o) === sig(r)) continue
    steps.push({
      id: `rel-${r.id}`,
      label: o ? 'Actualizar relación' : 'Crear relación',
      detail: `${relationText(after, r)} (${r.cardinality})`,
      kind: 'relation',
      run: () => mutate((d) => void (d.relations = [...d.relations.filter((x) => x.id !== r.id), structuredClone(r)])),
    })
  }

  for (const t of after.tables) {
    const prevIdx = new Set((prevTables.get(t.id)?.indexes ?? []).map((i) => sig(i)))
    for (const idx of t.indexes) {
      if (prevIdx.has(sig(idx))) continue
      steps.push({
        id: `idx-${idx.id}`,
        label: `Crear índice ${idx.name}`,
        detail: `${t.name}(${idx.columnIds.map((id) => t.columns.find((c) => c.id === id)?.name ?? '?').join(', ')})${idx.unique ? ' UNIQUE' : ''}`,
        kind: 'index',
        run: () =>
          mutate((d) => {
            const x = tableIn(d, t.id)
            if (x) x.indexes = [...x.indexes.filter((i) => i.id !== idx.id), structuredClone(idx)]
          }),
      })
    }
  }

  const prevTriggers = new Map(before.triggers.map((t) => [t.id, t]))
  for (const tr of after.triggers) {
    const o = prevTriggers.get(tr.id)
    if (o && withoutPosition(o) === withoutPosition(tr)) continue
    steps.push({
      id: `trg-${tr.id}`,
      label: o ? `Actualizar trigger ${tr.name}` : `Crear trigger ${tr.name}`,
      detail: `${tr.timing} ${tr.events.join(', ')} ON ${nextTables.get(tr.tableId)?.name ?? '?'}`,
      kind: 'trigger',
      run: () => mutate((d) => void (d.triggers = [...d.triggers.filter((x) => x.id !== tr.id), structuredClone(tr)])),
    })
  }

  const prevViews = new Map(before.views.map((v) => [v.id, v]))
  for (const v of after.views) {
    const o = prevViews.get(v.id)
    if (o && withoutPosition(o) === withoutPosition(v)) continue
    steps.push({
      id: `view-${v.id}`,
      label: o ? `Actualizar vista ${v.name}` : `Crear vista ${v.name}`,
      detail: `${v.columns.length} columnas`,
      kind: 'view',
      run: () => mutate((d) => void (d.views = [...d.views.filter((x) => x.id !== v.id), structuredClone(v)])),
    })
  }

  // Bajas al final: primero lo que depende de columnas y tablas.
  const nextRelIds = new Set(after.relations.map((r) => r.id))
  for (const r of before.relations) {
    if (nextRelIds.has(r.id)) continue
    steps.push({
      id: `rel-del-${r.id}`,
      label: 'Quitar relación',
      detail: relationText(before, r),
      kind: 'relation',
      run: () => mutate((d) => void (d.relations = d.relations.filter((x) => x.id !== r.id))),
    })
  }
  const dropById = <K extends 'views' | 'triggers' | 'functions'>(key: K, label: string, kind: RunnableStep['kind']) => {
    const keep = new Set(after[key].map((x) => x.id))
    for (const x of before[key]) {
      if (keep.has(x.id)) continue
      steps.push({
        id: `${key}-del-${x.id}`,
        label,
        detail: x.name,
        kind,
        run: () => mutate((d) => void ((d[key] as { id: string }[]) = d[key].filter((y) => y.id !== x.id))),
      })
    }
  }
  dropById('views', 'Eliminar vista', 'view')
  dropById('triggers', 'Eliminar trigger', 'trigger')

  for (const b of before.tables) {
    const t = nextTables.get(b.id)
    if (!t) continue
    const keepIdx = new Set(t.indexes.map((i) => i.id))
    const droppedIdx = b.indexes.filter((i) => !keepIdx.has(i.id))
    const keepCols = new Set(t.columns.map((c) => c.id))
    const droppedCols = b.columns.filter((c) => !keepCols.has(c.id))
    if (droppedIdx.length) {
      steps.push({
        id: `idx-del-${b.id}`,
        label: `Quitar índices de ${t.name}`,
        detail: names(droppedIdx),
        kind: 'index',
        run: () =>
          mutate((d) => {
            const x = tableIn(d, b.id)
            if (x) x.indexes = x.indexes.filter((i) => keepIdx.has(i.id))
          }),
      })
    }
    if (droppedCols.length) {
      steps.push({
        id: `cols-del-${b.id}`,
        label: `Quitar columnas de ${t.name}`,
        detail: names(droppedCols),
        kind: 'column',
        run: () =>
          mutate((d) => {
            const x = tableIn(d, b.id)
            if (x) x.columns = x.columns.filter((c) => keepCols.has(c.id))
          }),
      })
    }
  }
  for (const b of before.tables) {
    if (nextTables.has(b.id)) continue
    steps.push({
      id: `table-del-${b.id}`,
      label: `Eliminar tabla ${b.name}`,
      kind: 'table',
      run: () => mutate((d) => void (d.tables = d.tables.filter((x: Table) => x.id !== b.id))),
    })
  }
  dropById('functions', 'Eliminar función', 'function')

  return steps
}

/**
 * Lleva el borrador al esquema `after` mostrando cada transformación en el dock de operaciones.
 * Todo queda en una sola entrada del historial; si un paso falla se restaura el estado anterior.
 */
export async function runSchemaTransition(title: string, after: Schema) {
  const before = store().draft
  const steps = planTransition(before, after)
  if (!steps.length) return { ok: true as const }
  return batchHistory(async () => {
    const result = await runOperation(title, steps)
    if (!result.ok) {
      store().replaceDraft(before)
      return { ok: false as const }
    }
    if (sig(store().draft) !== sig(after)) store().replaceDraft(after)
    return { ok: true as const }
  })
}
