// Orígenes de esquema para exportar/comparar: borrador actual o cualquier versión.
import { useMemo } from 'react'

import { useProjectStore } from '@/store/project'
import type { Schema } from '@/types/schema'

export const DRAFT_SOURCE = 'draft'

export interface SchemaSource {
  id: string
  label: string
  detail: string
  branchId: string
  branchName: string
  versionId: string | null
}

const fmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

/** Lista agrupable por rama, más reciente primero. */
export function useSchemaSources() {
  const project = useProjectStore((s) => s.project)
  return useMemo(() => {
    const current = project.branches.find((b) => b.id === project.currentBranchId)
    const draft: SchemaSource = {
      id: DRAFT_SOURCE,
      label: 'Borrador actual',
      detail: `rama ${current?.name ?? '?'}`,
      branchId: project.currentBranchId,
      branchName: current?.name ?? '',
      versionId: null,
    }
    const groups = project.branches
      .map((b) => ({
        branch: b,
        versions: project.versions
          .filter((v) => v.branchId === b.id)
          .sort((a, c) => c.createdAt.localeCompare(a.createdAt))
          .map<SchemaSource>((v) => ({
            id: v.id,
            label: v.message || '(sin mensaje)',
            detail: `${b.name} · ${fmt(v.createdAt)}${b.headVersionId === v.id ? ' · última' : ''}`,
            branchId: b.id,
            branchName: b.name,
            versionId: v.id,
          })),
      }))
      .filter((g) => g.versions.length)
    return { draft, groups, all: [draft, ...groups.flatMap((g) => g.versions)] }
  }, [project])
}

export function useSchemaFor(sourceId: string): Schema {
  const draft = useProjectStore((s) => s.draft)
  const versions = useProjectStore((s) => s.project.versions)
  return useMemo(() => {
    if (sourceId === DRAFT_SOURCE) return draft
    return versions.find((v) => v.id === sourceId)?.schema ?? draft
  }, [sourceId, draft, versions])
}

export function schemaFor(sourceId: string): Schema {
  const { draft, project } = useProjectStore.getState()
  if (sourceId === DRAFT_SOURCE) return draft
  return project.versions.find((v) => v.id === sourceId)?.schema ?? draft
}

/** Esquemas antiguos pueden no tener `views`. */
export const withDefaults = (s: Schema): Schema => ({ ...s, views: s.views ?? [] })
