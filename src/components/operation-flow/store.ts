import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { uid } from '@/lib/id'

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

/** Tipo de paso: decide el icono del nodo en el flujo. */
export type StepKind =
  | 'table'
  | 'column'
  | 'relation'
  | 'view'
  | 'trigger'
  | 'function'
  | 'index'
  | 'branch'
  | 'commit'
  | 'sql'
  | 'network'
  | 'file'
  | 'check'

export interface OperationStep {
  id: string
  label: string
  detail?: string
  kind?: StepKind
  status: StepStatus
  /** ms que tardó el paso (se rellena al terminar). */
  ms?: number
}

export interface Operation {
  id: string
  title: string
  status: 'running' | 'done' | 'error'
  steps: OperationStep[]
  startedAt: number
  finishedAt?: number
  error?: string
}

interface OperationState {
  operations: Operation[]
  /** Operación que se muestra en el dock (la última por defecto). */
  focusedId: string | null
  start: (title: string, steps: Omit<OperationStep, 'status'>[]) => string
  setStep: (opId: string, stepId: string, patch: Partial<Omit<OperationStep, 'id'>>) => void
  addStep: (opId: string, step: Omit<OperationStep, 'status'>, afterStepId?: string) => void
  finish: (opId: string, status: 'done' | 'error', error?: string) => void
  focus: (opId: string | null) => void
  clear: () => void
}

const MAX_HISTORY = 50

export const useOperationStore = create<OperationState>()(
  persist(
    (set) => ({
  operations: [],
  focusedId: null,
  start: (title, steps) => {
    const id = uid('op_')
    const op: Operation = {
      id,
      title,
      status: 'running',
      startedAt: Date.now(),
      steps: steps.map((s) => ({ ...s, status: 'pending' })),
    }
    set((s) => ({ operations: [op, ...s.operations].slice(0, MAX_HISTORY), focusedId: id }))
    return id
  },
  setStep: (opId, stepId, patch) =>
    set((s) => ({
      operations: s.operations.map((op) =>
        op.id !== opId ? op : { ...op, steps: op.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)) },
      ),
    })),
  addStep: (opId, step, afterStepId) =>
    set((s) => ({
      operations: s.operations.map((op) => {
        if (op.id !== opId) return op
        const steps = [...op.steps]
        const at = afterStepId ? steps.findIndex((x) => x.id === afterStepId) + 1 : steps.length
        steps.splice(at, 0, { ...step, status: 'pending' })
        return { ...op, steps }
      }),
    })),
  finish: (opId, status, error) =>
    set((s) => ({
      operations: s.operations.map((op) =>
        op.id !== opId
          ? op
          : {
              ...op,
              status,
              error,
              finishedAt: Date.now(),
              steps: op.steps.map((st) => (st.status === 'pending' && status === 'error' ? { ...st, status: 'skipped' } : st)),
            },
      ),
    })),
  focus: (focusedId) => set({ focusedId }),
  clear: () => set({ operations: [], focusedId: null }),
    }),
    {
      // Historial de acciones de la sesión (también lo usa el informe PDF). Solo en esta pestaña.
      name: 'db-tracker:operations',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ operations: s.operations }),
      merge: (persisted, current) => {
        const ops = ((persisted as Partial<OperationState>)?.operations ?? []).map((op) =>
          op.status === 'running' ? { ...op, status: 'error' as const, error: 'Interrumpida al recargar', finishedAt: op.startedAt } : op,
        )
        return { ...current, operations: ops }
      },
    },
  ),
)

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export interface RunnableStep extends Omit<OperationStep, 'status' | 'ms'> {
  /** Trabajo del paso. Puede devolver un detalle final para mostrar en el nodo. */
  run?: () => unknown | Promise<unknown>
}

/**
 * Ejecuta pasos en orden mostrándolos como un flujo animado en el dock.
 * Cada paso dura al menos `minStepMs` para que el flujo se pueda seguir con la vista
 * (sin espera si el usuario pidió reducir el movimiento).
 */
export async function runOperation<T = void>(
  title: string,
  steps: RunnableStep[],
  { minStepMs = 260 }: { minStepMs?: number } = {},
): Promise<{ ok: true; results: unknown[] } | { ok: false; error: unknown; results: unknown[] }> {
  const store = useOperationStore.getState()
  const opId = store.start(
    title,
    steps.map(({ run: _run, ...s }) => s),
  )
  const results: unknown[] = []
  const minMs = reducedMotion() ? 0 : minStepMs
  for (const step of steps) {
    const t0 = performance.now()
    useOperationStore.getState().setStep(opId, step.id, { status: 'running' })
    try {
      const result = await step.run?.()
      results.push(result)
      const elapsed = performance.now() - t0
      if (elapsed < minMs) await wait(minMs - elapsed)
      useOperationStore.getState().setStep(opId, step.id, {
        status: 'done',
        ms: Math.round(elapsed),
        ...(typeof result === 'string' ? { detail: result } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useOperationStore.getState().setStep(opId, step.id, { status: 'error', detail: message })
      useOperationStore.getState().finish(opId, 'error', message)
      return { ok: false, error, results }
    }
  }
  useOperationStore.getState().finish(opId, 'done')
  return { ok: true, results } as { ok: true; results: T[] }
}
