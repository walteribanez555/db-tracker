import { uid } from '@/lib/id'
import { TABLE_COLORS, newColumn, useProjectStore } from '@/store/project'
import type { Column, Dialect, Index, Note, Position, Table, View } from '@/types/schema'

import { NOTE_COLORS, VIEW_COLOR } from './constants'
import { checkpoint } from './history'

const store = () => useProjectStore.getState()

/** Ejecuta una acción discreta como una entrada propia del historial. */
const discrete = <T>(fn: () => T): T => {
  checkpoint()
  const result = fn()
  checkpoint()
  return result
}

export const nextName = (prefix: string, taken: string[]) => {
  const set = new Set(taken)
  let n = 1
  while (set.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

const idColumn = (dialect: Dialect): Column =>
  dialect === 'postgresql'
    ? newColumn({ name: 'id', type: 'uuid', pk: true, nullable: false, default: 'gen_random_uuid()' })
    : newColumn({ name: 'id', type: dialect === 'sqlite' ? 'integer' : 'int', pk: true, nullable: false, autoIncrement: true })

export function createTable(position?: Position): Table {
  return discrete(() => {
    const { draft } = store()
    return store().addTable({
      name: nextName('tabla_', draft.tables.map((t) => t.name)),
      color: TABLE_COLORS[draft.tables.length % TABLE_COLORS.length],
      columns: [idColumn(draft.dialect)],
      ...(position ? { position } : {}),
    })
  })
}

export function createNote(position: Position): Note {
  return discrete(() => {
    const note: Note = { id: uid('note_'), text: 'Nueva nota', color: NOTE_COLORS[0], position }
    store().upsertNote(note)
    store().setSelection({ kind: 'note', id: note.id })
    return note
  })
}

export function updateNote(id: string, patch: Partial<Omit<Note, 'id'>>) {
  store().mutate((d) => {
    const n = d.notes.find((x) => x.id === id)
    if (n) Object.assign(n, patch)
  })
}

export function createView(position: Position, partial: Partial<Omit<View, 'id' | 'position'>> = {}): View {
  return discrete(() => {
    const { draft } = store()
    const view: View = {
      id: uid('view_'),
      name: nextName('vista_', draft.views.map((v) => v.name)),
      definition: '',
      materialized: false,
      sourceIds: [],
      columns: [],
      color: VIEW_COLOR,
      ...partial,
      position,
    }
    store().mutate((d) => void d.views.push(view))
    store().setSelection({ kind: 'view', id: view.id })
    return view
  })
}

export function updateView(id: string, patch: Partial<Omit<View, 'id'>>) {
  store().mutate((d) => {
    const v = d.views.find((x) => x.id === id)
    if (v) Object.assign(v, patch)
  })
}

export function addColumnTo(tableId: string): Column | undefined {
  const table = store().draft.tables.find((t) => t.id === tableId)
  if (!table) return
  return discrete(() => store().addColumn(tableId, { name: nextName('columna_', table.columns.map((c) => c.name)) }))
}

export const removeColumnFrom = (tableId: string, columnId: string) => discrete(() => store().removeColumn(tableId, columnId))

export const moveColumnIn = (tableId: string, from: number, to: number) => discrete(() => store().moveColumn(tableId, from, to))

export function commitPositions(positions: Record<string, Position>) {
  discrete(() =>
    store().mutate((d) => {
      for (const t of d.tables) if (positions[t.id]) t.position = positions[t.id]
      for (const n of d.notes) if (positions[n.id]) n.position = positions[n.id]
      for (const v of d.views) if (positions[v.id]) v.position = positions[v.id]
      for (const t of d.triggers) if (positions[t.id]) t.position = positions[t.id]
    }),
  )
}

export function addIndex(tableId: string) {
  discrete(() =>
    store().mutate((d) => {
      const t = d.tables.find((x) => x.id === tableId)
      if (!t) return
      const firstNonPk = t.columns.find((c) => !c.pk) ?? t.columns[0]
      t.indexes.push({
        id: uid('idx_'),
        name: nextName(`idx_${t.name}_`, t.indexes.map((i) => i.name)),
        columnIds: firstNonPk ? [firstNonPk.id] : [],
        unique: false,
      })
    }),
  )
}

export function updateIndex(tableId: string, indexId: string, patch: Partial<Omit<Index, 'id'>>) {
  store().mutate((d) => {
    const i = d.tables.find((x) => x.id === tableId)?.indexes.find((x) => x.id === indexId)
    if (i) Object.assign(i, patch)
  })
}

export function removeIndex(tableId: string, indexId: string) {
  discrete(() =>
    store().mutate((d) => {
      const t = d.tables.find((x) => x.id === tableId)
      if (t) t.indexes = t.indexes.filter((i) => i.id !== indexId)
    }),
  )
}

export function deleteSelection() {
  const { selection } = store()
  if (!selection) return
  discrete(() => {
    if (selection.kind === 'table') store().removeTable(selection.id)
    else if (selection.kind === 'relation') store().removeRelation(selection.id)
    else if (selection.kind === 'note') store().removeNote(selection.id)
    else if (selection.kind === 'view') store().removeView(selection.id)
    else if (selection.kind === 'trigger') store().removeTrigger(selection.id)
    else return
    store().setSelection(null)
  })
}

export function upsertEnumValues(id: string | null, name: string, values: string[]) {
  discrete(() =>
    store().mutate((d) => {
      const existing = id ? d.enums.find((e) => e.id === id) : undefined
      if (existing) Object.assign(existing, { name, values })
      else d.enums.push({ id: uid('enum_'), name, values })
    }),
  )
}

export const removeEnum = (id: string) => discrete(() => store().removeEnum(id))

export { discrete }
