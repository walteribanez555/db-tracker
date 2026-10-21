import { useReactFlow, type EdgeMouseHandler, type NodeMouseHandler } from '@xyflow/react'
import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router'

import { useActionMenuKeys, useActionMenuTrigger } from '@/components/flow/use-action-menu'
import { useProjectStore } from '@/store/project'

import { snap, TABLE_WIDTH } from '../lib/constants'
import { stopEditing, useEditorUi } from '../lib/editorStore'
import { buildMenu, type MenuContext } from '../lib/menu'
import type { FlowEdge, FlowNode, MenuTarget } from '../lib/types'
import { CANVAS_SELECTOR, useCanvasActions } from './useCanvasActions'

const targetFor = (node: FlowNode, columnId?: string): MenuTarget =>
  node.type === 'table' ? { kind: 'table', id: node.id, columnId } : { kind: node.type, id: node.id }

/** Menú de acciones del lienzo: Ctrl/Cmd + clic derecho sobre nodos, aristas o el fondo; Shift+F10 con teclado. */
export function useEditorMenu() {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  const navigate = useNavigate()
  const { autoLayout, fitVisible, exportImage } = useCanvasActions()
  const { menuProps, target, openAt, handleContextMenu, longPressHandlers } = useActionMenuTrigger<MenuTarget>()
  const setSelection = useProjectStore((s) => s.setSelection)
  const draft = useProjectStore((s) => s.draft)
  const clipboard = useEditorUi((s) => s.clipboard)

  const ctx = useMemo<MenuContext>(
    () => ({ navigate, autoLayout, fitView: () => void fitVisible(), exportImage: (f) => void exportImage(f) }),
    [navigate, autoLayout, fitVisible, exportImage],
  )

  const groups = useMemo(
    () => (menuProps.open ? buildMenu(target, ctx) : []),
    // `draft` y `clipboard` refrescan el menú abierto (casillas marcadas, Pegar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuProps.open, target, ctx, draft, clipboard],
  )

  const select = useCallback(
    (t: MenuTarget) => {
      stopEditing()
      if (t.kind === 'pane') setSelection(null)
      else setSelection({ kind: t.kind, id: t.id })
    },
    [setSelection],
  )

  const onNodeContextMenu: NodeMouseHandler<FlowNode> = useCallback(
    (event, node) => {
      const columnId = (event.target as HTMLElement).closest('[data-column-id]')?.getAttribute('data-column-id') ?? undefined
      const t = targetFor(node, columnId)
      if (handleContextMenu(event, t)) select(t)
    },
    [handleContextMenu, select],
  )

  const onEdgeContextMenu: EdgeMouseHandler<FlowEdge> = useCallback(
    (event, edge) => {
      if (edge.type !== 'relation') return void event.preventDefault()
      const t: MenuTarget = { kind: 'relation', id: edge.id }
      if (handleContextMenu(event, t)) select(t)
    },
    [handleContextMenu, select],
  )

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | ReactMouseEvent) => {
      const p = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const t: MenuTarget = { kind: 'pane', position: { x: snap(p.x), y: snap(p.y) } }
      if (handleContextMenu(event, t)) select(t)
    },
    [rf, handleContextMenu, select],
  )

  const resolveKeyboardAnchor = useCallback(() => {
    const { selection } = useProjectStore.getState()
    const toScreen = (x: number, y: number) => rf.flowToScreenPosition({ x, y })
    if (selection && selection.kind !== 'function') {
      if (selection.kind === 'relation') {
        const r = useProjectStore.getState().draft.relations.find((x) => x.id === selection.id)
        const s = r && rf.getNode(r.sourceTableId)
        const t = r && rf.getNode(r.targetTableId)
        if (!s || !t) return null
        const p = toScreen((s.position.x + t.position.x + TABLE_WIDTH) / 2, (s.position.y + t.position.y) / 2 + 40)
        return { ...p, target: { kind: 'relation', id: selection.id } as MenuTarget }
      }
      const node = rf.getNode(selection.id)
      if (!node) return null
      const p = toScreen(node.position.x + (node.measured?.width ?? TABLE_WIDTH) / 2, node.position.y + 24)
      return { ...p, target: targetFor(node) }
    }
    const rect = document.querySelector(CANVAS_SELECTOR)?.getBoundingClientRect()
    if (!rect) return null
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const flow = rf.screenToFlowPosition({ x, y })
    return { x, y, target: { kind: 'pane', position: { x: snap(flow.x), y: snap(flow.y) } } as MenuTarget }
  }, [rf])

  useActionMenuKeys(resolveKeyboardAnchor, openAt)

  /** Abre el menú de un objetivo concreto (botón «más acciones» o pulsación larga en la hoja móvil). */
  const openMenuFor = useCallback(
    (t: MenuTarget, x: number, y: number) => {
      select(t)
      openAt(x, y, t)
    },
    [select, openAt],
  )

  return { menuProps, groups, onNodeContextMenu, onEdgeContextMenu, onPaneContextMenu, openMenuFor, longPressHandlers }
}
