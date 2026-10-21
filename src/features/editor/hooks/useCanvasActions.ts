import { useReactFlow, type FitViewOptions } from '@xyflow/react'
import { useCallback } from 'react'

import { toast } from 'sonner'

import { runOperation, type RunnableStep } from '@/components/operation-flow'
import { exportDiagramImage, type DiagramImageFormat } from '@/lib/exporters/image'
import { useProjectStore } from '@/store/project'
import type { Position } from '@/types/schema'

import { createNote, createTable, createView } from '../lib/actions'
import { FIT_PADDING, GRID_SIZE, NOTE_WIDTH, TABLE_WIDTH, TRIGGER_HEIGHT, TRIGGER_WIDTH, VIEW_WIDTH, snap, tableHeight, viewHeight } from '../lib/constants'
import { startEditing, stopEditing } from '../lib/editorStore'
import { batchHistory } from '../lib/history'
import { computeLayout } from '../lib/layout'
import type { FlowEdge, FlowNode } from '../lib/types'

const GAP = GRID_SIZE * 2

export const CANVAS_SELECTOR = '[data-editor-canvas]'

export function useCanvasActions() {
  const rf = useReactFlow<FlowNode, FlowEdge>()

  const freeSpotAtCenter = useCallback(
    (width: number, height: number): Position => {
      const rect = document.querySelector(CANVAS_SELECTOR)?.getBoundingClientRect()
      if (!rect) return { x: 80, y: 80 }
      const center = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      const { draft } = useProjectStore.getState()
      const boxes = [
        ...draft.tables.map((t) => ({ ...t.position, w: TABLE_WIDTH, h: tableHeight(t.columns.length) })),
        ...draft.notes.map((n) => ({ ...n.position, w: NOTE_WIDTH, h: 96 })),
        ...draft.views.map((v) => ({ ...v.position, w: VIEW_WIDTH, h: viewHeight(v.columns.length) })),
        ...draft.triggers.map((t) => ({ ...t.position, w: TRIGGER_WIDTH, h: TRIGGER_HEIGHT })),
      ]
      const overlaps = (p: Position) =>
        boxes.some((b) => p.x < b.x + b.w + GAP && p.x + width + GAP > b.x && p.y < b.y + b.h + GAP && p.y + height + GAP > b.y)
      const start = { x: snap(center.x - width / 2), y: snap(center.y - height / 2) }
      for (let ring = 0; ring < 12; ring++) {
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, 1], [1, -1], [-1, -1]]) {
          const p = { x: start.x + dx * ring * (width + GAP), y: start.y + dy * ring * (height + GAP) }
          const snapped = { x: snap(p.x), y: snap(p.y) }
          if (!overlaps(snapped)) return snapped
        }
      }
      return start
    },
    [rf],
  )

  const addTable = useCallback(() => createTable(freeSpotAtCenter(TABLE_WIDTH, tableHeight(1))), [freeSpotAtCenter])

  const addNote = useCallback(() => createNote(freeSpotAtCenter(NOTE_WIDTH, 96)), [freeSpotAtCenter])

  const addView = useCallback(() => {
    const view = createView(freeSpotAtCenter(VIEW_WIDTH, viewHeight(0)))
    startEditing({ kind: 'view-sql', id: view.id })
  }, [freeSpotAtCenter])

  const focusNode = useCallback(
    (id: string) => {
      const node = rf.getNode(id)
      if (!node) return
      const w = node.measured?.width ?? TABLE_WIDTH
      const h = node.measured?.height ?? 120
      rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 400 })
    },
    [rf],
  )

  const autoLayout = useCallback(async () => {
    const { draft } = useProjectStore.getState()
    if (!draft.tables.length && !draft.views.length) return
    let positions: Record<string, Position> = {}
    const place = (ids: string[]) => () => {
      useProjectStore.getState().mutate((d) => {
        for (const x of [...d.tables, ...d.views, ...d.triggers]) if (ids.includes(x.id) && positions[x.id]) x.position = positions[x.id]
      })
      return `${ids.length} colocad${ids.length === 1 ? 'o' : 'os'}`
    }
    const steps: RunnableStep[] = [
      {
        id: 'levels',
        label: 'Calcular niveles',
        kind: 'check',
        run: () => {
          positions = computeLayout(draft)
          const levels = new Set(draft.tables.map((t) => positions[t.id]?.x)).size
          return `${levels} nivel${levels === 1 ? '' : 'es'} de dependencia`
        },
      },
      { id: 'tables', label: 'Colocar tablas', kind: 'table', run: place(draft.tables.map((t) => t.id)) },
    ]
    if (draft.views.length) steps.push({ id: 'views', label: 'Colocar vistas', kind: 'view', run: place(draft.views.map((v) => v.id)) })
    if (draft.triggers.length)
      steps.push({ id: 'triggers', label: 'Colocar triggers', kind: 'trigger', run: place(draft.triggers.map((t) => t.id)) })
    steps.push({
      id: 'fit',
      label: 'Encuadrar',
      kind: 'check',
      run: async () => {
        await new Promise((r) => requestAnimationFrame(r))
        await rf.fitView({ padding: FIT_PADDING, duration: 300, maxZoom: 1 })
        return `${rf.getNodes().filter((n) => !n.hidden).length} nodos visibles`
      },
    })
    await batchHistory(() => runOperation('Orden automático', steps))
  }, [rf])

  const fitVisible = useCallback(
    (duration = 400, padding: FitViewOptions['padding'] = FIT_PADDING) => {
      const nodes = rf.getNodes().filter((n) => !n.hidden)
      return rf.fitView({ nodes: nodes.map((n) => ({ id: n.id })), padding, duration, maxZoom: 1.2 })
    },
    [rf],
  )

  const exportImage = useCallback(
    async (format: DiagramImageFormat) => {
      const canvas = document.querySelector<HTMLElement>(CANVAS_SELECTOR)
      const flow = canvas?.querySelector<HTMLElement>('.react-flow')
      if (!canvas || !flow || !rf.getNodes().some((n) => !n.hidden)) {
        toast.error('No hay nada visible que exportar')
        return
      }
      const { project, setSelection } = useProjectStore.getState()
      const viewport = rf.getViewport()
      const filename = `${project.name}-diagrama.${format}`
      let dataUrl = ''
      stopEditing()
      setSelection(null)
      try {
        const result = await runOperation(`Exportar imagen ${format.toUpperCase()}`, [
          {
            id: 'fit',
            label: 'Encuadrar',
            kind: 'check',
            run: async () => {
              canvas.dataset.exporting = 'true'
              await fitVisible(0, '32px')
              await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
              return `${rf.getNodes().filter((n) => !n.hidden).length} nodos según las capas activas`
            },
          },
          {
            id: 'capture',
            label: 'Capturar',
            kind: 'file',
            run: async () => {
              dataUrl = await exportDiagramImage(flow, format)
              return `${format.toUpperCase()} · ${Math.round((dataUrl.length * 0.75) / 1024)} KB`
            },
          },
          {
            id: 'download',
            label: 'Descargar',
            kind: 'file',
            run: () => {
              const a = document.createElement('a')
              a.href = dataUrl
              a.download = filename
              a.click()
              return filename
            },
          },
        ])
        if (!result.ok) toast.error('No se pudo exportar la imagen')
      } finally {
        delete canvas.dataset.exporting
        void rf.setViewport(viewport)
      }
    },
    [rf, fitVisible],
  )

  return { addTable, addNote, addView, focusNode, autoLayout, fitVisible, exportImage }
}
