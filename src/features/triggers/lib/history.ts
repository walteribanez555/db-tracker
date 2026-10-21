// Historial de un trigger a lo largo de las versiones del proyecto.
import { diffSchemas, parentOf, triggerFieldChanges } from '@/lib/diff'
import type { Project, Version } from '@/types/schema'

export interface TriggerHistoryEntry {
  version: Version
  branchName: string
  kind: 'creado' | 'modificado' | 'eliminado'
  changes: string[]
  /** Saltos totales de esa versión (diffSchemas), para dar contexto. */
  jumps: number
}

/** Versiones en las que cambió el trigger (o su función), comparando cada versión con su padre. */
export function triggerHistory(project: Project, triggerId: string): TriggerHistoryEntry[] {
  const out: TriggerHistoryEntry[] = []
  const versions = [...project.versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const v of versions) {
    const parent = parentOf(project, v)
    const from = parent?.schema
    const a = from?.triggers.find((t) => t.id === triggerId)
    const b = v.schema.triggers.find((t) => t.id === triggerId)
    if (!a && !b) continue
    const branchName = project.branches.find((br) => br.id === v.branchId)?.name ?? '?'
    const jumps = diffSchemas(from ?? null, v.schema).jumps
    if (!a && b) {
      out.push({ version: v, branchName, kind: 'creado', changes: [`${b.timing} ${b.events.join(', ')}`], jumps })
      continue
    }
    if (a && !b) {
      out.push({ version: v, branchName, kind: 'eliminado', changes: [], jumps })
      continue
    }
    const changes = triggerFieldChanges(a!, b!, from!, v.schema)
    const fa = from!.functions.find((f) => f.id === b!.functionId)
    const fb = v.schema.functions.find((f) => f.id === b!.functionId)
    if (fa && fb && fa.body !== fb.body) changes.push(`cuerpo de ${fb.name}() modificado`)
    if (changes.length) out.push({ version: v, branchName, kind: 'modificado', changes, jumps })
  }
  return out.reverse()
}
