import { create } from 'zustand'

import { useProjectStore } from '@/store/project'
import type { Schema } from '@/types/schema'

const LIMIT = 50
/** Cambios consecutivos dentro de esta ventana (p. ej. escribir en un input) se agrupan en una sola entrada. */
const MERGE_WINDOW_MS = 500

interface HistoryState {
  past: Schema[]
  future: Schema[]
}

export const useHistoryStore = create<HistoryState>(() => ({ past: [], future: [] }))

let applying = false
let lastChangeAt = 0
/** Durante un lote (operación paso a paso) todos los cambios forman una sola entrada. */
let batch: { pushed: boolean } | null = null

useProjectStore.subscribe((state, prev) => {
  if (state.draft === prev.draft || applying) return

  const switched =
    state.project.id !== prev.project.id ||
    state.project.currentBranchId !== prev.project.currentBranchId ||
    state.baseVersionId !== prev.baseVersionId
  if (switched) {
    useHistoryStore.setState({ past: [], future: [] })
    lastChangeAt = 0
    return
  }

  if (batch) {
    if (batch.pushed) useHistoryStore.setState({ future: [] })
    else {
      batch.pushed = true
      useHistoryStore.setState((h) => ({ past: [...h.past, prev.draft].slice(-LIMIT), future: [] }))
    }
    return
  }

  const now = Date.now()
  const merge = now - lastChangeAt < MERGE_WINDOW_MS && useHistoryStore.getState().past.length > 0
  lastChangeAt = now
  if (merge) {
    useHistoryStore.setState({ future: [] })
    return
  }
  useHistoryStore.setState((h) => ({ past: [...h.past, prev.draft].slice(-LIMIT), future: [] }))
})

const apply = (schema: Schema) => {
  applying = true
  try {
    useProjectStore.getState().replaceDraft(schema)
  } finally {
    applying = false
    lastChangeAt = 0
  }
}

export function undo() {
  const { past, future } = useHistoryStore.getState()
  const previous = past.at(-1)
  if (!previous) return
  const current = useProjectStore.getState().draft
  useHistoryStore.setState({ past: past.slice(0, -1), future: [...future, current].slice(-LIMIT) })
  apply(previous)
}

export function redo() {
  const { past, future } = useHistoryStore.getState()
  const next = future.at(-1)
  if (!next) return
  const current = useProjectStore.getState().draft
  useHistoryStore.setState({ past: [...past, current].slice(-LIMIT), future: future.slice(0, -1) })
  apply(next)
}

/** Cierra la ventana de agrupación para que el siguiente cambio cree una entrada nueva. */
export function checkpoint() {
  lastChangeAt = 0
}

/** Ejecuta `fn` (síncrona o asíncrona) agrupando todos sus cambios en una única entrada del historial. */
export async function batchHistory<T>(fn: () => Promise<T> | T): Promise<T> {
  batch = { pushed: false }
  try {
    return await fn()
  } finally {
    batch = null
    lastChangeAt = 0
  }
}
