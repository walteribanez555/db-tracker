// Simulación reflejada como operación del dock "Flujo" y utilidades compartidas (lateral y modal).
import { useEffect, useRef } from 'react'

import { useOperationStore, type OperationStep, type StepStatus } from '@/components/operation-flow'
import type { Schema } from '@/types/schema'

import { relationName, type SimStep, type Simulation } from './graph'

type SimOpRef = { id: string; sim: Simulation; last: number; finished: boolean }

/** Paso del simulador como nodo del dock "Flujo" (un paso por etapa real). */
export function toOpStep(s: SimStep, draft: Schema): Omit<OperationStep, 'status'> {
  const trg = s.triggerId ? draft.triggers.find((t) => t.id === s.triggerId) : undefined
  const fn = s.functionId ? draft.functions.find((f) => f.id === s.functionId) : undefined
  const id = `sim-${s.index}`
  switch (s.kind) {
    case 'trigger':
      return { id, kind: 'trigger', label: `${s.phase} ${trg?.name ?? ''}`.trim(), detail: [fn ? `${fn.name}()` : null, s.detail].filter(Boolean).join(' · ') }
    case 'operation':
      return { id, kind: (draft.views ?? []).some((v) => v.id === s.tableId) ? 'view' : 'table', label: `${s.event} ${relationName(draft, s.tableId)}`, detail: s.detail }
    case 'refresh-view':
      return { id, kind: 'view', label: 'Refrescar vista', detail: `${relationName(draft, s.viewId ?? '')} · ${s.detail ?? ''}` }
    case 'stale-view':
      return { id, kind: 'view', label: 'Vista desactualizada', detail: `${relationName(draft, s.viewId ?? '')} · REFRESH pendiente` }
    case 'cycle':
      return { id, kind: 'check', label: 'Ciclo detectado', detail: s.detail }
    case 'limit':
      return { id, kind: 'check', label: 'Profundidad máxima', detail: s.label }
    case 'disabled':
      return { id, kind: 'trigger', label: `${s.phase} ${trg?.name ?? ''} (desactivado)`.trim(), detail: 'desactivado en la BD: no se ejecuta' }
  }
}

/** Refleja la simulación en curso como una operación del dock, sincronizada con el paso actual. */
export function useSimOperation(sim: Simulation | null, current: number, playing: boolean, draft: Schema) {
  const ref = useRef<SimOpRef | null>(null)
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  })

  useEffect(() => {
    const store = useOperationStore.getState()
    const status = (s: SimStep): StepStatus => (s.kind === 'cycle' ? 'error' : s.kind === 'disabled' ? 'skipped' : 'done')
    const close = (r: SimOpRef) => {
      if (r.finished) return
      for (let i = Math.max(0, r.last); i < r.sim.steps.length; i++)
        store.setStep(r.id, `sim-${r.sim.steps[i].index}`, { status: i === r.last ? status(r.sim.steps[i]) : 'skipped' })
      store.finish(r.id, 'done')
      r.finished = true
    }
    let r = ref.current
    if (r && (r.sim !== sim || current < 0 || (r.finished && current !== r.last))) {
      close(r)
      r = ref.current = null
    }
    if (!sim || current < 0 || !sim.steps.length || r?.finished) return
    if (!r) {
      const target = sim.steps[0]
      const title = `Simulación · ${target.event} en ${relationName(draftRef.current, target.tableId)}`
      r = ref.current = { id: store.start(title, sim.steps.map((s) => toOpStep(s, draftRef.current))), sim, last: -1, finished: false }
    }
    for (let i = Math.max(0, r.last); i < current; i++) store.setStep(r.id, `sim-${sim.steps[i].index}`, { status: status(sim.steps[i]) })
    store.setStep(r.id, `sim-${sim.steps[current].index}`, { status: 'running' })
    r.last = current
    if (!playing && current === sim.steps.length - 1) {
      store.setStep(r.id, `sim-${sim.steps[current].index}`, { status: status(sim.steps[current]) })
      store.finish(r.id, sim.cycles.length ? 'error' : 'done', sim.cycles.length ? 'Ciclo de triggers detectado' : undefined)
      r.finished = true
    }
  }, [sim, current, playing])

  // Al desmontar (cambio de pestaña o de vista) se cierra la operación abierta.
  useEffect(
    () => () => {
      const r = ref.current
      if (!r || r.finished) return
      const store = useOperationStore.getState()
      for (let i = Math.max(0, r.last); i < r.sim.steps.length; i++) store.setStep(r.id, `sim-${r.sim.steps[i].index}`, { status: 'skipped' })
      store.finish(r.id, 'done')
    },
    [],
  )
}


/** Ids de nodo (t:/v:/g:/f:) que ilumina un paso de la simulación. */
export function stepNodeIds(s: SimStep, viewIds: ReadonlySet<string>): string[] {
  const rel = (id: string) => `${viewIds.has(id) ? 'v' : 't'}:${id}`
  if (s.kind === 'refresh-view' || s.kind === 'stale-view') return [s.viewId ? `v:${s.viewId}` : '', s.functionId ? `f:${s.functionId}` : '', s.triggerId ? `g:${s.triggerId}` : ''].filter(Boolean)
  const out = [rel(s.tableId)]
  if (s.triggerId) out.push(`g:${s.triggerId}`)
  if (s.functionId) out.push(`f:${s.functionId}`)
  return out
}
