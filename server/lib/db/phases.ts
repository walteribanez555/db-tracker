// Tiempos reales por fase de la introspección (cada fase mide desde la marca anterior).
import type { IntrospectPhase } from '../../../src/features/io/api-types.ts'
import { elapsed, now } from './client.ts'

export function phaseTimer() {
  const phases: IntrospectPhase[] = []
  let last = now()
  return {
    phases,
    mark(id: IntrospectPhase['id']) {
      phases.push({ id, ms: Math.round(elapsed(last) * 10) / 10 })
      last = now()
    },
  }
}
