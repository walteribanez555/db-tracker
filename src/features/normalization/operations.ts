// Aplicación de correcciones como operaciones paso a paso (dock "Flujo").
import { runOperation, useOperationStore, type RunnableStep } from '@/components/operation-flow'
import { useProjectStore } from '@/store/project'
import type { Schema } from '@/types/schema'

import type { BranchDraft } from './components/BranchDialog'
import { planFix, type FixStep } from './lib/fixes'
import type { Finding } from './lib/types'

export const operationTitle = (f: Finding) => `Normalización ${f.level === 'buenas-prácticas' ? '' : `${f.level} `}· ${f.title}`

/** Pasos de una corrección sobre un esquema de trabajo; cada uno publica el resultado en el borrador. */
function fixRunnables(plan: FixStep[], working: Schema): RunnableStep[] {
  return plan.map((p) => ({
    id: p.id,
    label: p.label,
    detail: p.detail,
    kind: p.kind,
    run: () => {
      p.apply(working)
      useProjectStore.getState().replaceDraft(working)
    },
  }))
}

export interface FixRun {
  opId: string
  /** Borrador antes de aplicar (para deshacer). */
  before: Schema
  done: ReturnType<typeof runOperation>
}

/**
 * Ejecuta la corrección de un hallazgo como operación animada.
 * - draft: aplica cada transformación en el borrador actual.
 * - branch: además crea la rama del flujo y confirma la versión.
 */
export function runFix(finding: Finding, mode: { kind: 'draft' } | { kind: 'branch'; form: BranchDraft }): FixRun | null {
  const fix = finding.fix
  if (!fix) return null
  const before = useProjectStore.getState().draft
  const working = structuredClone(before)
  const steps = fixRunnables(planFix(before, fix), working)

  if (mode.kind === 'branch') {
    const { form } = mode
    steps.push(
      {
        id: 'branch',
        kind: 'branch',
        label: 'Crear rama',
        detail: form.name,
        run: () => {
          // createBranch hace checkout y reemplaza el borrador: se restaura el esquema ya transformado.
          const st = useProjectStore.getState()
          st.createBranch(form.name, form.description)
          useProjectStore.getState().replaceDraft(working)
          return form.name
        },
      },
      {
        id: 'commit',
        kind: 'commit',
        label: 'Confirmar versión',
        detail: form.message,
        run: () => {
          const v = useProjectStore.getState().commit(form.message)
          return `${v.id.slice(-7)} · ${form.message}`
        },
      },
    )
  }

  const done = runOperation(operationTitle(finding), steps)
  // runOperation registra la operación de forma síncrona antes del primer paso.
  const opId = useOperationStore.getState().operations[0]?.id ?? ''
  return { opId, before, done }
}

/** Plan de la corrección como pasos pendientes (vista previa del flujo antes de aplicarlo). */
export function previewSteps(schema: Schema, finding: Finding) {
  if (!finding.fix) return []
  return planFix(schema, finding.fix).map((p) => ({ id: p.id, label: p.label, detail: p.detail, kind: p.kind, status: 'pending' as const }))
}
