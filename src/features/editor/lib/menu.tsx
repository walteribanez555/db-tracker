import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Asterisk,
  ClipboardCopy,
  ClipboardPaste,
  Code,
  Copy,
  ExternalLink,
  Eye,
  ImageDown,
  KeyRound,
  Link2,
  Maximize,
  Network,
  Palette,
  Pencil,
  Plus,
  Power,
  PowerOff,
  ScanSearch,
  Sparkles,
  StickyNote,
  Table2,
  TextCursorInput,
  Trash,
  Type,
  Workflow,
  Zap,
} from 'lucide-react'

import type { ActionGroup, ActionItem } from '@/components/flow/action-menu'
import { analyzeSchema } from '@/features/normalization/lib/rules'
import { generateViewSQL } from '@/features/triggers/lib/sql'
import { TEMPLATES } from '@/features/triggers/lib/templates'
import { createTableSQL } from '@/lib/exporters/sql'
import { TABLE_COLORS, useProjectStore } from '@/store/project'
import type { Position, Schema, Table } from '@/types/schema'

import { createNote, createTable, createView, deleteSelection, discrete, moveColumnIn, removeColumnFrom, updateNote, updateView } from './actions'
import {
  addColumnInline,
  addEmptyTrigger,
  addTriggerFromTemplate,
  copySelection,
  clipboardSize,
  copyText,
  createViewFromTable,
  duplicateTable,
  pasteClipboard,
  updateColumnDiscrete,
  updateTrigger,
} from './canvasActions'
import { CARDINALITIES, NOTE_COLORS, REFERENTIAL_ACTIONS } from './constants'
import { startEditing, useEditorUi, type Clipboard } from './editorStore'
import { findColumn, orientRelation, relationLabel, swapRelation } from './relations'
import { compareTypes } from './sqlTypes'
import type { MenuTarget } from './types'
import { openTriggerFlow } from './triggerModal'
import { parseViewDefinition } from './viewParser'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'

export interface MenuContext {
  navigate: (path: string) => void
  autoLayout: () => void
  fitView: () => void
  exportImage: (format: 'png' | 'svg') => void
}

const store = () => useProjectStore.getState()
const select = (kind: 'table' | 'relation' | 'view' | 'trigger' | 'note', id: string) => store().setSelection({ kind, id })

const clipboardLabel = (c: Clipboard) =>
  c.tables.length === 1 && clipboardSize(c) === 1 ? c.tables[0].name : `${clipboardSize(c)} elementos`

const swatch = (color: string) => <span className="size-3.5 rounded-sm border border-foreground/15" style={{ background: color }} />

function colorSubmenu(colors: string[], current: string, apply: (color: string) => void): ActionGroup[] {
  return [
    {
      id: 'colors',
      items: colors.map((color) => ({ id: color, label: color, icon: swatch(color), checked: color === current, onSelect: () => apply(color) })),
    },
  ]
}

function tableGroups(draft: Schema, table: Table): ActionGroup[] {
  const findings = analyzeSchema(draft).filter((f) => f.tableId === table.id && !f.viewId).length
  return [
    {
      id: 'table',
      label: `Tabla ${table.name}`,
      items: [
        { id: 'rename', label: 'Renombrar', icon: Pencil, shortcut: 'F2', onSelect: () => startEditing({ kind: 'table-name', id: table.id }) },
        { id: 'add-column', label: 'Añadir columna', icon: Plus, onSelect: () => addColumnInline(table.id) },
        { id: 'duplicate', label: 'Duplicar', icon: Copy, shortcut: [MOD, 'D'], onSelect: () => duplicateTable(table.id) },
        {
          id: 'copy',
          label: 'Copiar',
          icon: ClipboardCopy,
          shortcut: [MOD, 'C'],
          onSelect: () => {
            select('table', table.id)
            copySelection()
          },
        },
        {
          id: 'color',
          label: 'Color',
          icon: Palette,
          submenu: colorSubmenu(TABLE_COLORS, table.color, (color) => discrete(() => store().updateTable(table.id, { color }))),
        },
      ],
    },
    {
      id: 'related',
      items: [
        { id: 'view', label: 'Crear vista desde esta tabla', icon: Eye, onSelect: () => void createViewFromTable(table.id) },
        {
          id: 'trigger',
          label: 'Añadir trigger',
          icon: Zap,
          submenu: [
            {
              id: 'templates',
              label: 'Plantillas',
              items: TEMPLATES.map((tpl) => {
                const reason = tpl.unavailable(draft, table.id)
                return {
                  id: tpl.id,
                  label: tpl.name,
                  disabled: reason !== null,
                  hint: reason ? 'no aplica' : undefined,
                  onSelect: () => void addTriggerFromTemplate(tpl.id, table.id),
                }
              }),
            },
            { id: 'empty', items: [{ id: 'empty', label: 'Trigger vacío', icon: Plus, onSelect: () => addEmptyTrigger(table.id) }] },
          ],
        },
        {
          id: 'normalization',
          label: 'Revisar normalización',
          icon: Sparkles,
          hint: findings ? `${findings} hallazgo${findings === 1 ? '' : 's'}` : 'sin hallazgos',
          onSelect: () => startEditing({ kind: 'normalization', id: table.id }),
        },
        {
          id: 'sql',
          label: 'Copiar SQL',
          icon: Code,
          hint: 'CREATE TABLE',
          onSelect: () => copyText(createTableSQL(draft, table, draft.dialect), `SQL de ${table.name} copiado`),
        },
      ],
    },
    {
      id: 'danger',
      items: [
        {
          id: 'delete',
          label: 'Eliminar tabla',
          icon: Trash,
          shortcut: 'Supr',
          destructive: true,
          onSelect: () => {
            select('table', table.id)
            deleteSelection()
          },
        },
      ],
    },
  ]
}

function relateSubmenu(draft: Schema, table: Table, columnId: string): ActionGroup[] {
  const column = table.columns.find((c) => c.id === columnId)!
  const items: ActionItem[] = draft.tables.map((other) => {
    const candidates = other.columns.filter(
      (c) => !(other.id === table.id && c.id === columnId) && (c.pk || c.unique || compareTypes(column.type, c.type) !== 'mismatch'),
    )
    return {
      id: other.id,
      label: other.name,
      icon: <span className="size-2 rounded-full" style={{ background: other.color }} />,
      disabled: candidates.length === 0,
      submenu: [
        {
          id: 'columns',
          items: candidates.map((c) => ({
            id: c.id,
            label: c.name,
            icon: c.pk ? KeyRound : undefined,
            hint: c.type,
            onSelect: () =>
              useEditorUi.getState().setPendingRelation(
                orientRelation(store().draft, { sourceTableId: table.id, sourceColumnId: columnId, targetTableId: other.id, targetColumnId: c.id }),
              ),
          })),
        },
      ],
    }
  })
  return [{ id: 'tables', label: 'Columnas compatibles', items }]
}

function columnGroups(draft: Schema, table: Table, columnId: string): ActionGroup[] {
  const index = table.columns.findIndex((c) => c.id === columnId)
  const column = table.columns[index]
  if (!column) return tableGroups(draft, table)
  const patch = (p: Parameters<typeof updateColumnDiscrete>[2]) => updateColumnDiscrete(table.id, column.id, p)
  return [
    {
      id: 'column',
      label: `Columna ${table.name}.${column.name}`,
      items: [
        {
          id: 'rename',
          label: 'Renombrar',
          icon: TextCursorInput,
          onSelect: () => startEditing({ kind: 'column-name', id: table.id, columnId: column.id }),
        },
        {
          id: 'type',
          label: 'Cambiar tipo',
          icon: Type,
          hint: column.type,
          onSelect: () => startEditing({ kind: 'column-type', id: table.id, columnId: column.id }),
        },
      ],
    },
    {
      id: 'flags',
      items: [
        {
          id: 'pk',
          label: 'Clave primaria',
          icon: KeyRound,
          checked: column.pk,
          onSelect: () => patch(column.pk ? { pk: false } : { pk: true, nullable: false }),
        },
        { id: 'nn', label: 'Not null', icon: Asterisk, checked: !column.nullable, onSelect: () => patch({ nullable: !column.nullable }) },
        { id: 'uq', label: 'Único', checked: column.unique, onSelect: () => patch({ unique: !column.unique }) },
      ],
    },
    {
      id: 'relate',
      items: [{ id: 'relate', label: 'Relacionar con…', icon: Link2, submenu: relateSubmenu(draft, table, column.id) }],
    },
    {
      id: 'move',
      items: [
        { id: 'up', label: 'Mover arriba', icon: ArrowUp, disabled: index === 0, onSelect: () => moveColumnIn(table.id, index, index - 1) },
        {
          id: 'down',
          label: 'Mover abajo',
          icon: ArrowDown,
          disabled: index === table.columns.length - 1,
          onSelect: () => moveColumnIn(table.id, index, index + 1),
        },
      ],
    },
    {
      id: 'table',
      items: [{ id: 'table', label: `Tabla ${table.name}`, icon: Table2, submenu: tableGroups(draft, table) }],
    },
    {
      id: 'danger',
      items: [{ id: 'delete', label: 'Eliminar columna', icon: Trash, destructive: true, onSelect: () => removeColumnFrom(table.id, column.id) }],
    },
  ]
}

function relationGroups(draft: Schema, id: string): ActionGroup[] {
  const relation = draft.relations.find((r) => r.id === id)
  if (!relation) return []
  const label = relationLabel(draft, relation)
  const patch = (p: Parameters<ReturnType<typeof store>['updateRelation']>[1]) => discrete(() => store().updateRelation(relation.id, p))
  const actionSubmenu = (key: 'onDelete' | 'onUpdate'): ActionGroup[] => [
    {
      id: key,
      items: REFERENTIAL_ACTIONS.map((a) => ({ id: a, label: a, checked: relation[key] === a, onSelect: () => patch({ [key]: a }) })),
    },
  ]
  return [
    {
      id: 'relation',
      label: `${label.source}.${label.sourceColumn} → ${label.target}.${label.targetColumn}`,
      items: [
        {
          id: 'cardinality',
          label: 'Cardinalidad',
          hint: relation.cardinality,
          submenu: [
            { id: 'c', items: CARDINALITIES.map((c) => ({ id: c, label: c, checked: relation.cardinality === c, onSelect: () => patch({ cardinality: c }) })) },
          ],
        },
        { id: 'on-delete', label: 'ON DELETE', hint: relation.onDelete, submenu: actionSubmenu('onDelete') },
        { id: 'on-update', label: 'ON UPDATE', hint: relation.onUpdate, submenu: actionSubmenu('onUpdate') },
        { id: 'swap', label: 'Invertir sentido', icon: ArrowLeftRight, onSelect: () => patch(swapRelation(relation)) },
      ],
    },
    {
      id: 'danger',
      items: [
        {
          id: 'delete',
          label: 'Eliminar relación',
          icon: Trash,
          shortcut: 'Supr',
          destructive: true,
          onSelect: () => {
            select('relation', relation.id)
            deleteSelection()
          },
        },
      ],
    },
  ]
}

function viewGroups(draft: Schema, id: string): ActionGroup[] {
  const view = draft.views.find((v) => v.id === id)
  if (!view) return []
  return [
    {
      id: 'view',
      label: `Vista ${view.name}`,
      items: [
        { id: 'edit', label: 'Editar SQL', icon: Pencil, shortcut: 'Enter', onSelect: () => startEditing({ kind: 'view-sql', id: view.id }) },
        {
          id: 'materialized',
          label: 'Materializada',
          checked: view.materialized,
          onSelect: () => discrete(() => updateView(view.id, { materialized: !view.materialized })),
        },
        {
          id: 'detect',
          label: 'Detectar columnas y orígenes',
          icon: ScanSearch,
          disabled: !view.definition.trim(),
          onSelect: () => {
            const parsed = parseViewDefinition(view.definition, store().draft, view.id)
            discrete(() => updateView(view.id, { sourceIds: parsed.sourceIds, columns: parsed.columns }))
          },
        },
        {
          id: 'sql',
          label: 'Copiar SQL',
          icon: Code,
          disabled: !view.definition.trim(),
          onSelect: () => copyText(generateViewSQL(view, draft.dialect), `SQL de ${view.name} copiado`),
        },
      ],
    },
    {
      id: 'danger',
      items: [
        {
          id: 'delete',
          label: 'Eliminar vista',
          icon: Trash,
          shortcut: 'Supr',
          destructive: true,
          onSelect: () => {
            select('view', view.id)
            deleteSelection()
          },
        },
      ],
    },
  ]
}

function triggerGroups(draft: Schema, id: string, ctx: MenuContext): ActionGroup[] {
  const trigger = draft.triggers.find((t) => t.id === id)
  if (!trigger) return []
  return [
    {
      id: 'trigger',
      label: `Trigger ${trigger.name}`,
      items: [
        { id: 'flow', label: 'Abrir flujo', icon: Workflow, shortcut: 'Enter', onSelect: () => openTriggerFlow(trigger.id) },
        { id: 'quick', label: 'Edición rápida', icon: Pencil, onSelect: () => startEditing({ kind: 'trigger', id: trigger.id }) },
        { id: 'sql', label: 'Ver SQL', icon: Code, onSelect: () => startEditing({ kind: 'trigger-sql', id: trigger.id }) },
        {
          id: 'toggle',
          label: trigger.enabled === false ? 'Activar en la BD' : 'Desactivar en la BD',
          icon: trigger.enabled === false ? Power : PowerOff,
          hint: trigger.enabled === false ? 'desactivado' : undefined,
          onSelect: () => discrete(() => updateTrigger(trigger.id, { enabled: trigger.enabled === false ? undefined : false })),
        },
        { id: 'open', label: 'Abrir en Triggers', icon: ExternalLink, onSelect: () => ctx.navigate('/triggers') },
      ],
    },
    {
      id: 'danger',
      items: [
        {
          id: 'delete',
          label: 'Eliminar trigger',
          icon: Trash,
          shortcut: 'Supr',
          destructive: true,
          onSelect: () => {
            select('trigger', trigger.id)
            deleteSelection()
          },
        },
      ],
    },
  ]
}

function noteGroups(draft: Schema, id: string): ActionGroup[] {
  const note = draft.notes.find((n) => n.id === id)
  if (!note) return []
  return [
    {
      id: 'note',
      label: 'Nota',
      items: [
        { id: 'edit', label: 'Editar texto', icon: Pencil, shortcut: 'Enter', onSelect: () => startEditing({ kind: 'note', id: note.id }) },
        {
          id: 'color',
          label: 'Color',
          icon: Palette,
          submenu: colorSubmenu(NOTE_COLORS, note.color, (color) => discrete(() => updateNote(note.id, { color }))),
        },
        {
          id: 'copy',
          label: 'Copiar',
          icon: ClipboardCopy,
          shortcut: [MOD, 'C'],
          onSelect: () => {
            select('note', note.id)
            copySelection()
          },
        },
      ],
    },
    {
      id: 'danger',
      items: [
        {
          id: 'delete',
          label: 'Eliminar nota',
          icon: Trash,
          shortcut: 'Supr',
          destructive: true,
          onSelect: () => {
            select('note', note.id)
            deleteSelection()
          },
        },
      ],
    },
  ]
}

function paneGroups(position: Position, ctx: MenuContext): ActionGroup[] {
  const clipboard = useEditorUi.getState().clipboard
  return [
    {
      id: 'create',
      label: 'Lienzo',
      items: [
        { id: 'table', label: 'Nueva tabla aquí', icon: Table2, shortcut: 'T', onSelect: () => createTable(position) },
        { id: 'view', label: 'Nueva vista aquí', icon: Eye, onSelect: () => startEditing({ kind: 'view-sql', id: createView(position).id }) },
        { id: 'note', label: 'Nota aquí', icon: StickyNote, shortcut: 'N', onSelect: () => startEditing({ kind: 'note', id: createNote(position).id }) },
        {
          id: 'paste',
          label: 'Pegar',
          icon: ClipboardPaste,
          shortcut: [MOD, 'V'],
          disabled: clipboardSize(clipboard) === 0,
          hint: clipboard ? clipboardLabel(clipboard) : undefined,
          onSelect: () => void pasteClipboard(position),
        },
      ],
    },
    {
      id: 'view',
      items: [
        { id: 'layout', label: 'Orden automático', icon: Network, onSelect: ctx.autoLayout },
        { id: 'fit', label: 'Ajustar vista', icon: Maximize, onSelect: ctx.fitView },
        {
          id: 'export',
          label: 'Exportar imagen',
          icon: ImageDown,
          submenu: [
            {
              id: 'formats',
              items: [
                { id: 'png', label: 'PNG', onSelect: () => ctx.exportImage('png') },
                { id: 'svg', label: 'SVG', onSelect: () => ctx.exportImage('svg') },
              ],
            },
          ],
        },
      ],
    },
  ]
}

export function buildMenu(target: MenuTarget | null, ctx: MenuContext): ActionGroup[] {
  if (!target) return []
  const { draft } = store()
  switch (target.kind) {
    case 'table': {
      const found = target.columnId ? findColumn(draft, target.id, target.columnId) : null
      const table = draft.tables.find((t) => t.id === target.id)
      if (!table) return []
      return found ? columnGroups(draft, table, found.column.id) : tableGroups(draft, table)
    }
    case 'relation':
      return relationGroups(draft, target.id)
    case 'view':
      return viewGroups(draft, target.id)
    case 'trigger':
      return triggerGroups(draft, target.id, ctx)
    case 'note':
      return noteGroups(draft, target.id)
    case 'pane':
      return paneGroups(target.position, ctx)
  }
}
