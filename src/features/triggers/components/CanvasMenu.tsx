// Menú de acciones del lienzo de triggers (Ctrl/Cmd + clic derecho, o Mayús+F10 sobre la selección).
import { useReactFlow, type Edge, type Node } from '@xyflow/react'
import {
  Code,
  Copy,
  CopyPlus,
  Eye,
  LayoutGrid,
  Link2Off,
  ListTree,
  Pencil,
  Power,
  Play,
  Plus,
  RefreshCw,
  SquareFunction,
  Table2,
  Timer,
  Trash2,
  Wand2,
  Workflow,
  Zap,
} from 'lucide-react'
import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react'

import { ActionMenu, type ActionGroup, type ActionItem } from '@/components/flow/action-menu'
import { useActionMenuKeys, useActionMenuTrigger } from '@/components/flow/use-action-menu'
import { useProjectStore } from '@/store/project'
import type { Schema, TriggerTiming } from '@/types/schema'

import {
  addFunction,
  addTrigger,
  addTriggerForFunction,
  applyTemplate,
  arrangeCanvas,
  copyFunctionSQL,
  copyTriggerSQL,
  copyViewSQL,
  deleteEdgeLink,
  deleteFunction,
  deleteTrigger,
  deleteView,
  duplicateTrigger,
  setTriggerTiming,
  toggleTriggerEnabled,
  toggleMaterialized,
} from '../actions'
import { TIMINGS } from '../lib/constants'
import { relationName, type DmlEvent } from '../lib/graph'
import { TEMPLATES } from '../lib/templates'
import { useCanvasUi, useSimStore } from '../store'

export type MenuTarget =
  | { kind: 'table' | 'view' | 'trigger' | 'function'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'pane'; x: number; y: number }

const NODE_KIND = { t: 'table', v: 'view', g: 'trigger', f: 'function' } as const

export const nodeTarget = (n: Pick<Node, 'id'>): MenuTarget => ({ kind: NODE_KIND[n.id[0] as keyof typeof NODE_KIND], id: n.id.slice(2) })

const EVENTS: DmlEvent[] = ['INSERT', 'UPDATE', 'DELETE']

interface Ctx {
  draft: Schema
  disabled: string[]
  onSimulate: () => void
  focusNode: (nodeId: string) => void
  toFlow: (x: number, y: number) => { x: number; y: number }
}

function simulate(relId: string, ev: DmlEvent, onSimulate: () => void) {
  const sim = useSimStore.getState()
  sim.setTarget(relId, ev)
  sim.setCurrent(0)
  sim.setPlaying(true)
  onSimulate()
}

function templateItems(draft: Schema, tableId: string | undefined): ActionItem[] {
  return TEMPLATES.map((t) => {
    const reason = tableId ? t.unavailable(draft, tableId) : null
    return {
      id: `tpl-${t.id}`,
      label: t.name,
      icon: Wand2,
      disabled: !!reason,
      hint: reason ?? undefined,
      onSelect: () => (tableId ? applyTemplate(t.id, tableId) : useCanvasUi.getState().setTemplate({ id: t.id })),
    }
  })
}

function buildGroups(target: MenuTarget, ctx: Ctx): ActionGroup[] {
  const { draft } = ctx
  const ui = useCanvasUi.getState()
  const st = useProjectStore.getState()

  if (target.kind === 'pane') {
    const at = ctx.toFlow(target.x, target.y)
    return [
      {
        id: 'create',
        label: 'Lienzo',
        items: [
          { id: 'new-trigger', label: 'Trigger aquí', icon: Zap, disabled: !draft.tables.length, onSelect: () => addTrigger(undefined, at) },
          { id: 'new-fn', label: 'Función aquí', icon: SquareFunction, onSelect: () => addFunction(at) },
          { id: 'tpls', label: 'Plantillas', icon: Wand2, submenu: [{ id: 'tpl', items: templateItems(draft, undefined) }] },
        ],
      },
      { id: 'layout', items: [{ id: 'arrange', label: 'Ordenar en columnas', icon: LayoutGrid, onSelect: arrangeCanvas }] },
    ]
  }

  if (target.kind === 'edge') {
    const [, kind, a] = target.id.split(':')
    const trg = draft.triggers.find((t) => t.id === a)
    const groups: ActionGroup[] = []
    if (kind === 'exec' && trg)
      groups.push({
        id: 'change',
        label: `${trg.name} ejecuta`,
        items: [
          {
            id: 'change-fn',
            label: 'Cambiar función',
            icon: SquareFunction,
            submenu: [
              {
                id: 'fns',
                items: draft.functions.map((f) => ({
                  id: f.id,
                  label: `${f.name}()`,
                  checked: f.id === trg.functionId,
                  onSelect: () => st.upsertTrigger({ ...trg, functionId: f.id }),
                })),
              },
            ],
          },
        ],
      })
    if (kind === 'fires' && trg)
      groups.push({
        id: 'change',
        label: `${relationName(draft, trg.tableId)} dispara ${trg.name}`,
        items: [
          {
            id: 'change-table',
            label: 'Mover a otra tabla',
            icon: Table2,
            submenu: [
              {
                id: 'tables',
                items: draft.tables.map((t) => ({
                  id: t.id,
                  label: t.name,
                  checked: t.id === trg.tableId,
                  onSelect: () => st.upsertTrigger({ ...trg, tableId: t.id }),
                })),
              },
            ],
          },
        ],
      })
    const hint =
      kind === 'fires' || kind === 'exec'
        ? 'borra el trigger'
        : kind === 'feeds'
          ? 'quita el origen de la vista'
          : `comenta la sentencia en ${draft.functions.find((f) => f.id === a)?.name ?? 'la función'}`
    groups.push({
      id: 'del',
      items: [{ id: 'unlink', label: 'Eliminar vínculo', icon: Link2Off, destructive: true, hint, onSelect: () => deleteEdgeLink(target.id) }],
    })
    return groups
  }

  if (target.kind === 'table') {
    const t = draft.tables.find((x) => x.id === target.id)
    if (!t) return []
    const triggers = draft.triggers.filter((x) => x.tableId === t.id)
    return [
      {
        id: 'create',
        label: t.name,
        items: [
          {
            id: 'add',
            label: 'Añadir trigger',
            icon: Plus,
            submenu: [
              { id: 'blank', items: [{ id: 'blank', label: 'Trigger vacío', icon: Zap, onSelect: () => addTrigger(t.id) }] },
              { id: 'tpl', label: 'Plantillas', items: templateItems(draft, t.id) },
            ],
          },
          {
            id: 'sim',
            label: 'Simular desde aquí',
            icon: Play,
            submenu: [{ id: 'ev', items: EVENTS.map((ev) => ({ id: ev, label: `${ev} en ${t.name}`, onSelect: () => simulate(t.id, ev, ctx.onSimulate) })) }],
          },
          {
            id: 'list',
            label: 'Ver triggers de esta tabla',
            icon: ListTree,
            disabled: !triggers.length,
            hint: triggers.length ? String(triggers.length) : 'ninguno',
            submenu: triggers.length
              ? [
                  {
                    id: 'trgs',
                    items: triggers.map((x) => ({
                      id: x.id,
                      label: x.name,
                      hint: `${x.timing} ${x.events.join(', ')}`,
                      onSelect: () => {
                        st.setSelection({ kind: 'trigger', id: x.id })
                        ctx.focusNode(`g:${x.id}`)
                      },
                    })),
                  },
                ]
              : undefined,
          },
        ],
      },
    ]
  }

  if (target.kind === 'trigger') {
    const t = draft.triggers.find((x) => x.id === target.id)
    if (!t) return []
    const active = !ctx.disabled.includes(t.id)
    return [
      {
        id: 'edit',
        label: t.name,
        items: [
          { id: 'flow', label: 'Ver flujo y simular', icon: Workflow, hint: 'clic', onSelect: () => ui.openFlowModal(t.id, 'simular') },
          { id: 'edit', label: 'Editar', icon: Pencil, onSelect: () => ui.openFlowModal(t.id, 'detalles') },
          {
            id: 'db-enabled',
            label: t.enabled === false ? 'Activar en la BD' : 'Desactivar en la BD',
            icon: Power,
            hint: t.enabled === false ? 'ahora desactivado' : undefined,
            onSelect: () => toggleTriggerEnabled(t.id),
          },
          {
            id: 'active',
            label: 'Activo en la simulación',
            checked: active && t.enabled !== false,
            disabled: t.enabled === false,
            hint: t.enabled === false ? 'desactivado en la BD' : undefined,
            onSelect: () => ui.toggleTrigger(t.id),
          },
          {
            id: 'timing',
            label: 'Cambiar momento',
            icon: Timer,
            hint: t.timing,
            submenu: [
              {
                id: 'timings',
                items: TIMINGS.map((tm: TriggerTiming) => ({ id: tm, label: tm, checked: tm === t.timing, onSelect: () => setTriggerTiming(t.id, tm) })),
              },
            ],
          },
          { id: 'dup', label: 'Duplicar', icon: CopyPlus, onSelect: () => duplicateTrigger(t.id) },
        ],
      },
      {
        id: 'sql',
        items: [
          {
            id: 'see-sql',
            label: 'Ver SQL',
            icon: Code,
            onSelect: () => ui.openFlowModal(t.id, 'sql'),
          },
          { id: 'copy-sql', label: 'Copiar SQL', icon: Copy, onSelect: () => copyTriggerSQL(t.id) },
        ],
      },
      { id: 'del', items: [{ id: 'del', label: 'Eliminar trigger', icon: Trash2, destructive: true, onSelect: () => deleteTrigger(t.id) }] },
    ]
  }

  if (target.kind === 'function') {
    const f = draft.functions.find((x) => x.id === target.id)
    if (!f) return []
    const users = draft.triggers.filter((t) => t.functionId === f.id)
    return [
      {
        id: 'edit',
        label: `${f.name}()`,
        items: [
          { id: 'edit', label: 'Editar cuerpo', icon: Pencil, hint: 'doble clic', onSelect: () => ui.setEditing({ kind: 'function', id: f.id }) },
          { id: 'new-trg', label: 'Crear trigger que la use', icon: Zap, disabled: !draft.tables.length, onSelect: () => addTriggerForFunction(f.id) },
          { id: 'copy-sql', label: 'Copiar SQL', icon: Copy, onSelect: () => copyFunctionSQL(f.id) },
        ],
      },
      {
        id: 'del',
        items: [
          {
            id: 'del',
            label: users.length ? `Eliminar con ${users.length} trigger${users.length > 1 ? 's' : ''}` : 'Eliminar función',
            hint: users.length ? users.map((u) => u.name).join(', ') : undefined,
            icon: Trash2,
            destructive: true,
            onSelect: () => deleteFunction(f.id),
          },
        ],
      },
    ]
  }

  // Vista
  const v = (draft.views ?? []).find((x) => x.id === target.id)
  if (!v) return []
  const sourceTables = draft.tables.filter((t) => v.sourceIds.includes(t.id))
  return [
    {
      id: 'edit',
      label: v.name,
      items: [
        { id: 'edit', label: 'Editar SQL', icon: Pencil, hint: 'doble clic', onSelect: () => ui.setEditing({ kind: 'view', id: v.id }) },
        { id: 'mat', label: 'Materializada', icon: Eye, checked: v.materialized, onSelect: () => toggleMaterialized(v.id) },
        {
          id: 'refresh',
          label: 'Añadir plantilla de refresco',
          icon: RefreshCw,
          disabled: !v.materialized || !sourceTables.length,
          hint: !v.materialized ? 'solo materializadas' : !sourceTables.length ? 'sin tablas de origen' : undefined,
          submenu:
            v.materialized && sourceTables.length
              ? [
                  {
                    id: 'src',
                    label: 'Refrescar tras cambios en',
                    items: sourceTables.map((t) => ({ id: t.id, label: t.name, icon: Table2, onSelect: () => applyTemplate('refrescar-vista', t.id) })),
                  },
                ]
              : undefined,
        },
        { id: 'copy-sql', label: 'Copiar SQL', icon: Copy, onSelect: () => copyViewSQL(v.id) },
      ],
    },
    { id: 'del', items: [{ id: 'del', label: 'Eliminar vista', icon: Trash2, destructive: true, onSelect: () => deleteView(v.id) }] },
  ]
}

/** Estado, manejadores y elemento del menú de acciones del lienzo. */
export function useCanvasMenu(onSimulate: () => void) {
  const menu = useActionMenuTrigger<MenuTarget>()
  const draft = useProjectStore((s) => s.draft)
  const disabled = useCanvasUi((s) => s.disabledTriggers)
  const { screenToFlowPosition, fitView } = useReactFlow()

  const focusNode = useCallback((nodeId: string) => void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.2 }), [fitView])

  // Teclado: Mayús+F10 abre el menú del elemento seleccionado (o del lienzo si no hay selección).
  const { openAt } = menu
  useActionMenuKeys<MenuTarget>(() => {
    const sel = useProjectStore.getState().selection
    const pane = document.querySelector('.triggers-canvas')?.getBoundingClientRect()
    if (!pane) return null
    if (sel && ['table', 'view', 'trigger', 'function'].includes(sel.kind)) {
      const prefix = { table: 't', view: 'v', trigger: 'g', function: 'f' }[sel.kind as 'table']
      const el = document.querySelector(`.triggers-canvas .react-flow__node[data-id="${prefix}:${sel.id}"]`)?.getBoundingClientRect()
      if (el) return { x: el.left + 12, y: el.bottom, target: { kind: sel.kind as 'table', id: sel.id } }
    }
    const x = pane.left + pane.width / 2
    const y = pane.top + pane.height / 2
    return { x, y, target: { kind: 'pane', x, y } }
  }, openAt)

  const groups = useMemo(
    () =>
      menu.target && menu.state.open
        ? buildGroups(menu.target, { draft, disabled, onSimulate, focusNode, toFlow: (x, y) => screenToFlowPosition({ x, y }) })
        : [],
    [menu.target, menu.state.open, draft, disabled, onSimulate, focusNode, screenToFlowPosition],
  )

  const { handleContextMenu } = menu
  const handlers = {
    onNodeContextMenu: useCallback((e: ReactMouseEvent, n: Node) => void handleContextMenu(e, nodeTarget(n)), [handleContextMenu]),
    onEdgeContextMenu: useCallback((e: ReactMouseEvent, edge: Edge) => void handleContextMenu(e, { kind: 'edge', id: edge.id }), [handleContextMenu]),
    onPaneContextMenu: useCallback(
      (e: MouseEvent | ReactMouseEvent) => void handleContextMenu(e, { kind: 'pane', x: e.clientX, y: e.clientY }),
      [handleContextMenu],
    ),
  }

  return { handlers, longPressHandlers: menu.longPressHandlers, element: <ActionMenu {...menu.menuProps} groups={groups} /> }
}
