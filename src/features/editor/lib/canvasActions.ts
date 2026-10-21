import { toast } from 'sonner'

import { runOperation, type RunnableStep } from '@/components/operation-flow'
import { applyFix } from '@/features/normalization/lib/rules'
import type { FixPlan } from '@/features/normalization/lib/types'
import { newFunction, newTrigger, TEMPLATES, type TemplateId } from '@/features/triggers/lib/templates'
import { uid } from '@/lib/id'
import { useProjectStore } from '@/store/project'
import type { Column, Position, Table, Trigger, View } from '@/types/schema'

import { addColumnTo, discrete, nextName, updateView } from './actions'
import { GRID_SIZE, TABLE_WIDTH, TRIGGER_HEIGHT, VIEW_COLOR, snap } from './constants'
import { startEditing, useEditorUi, type Clipboard } from './editorStore'
import { batchHistory } from './history'
import { runSchemaTransition } from './transition'
import { parseViewDefinition } from './viewParser'

const store = () => useProjectStore.getState()
const OFFSET = GRID_SIZE * 2

export function updateTrigger(id: string, patch: Partial<Omit<Trigger, 'id'>>) {
  store().mutate((d) => {
    const t = d.triggers.find((x) => x.id === id)
    if (t) Object.assign(t, patch)
  })
}

export function updateColumnDiscrete(tableId: string, columnId: string, patch: Partial<Column>) {
  discrete(() => store().updateColumn(tableId, columnId, patch))
}

const uniqueTableName = (base: string, taken: string[]) => (taken.includes(base) ? nextName(`${base}_`, taken) : base)

const cloneTable = (table: Table, name: string, position: Position): Table => {
  const ids = new Map(table.columns.map((c) => [c.id, uid('col_')]))
  return {
    ...structuredClone(table),
    id: uid('tbl_'),
    name,
    position,
    columns: table.columns.map((c) => ({ ...c, id: ids.get(c.id)! })),
    indexes: table.indexes.map((i) => ({
      ...i,
      id: uid('idx_'),
      name: `${i.name}_copia`,
      columnIds: i.columnIds.map((c) => ids.get(c) ?? c),
    })),
  }
}

export function duplicateTable(id: string) {
  const table = store().draft.tables.find((t) => t.id === id)
  if (!table) return
  discrete(() => {
    const copy = cloneTable(
      table,
      uniqueTableName(`${table.name}_copia`, store().draft.tables.map((t) => t.name)),
      { x: table.position.x + OFFSET, y: table.position.y + OFFSET },
    )
    store().mutate((d) => void d.tables.push(copy))
    store().setSelection({ kind: 'table', id: copy.id })
  })
}

/** Copia la selección: una tabla viaja con sus triggers; una nota sola. */
export function copySelection(): boolean {
  const { draft, selection } = store()
  let clip: Clipboard | null = null
  if (selection?.kind === 'table') {
    const table = draft.tables.find((t) => t.id === selection.id)
    if (table) clip = { tables: [table], triggers: draft.triggers.filter((t) => t.tableId === table.id), notes: [] }
  } else if (selection?.kind === 'note') {
    const note = draft.notes.find((n) => n.id === selection.id)
    if (note) clip = { tables: [], triggers: [], notes: [note] }
  }
  if (clip) useEditorUi.getState().setClipboard(structuredClone(clip))
  return clip !== null
}

export const clipboardSize = (c: Clipboard | null) => (c ? c.tables.length + c.triggers.length + c.notes.length : 0)

/** Pega el portapapeles; con varios elementos se muestra como operación paso a paso. */
export async function pasteClipboard(position?: Position) {
  const clip = useEditorUi.getState().clipboard
  if (!clip || clipboardSize(clip) === 0) return
  const anchor = clip.tables[0]?.position ?? clip.notes[0]?.position ?? { x: 0, y: 0 }
  const delta = position ? { x: position.x - anchor.x, y: position.y - anchor.y } : { x: OFFSET, y: OFFSET }
  const shift = (p: Position) => ({ x: p.x + delta.x, y: p.y + delta.y })
  const tableIds = new Map<string, string>()
  let lastSelected: { kind: 'table' | 'note'; id: string } | null = null

  const steps: RunnableStep[] = [
    ...clip.tables.map((t) => ({
      id: `paste-${t.id}`,
      label: 'Pegar tabla',
      kind: 'table' as const,
      run: () => {
        const name = uniqueTableName(`${t.name}_copia`, store().draft.tables.map((x) => x.name))
        const copy = cloneTable(t, name, shift(t.position))
        tableIds.set(t.id, copy.id)
        store().mutate((d) => void d.tables.push(copy))
        lastSelected = { kind: 'table', id: copy.id }
        return `${name} · ${copy.columns.length} columnas`
      },
    })),
    ...clip.triggers.map((tr) => ({
      id: `paste-${tr.id}`,
      label: 'Pegar trigger',
      kind: 'trigger' as const,
      run: () => {
        const tableId = tableIds.get(tr.tableId)
        if (!tableId) throw new Error(`Falta la tabla de ${tr.name}`)
        const name = nextName(`${tr.name}_`, store().draft.triggers.map((x) => x.name))
        store().mutate((d) => void d.triggers.push({ ...structuredClone(tr), id: uid('trg_'), name, tableId, position: shift(tr.position) }))
        return `${name} → ${store().draft.functions.find((f) => f.id === tr.functionId)?.name ?? '¿función?'}()`
      },
    })),
    ...clip.notes.map((n) => ({
      id: `paste-${n.id}`,
      label: 'Pegar nota',
      kind: 'file' as const,
      run: () => {
        const id = uid('note_')
        store().mutate((d) => void d.notes.push({ ...structuredClone(n), id, position: shift(n.position) }))
        lastSelected = { kind: 'note', id }
        return n.text.split('\n')[0].slice(0, 40)
      },
    })),
  ]

  const select = () => {
    if (lastSelected) store().setSelection(lastSelected)
  }
  if (steps.length === 1) {
    discrete(() => steps[0].run?.())
    select()
    return
  }
  await batchHistory(() => runOperation(`Pegar ${steps.length} elementos`, steps))
  select()
}

/** Añade una columna y deja su nombre en edición (Enter añade otra, Esc sale). */
export function addColumnInline(tableId: string) {
  const column = addColumnTo(tableId)
  if (column) startEditing({ kind: 'column-name', id: tableId, columnId: column.id, chain: true })
}

export async function createViewFromTable(tableId: string) {
  const table = store().draft.tables.find((t) => t.id === tableId)
  if (!table) return
  const alias = table.name[0]?.toLowerCase() ?? 't'
  const definition = `SELECT ${table.columns.map((c) => `${alias}.${c.name}`).join(', ') || '*'}\nFROM ${table.name} ${alias}`
  const view: View = {
    id: uid('view_'),
    name: nextName(`v_${table.name}_`, store().draft.views.map((v) => v.name)),
    definition,
    materialized: false,
    sourceIds: [],
    columns: [],
    color: VIEW_COLOR,
    position: { x: snap(table.position.x + TABLE_WIDTH + 96), y: table.position.y },
  }

  const result = await batchHistory(() =>
    runOperation(`Vista desde ${table.name}`, [
      { id: 'sql', label: 'Generar SELECT', kind: 'sql', run: () => `${table.columns.length} columnas de ${table.name}` },
      {
        id: 'create',
        label: 'Crear vista',
        kind: 'view',
        run: () => {
          store().mutate((d) => void d.views.push(view))
          store().setSelection({ kind: 'view', id: view.id })
          return view.name
        },
      },
      {
        id: 'detect',
        label: 'Detectar columnas y orígenes',
        kind: 'column',
        run: () => {
          const parsed = parseViewDefinition(definition, store().draft, view.id)
          updateView(view.id, { sourceIds: parsed.sourceIds, columns: parsed.columns })
          return `${parsed.columns.length} columnas · origen ${table.name}`
        },
      },
    ]),
  )
  if (result.ok) startEditing({ kind: 'view-sql', id: view.id })
}

const triggerSpot = (tableId: string): Position => {
  const { draft } = store()
  const table = draft.tables.find((t) => t.id === tableId)
  const count = draft.triggers.filter((t) => t.tableId === tableId).length
  if (!table) return { x: 0, y: 0 }
  return { x: snap(table.position.x + TABLE_WIDTH + 64), y: snap(table.position.y + count * (TRIGGER_HEIGHT + GRID_SIZE)) }
}

export async function addTriggerFromTemplate(templateId: TemplateId, tableId: string) {
  const tpl = TEMPLATES.find((t) => t.id === templateId)
  if (!tpl) return
  const { draft } = store()
  const reason = tpl.unavailable(draft, tableId)
  if (reason) {
    toast.error(reason)
    return
  }
  const spot = triggerSpot(tableId)
  const result = tpl.apply(draft, tableId, spot)
  const trigger = result.schema.triggers.find((t) => t.id === result.triggerId)
  if (trigger) trigger.position = spot
  const table = draft.tables.find((t) => t.id === tableId)
  const run = await runSchemaTransition(`${tpl.name} en ${table?.name ?? 'tabla'}`, result.schema)
  if (run.ok) {
    store().setSelection({ kind: 'trigger', id: result.triggerId })
    toast.success(result.message)
  }
}

export function addEmptyTrigger(tableId: string) {
  discrete(() => {
    const { draft } = store()
    const spot = triggerSpot(tableId)
    const fn = newFunction(draft, { x: spot.x + 320, y: spot.y })
    store().upsertFunction(fn)
    const trigger = newTrigger(store().draft, tableId, fn.id, spot)
    store().upsertTrigger(trigger)
    store().setSelection({ kind: 'trigger', id: trigger.id })
    startEditing({ kind: 'trigger', id: trigger.id })
  })
}

export async function applyNormalizationFix(fix: FixPlan, description: string) {
  const result = await runSchemaTransition(`Corrección: ${description}`, applyFix(store().draft, fix))
  if (result.ok) toast.success(`Aplicado: ${description}`)
  else toast.error('No se pudo aplicar la corrección')
}

export async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.error('No se pudo copiar al portapapeles')
  }
}
