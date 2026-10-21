// Posicionamiento automático en rejilla. Sin dependencias de runtime (lo usa también el servidor).
import type { Schema } from '@/types/schema'

export const IMPORT_TABLE_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#f43f5e', '#06b6d4', '#64748b']

export interface GridOptions {
  originX?: number
  originY?: number
  /** Ancho de celda (px). */
  cellWidth?: number
  /** Separación vertical entre filas (px). */
  gapY?: number
  /** Columnas de la rejilla; por defecto ceil(sqrt(n)) acotado a [2, 6]. */
  columns?: number
}

/**
 * Coloca las tablas en rejilla. Las tablas relacionadas quedan cerca: se recorren
 * los componentes conexos en anchura empezando por la tabla con más relaciones.
 * Muta y devuelve el mismo esquema.
 */
export function gridLayout<
  S extends Pick<Schema, 'tables' | 'relations'> & Partial<Pick<Schema, 'functions' | 'triggers' | 'notes' | 'views'>>,
>(
  schema: S,
  opts: GridOptions = {},
): S {
  const { originX = 80, originY = 80, cellWidth = 320, gapY = 80 } = opts
  const n = Math.max(schema.tables.length, schema.views?.length ?? 0)
  if (!n) return schema
  const cols = opts.columns ?? Math.min(6, Math.max(2, Math.ceil(Math.sqrt(n))))

  const adj = new Map<string, Set<string>>(schema.tables.map((t) => [t.id, new Set<string>()]))
  for (const r of schema.relations) {
    adj.get(r.sourceTableId)?.add(r.targetTableId)
    adj.get(r.targetTableId)?.add(r.sourceTableId)
  }
  const byDegree = [...schema.tables].sort((a, b) => (adj.get(b.id)?.size ?? 0) - (adj.get(a.id)?.size ?? 0))
  const order: string[] = []
  const seen = new Set<string>()
  for (const start of byDegree) {
    if (seen.has(start.id)) continue
    const queue = [start.id]
    seen.add(start.id)
    while (queue.length) {
      const id = queue.shift()!
      order.push(id)
      for (const nb of adj.get(id) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb)
          queue.push(nb)
        }
      }
    }
  }

  const byId = new Map(schema.tables.map((t) => [t.id, t]))
  let y = originY
  for (let row = 0; row * cols < order.length; row++) {
    const ids = order.slice(row * cols, row * cols + cols)
    let maxH = 0
    ids.forEach((id, col) => {
      const t = byId.get(id)!
      t.position = { x: originX + col * cellWidth, y }
      maxH = Math.max(maxH, 48 + t.columns.length * 30)
    })
    y += maxH + gapY
  }

  // Vistas, funciones y notas debajo de las tablas.
  const views = schema.views ?? []
  views.forEach((v, i) => {
    v.position = { x: originX + (i % cols) * cellWidth, y: y + Math.floor(i / cols) * 260 }
  })
  if (views.length) y += Math.ceil(views.length / cols) * 260 + gapY
  const extras = [...(schema.functions ?? []), ...(schema.notes ?? [])]
  extras.forEach((e, i) => {
    e.position = { x: originX + (i % cols) * cellWidth, y: y + Math.floor(i / cols) * 200 }
  })
  for (const t of schema.triggers ?? []) {
    const table = byId.get(t.tableId)
    t.position = table ? { x: table.position.x + 280, y: table.position.y } : { x: originX, y }
  }
  return schema
}
