// Ayudante sobre el dock de operaciones: pasos reales con su duración medida.
import { useOperationStore, type StepKind, type StepStatus } from '@/components/operation-flow'

export type OpTracker = ReturnType<typeof opTracker>

/** Pequeño ayudante sobre el dock: marca pasos con su duración real. */
export function opTracker(title: string, steps: Array<{ id: string; label: string; detail?: string; kind?: StepKind }>) {
  const store = useOperationStore.getState
  const opId = store().start(title, steps)
  const started = new Map<string, number>()
  return {
    opId,
    run(id: string, detail?: string) {
      started.set(id, performance.now())
      store().setStep(opId, id, { status: 'running', ...(detail !== undefined ? { detail } : {}) })
    },
    end(id: string, status: StepStatus, detail?: string) {
      const t0 = started.get(id)
      store().setStep(opId, id, {
        status,
        ...(detail !== undefined ? { detail } : {}),
        ...(t0 !== undefined ? { ms: Math.round(performance.now() - t0) } : {}),
      })
    },
    add(step: { id: string; label: string; detail?: string; kind?: StepKind }, after?: string) {
      store().addStep(opId, step, after)
    },
    finish(status: 'done' | 'error', error?: string) {
      store().finish(opId, status, error)
    },
    /** Paso en curso (para marcarlo en rojo si llega un error sin paso concreto). */
    runningStep(): string | undefined {
      return store()
        .operations.find((o) => o.id === opId)
        ?.steps.find((s) => s.status === 'running')?.id
    },
    isOpen(): boolean {
      return store().operations.find((o) => o.id === opId)?.status === 'running'
    },
  }
}
