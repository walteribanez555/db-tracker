import type { Position, Schema } from '@/types/schema'

import { TABLE_WIDTH, TRIGGER_HEIGHT, snap, tableHeight, viewHeight } from './constants'

const COLUMN_GAP = 128
const ROW_GAP = 48
const TRIGGER_GAP = 16
const ORIGIN = 64

/**
 * Layout por niveles de dependencia: las tablas referenciadas (lado "uno") quedan a la izquierda,
 * cada dependiente una columna más a la derecha que su padre más profundo, y las vistas a la derecha
 * de sus orígenes. Los triggers se apilan bajo su tabla.
 */
export function computeLayout(schema: Schema): Record<string, Position> {
  const ids = [...schema.tables.map((t) => t.id), ...schema.views.map((v) => v.id)]
  const parents = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]))
  for (const r of schema.relations) {
    if (r.sourceTableId !== r.targetTableId) parents.get(r.targetTableId)?.add(r.sourceTableId)
  }
  for (const v of schema.views) for (const s of v.sourceIds) if (s !== v.id && parents.has(s)) parents.get(v.id)?.add(s)

  const level = new Map<string, number>()
  const visiting = new Set<string>()
  const resolve = (id: string): number => {
    const known = level.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    let lvl = 0
    for (const p of parents.get(id) ?? []) lvl = Math.max(lvl, resolve(p) + 1)
    visiting.delete(id)
    level.set(id, lvl)
    return lvl
  }
  ids.forEach(resolve)

  const columns: string[][] = []
  for (const id of ids) (columns[level.get(id) ?? 0] ??= []).push(id)

  const triggersByTable = new Map<string, string[]>()
  for (const t of schema.triggers) triggersByTable.set(t.tableId, [...(triggersByTable.get(t.tableId) ?? []), t.id])

  const heightOf = new Map<string, number>([
    ...schema.tables.map((t) => [t.id, tableHeight(t.columns.length)] as const),
    ...schema.views.map((v) => [v.id, viewHeight(v.columns.length)] as const),
  ])

  const positions: Record<string, Position> = {}
  const centerY = new Map<string, number>()

  columns.forEach((col, lvl) => {
    const order = col
      .map((id, i) => {
        const ps = [...(parents.get(id) ?? [])].map((p) => centerY.get(p)).filter((v): v is number => v !== undefined)
        return { id, key: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER / 2 + i }
      })
      .sort((a, b) => a.key - b.key)

    const x = snap(ORIGIN + lvl * (TABLE_WIDTH + COLUMN_GAP))
    let y = ORIGIN
    for (const { id } of order) {
      const h = heightOf.get(id) ?? tableHeight(1)
      positions[id] = { x, y: snap(y) }
      centerY.set(id, y + h / 2)
      y += h
      for (const triggerId of triggersByTable.get(id) ?? []) {
        y += TRIGGER_GAP
        positions[triggerId] = { x: x + 16, y: snap(y) }
        y += TRIGGER_HEIGHT
      }
      y += ROW_GAP
    }
  })

  return positions
}
