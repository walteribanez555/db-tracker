// Estado local de la vista de triggers (no forma parte del esquema versionado).
import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { useProjectStore } from '@/store/project'
import type { Position } from '@/types/schema'

import { simulate, type DmlEvent } from './lib/graph'
import type { TemplateId } from './lib/templates'

interface LayoutState {
  /** Posición de cada tabla en este lienzo (independiente del diagrama ER). */
  tablePositions: Record<string, Position>
  onlyInvolved: boolean
  sqlOpen: boolean
  setTablePositions: (p: Record<string, Position>) => void
  setOnlyInvolved: (v: boolean) => void
  setSqlOpen: (v: boolean) => void
}

export const useTriggerLayout = create<LayoutState>()(
  persist(
    (set) => ({
      tablePositions: {},
      onlyInvolved: false,
      sqlOpen: true,
      setTablePositions: (p) => set((s) => ({ tablePositions: { ...s.tablePositions, ...p } })),
      setOnlyInvolved: (onlyInvolved) => set({ onlyInvolved }),
      setSqlOpen: (sqlOpen) => set({ sqlOpen }),
    }),
    { name: 'db-tracker:triggers-layout' },
  ),
)

interface SimState {
  tableId: string | null
  event: DmlEvent
  /** Paso actual (índice 0-based) o -1 si la simulación no está en curso. */
  current: number
  playing: boolean
  setTarget: (tableId: string | null, event?: DmlEvent) => void
  setCurrent: (n: number) => void
  setPlaying: (v: boolean) => void
  reset: () => void
}

export const useSimStore = create<SimState>()((set) => ({
  tableId: null,
  event: 'UPDATE',
  current: -1,
  playing: false,
  setTarget: (tableId, event) => set((s) => ({ tableId, event: event ?? s.event, current: -1, playing: false })),
  setCurrent: (current) => set({ current }),
  setPlaying: (playing) => set({ playing }),
  reset: () => set({ current: -1, playing: false }),
}))

export type TriggerModalTab = 'simular' | 'detalles' | 'sql' | 'efectos' | 'historial'

interface CanvasUiState {
  /** Nodo con el popover de edición en línea abierto. */
  editing: { kind: 'trigger' | 'function' | 'view'; id: string } | null
  /** Triggers desactivados solo para la simulación (no cambia el esquema). */
  disabledTriggers: string[]
  /** Diálogo de plantilla abierto (desde la paleta o el menú de acciones). */
  template: { id: TemplateId; tableId?: string } | null
  setTemplate: (t: CanvasUiState['template']) => void
  /** Modal "flujo del trigger" abierto (con la pestaña inicial). */
  flowModal: { triggerId: string; tab?: TriggerModalTab } | null
  openFlowModal: (triggerId: string, tab?: TriggerModalTab) => void
  closeFlowModal: () => void
  setEditing: (e: CanvasUiState['editing']) => void
  toggleTrigger: (id: string) => void
}

export const useCanvasUi = create<CanvasUiState>()((set) => ({
  editing: null,
  disabledTriggers: [],
  template: null,
  setTemplate: (template) => set({ template }),
  flowModal: null,
  openFlowModal: (triggerId, tab) => set({ flowModal: { triggerId, tab }, editing: null }),
  closeFlowModal: () => set({ flowModal: null }),
  setEditing: (editing) => set({ editing }),
  toggleTrigger: (id) =>
    set((s) => ({
      disabledTriggers: s.disabledTriggers.includes(id) ? s.disabledTriggers.filter((x) => x !== id) : [...s.disabledTriggers, id],
    })),
}))

/** Simulación derivada del borrador actual y del objetivo elegido. */
export function useSimulation() {
  const draft = useProjectStore((s) => s.draft)
  const tableId = useSimStore((s) => s.tableId)
  const event = useSimStore((s) => s.event)
  const disabledTriggers = useCanvasUi((s) => s.disabledTriggers)
  return useMemo(() => {
    if (!tableId || !(draft.tables.some((t) => t.id === tableId) || (draft.views ?? []).some((v) => v.id === tableId))) return null
    return simulate(draft, tableId, event, { disabled: new Set(disabledTriggers) })
  }, [draft, tableId, event, disabledTriggers])
}

/** Ids de nodos activos (paso actual) y ya recorridos, para resaltar en el lienzo. */
export function useSimHighlight() {
  const sim = useSimulation()
  const current = useSimStore((s) => s.current)
  const views = useProjectStore((s) => s.draft.views)
  return useMemo(() => {
    const active = new Set<string>()
    const visited = new Set<string>()
    const cycle = new Set<string>()
    const stale = new Set<string>()
    if (!sim || current < 0) return { active, visited, cycle, stale, running: false }
    const viewIds = new Set((views ?? []).map((v) => v.id))
    const schemaKind = (id: string) => (viewIds.has(id) ? 'v' : 't')
    const ids = (i: number) => {
      const s = sim.steps[i]
      const out = [`${schemaKind(s.tableId)}:${s.tableId}`]
      if (s.triggerId) out.push(`g:${s.triggerId}`)
      if (s.functionId) out.push(`f:${s.functionId}`)
      if (s.viewId) out.push(`v:${s.viewId}`)
      if (s.kind === 'refresh-view' || s.kind === 'stale-view') out.shift()
      return out
    }
    for (let i = 0; i < current && i < sim.steps.length; i++) ids(i).forEach((id) => visited.add(id))
    if (sim.steps[current]) {
      ids(current).forEach((id) => active.add(id))
      if (sim.steps[current].kind === 'cycle') ids(current).forEach((id) => cycle.add(id))
    }
    for (let i = 0; i <= current && i < sim.steps.length; i++)
      if (sim.steps[i].kind === 'stale-view' && sim.steps[i].viewId) stale.add(`v:${sim.steps[i].viewId}`)
    return { active, visited, cycle, stale, running: true }
  }, [sim, current, views])
}
