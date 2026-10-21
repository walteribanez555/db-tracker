// Lleva un esquema importado al proyecto: como borrador de la rama actual o como rama nueva con su primer commit.
import { useProjectStore } from '@/store/project'
import type { Schema } from '@/types/schema'

export type ImportTarget =
  | { mode: 'draft' }
  | { mode: 'branch'; name: string; description: string; message: string; author?: string }

/** Estado del formulario de destino (ImportTargetForm). */
export interface ImportTargetState {
  mode: 'draft' | 'branch'
  name: string
  message: string
}

export function toTarget(s: ImportTargetState, description: string): ImportTarget {
  return s.mode === 'draft' ? { mode: 'draft' } : { mode: 'branch', name: s.name, description, message: s.message }
}

/** Nombre de rama libre: añade -2, -3… si ya existe. */
export function uniqueBranchName(name: string): string {
  const branches = useProjectStore.getState().project.branches
  const base = name.trim() || 'importado'
  if (!branches.some((b) => b.name === base)) return base
  let i = 2
  while (branches.some((b) => b.name === `${base}-${i}`)) i++
  return `${base}-${i}`
}

export const slugBranch = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

export function importIntoProject(schema: Schema, target: ImportTarget): { branchName: string; versionId?: string } {
  const store = useProjectStore.getState()
  const clean: Schema = { ...structuredClone(schema), views: schema.views ?? [] }
  if (target.mode === 'draft') {
    store.replaceDraft(clean)
    const branch = store.project.branches.find((b) => b.id === store.project.currentBranchId)
    return { branchName: branch?.name ?? '' }
  }
  const name = uniqueBranchName(target.name)
  store.createBranch(name, target.description)
  useProjectStore.getState().replaceDraft(clean)
  const version = useProjectStore.getState().commit(target.message || `Importación en ${name}`, target.author ?? 'importación')
  return { branchName: name, versionId: version.id }
}
