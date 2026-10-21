// Operaciones de versionado ejecutadas paso a paso con `runOperation` (se ven en el dock "Flujo").
// Cada paso hace trabajo real sobre el store del proyecto.
import { runOperation, type RunnableStep } from '@/components/operation-flow'
import { createSampleProject } from '@/data/sample-project'
import { diffSchemas, jumpBreakdown } from '@/lib/diff'
import { uid } from '@/lib/id'
import { BRANCH_COLORS, emptySchema, useProjectStore } from '@/store/project'
import type { Branch, Project, Schema, Version } from '@/types/schema'

import { validateSchema } from './live-diff'

const clone = <T,>(v: T): T => structuredClone(v)
const S = () => useProjectStore.getState()
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const shortId = (id: string) => id.replace(/^ver_/, '').slice(0, 8)

const schemaSummary = (s: Schema) =>
  [plural(s.tables.length, 'tabla', 'tablas'), (s.views?.length ?? 0) && plural(s.views.length, 'vista', 'vistas'), s.triggers.length && plural(s.triggers.length, 'trigger', 'triggers')]
    .filter(Boolean)
    .join(' · ')

function diffDetail(from: Schema | null, to: Schema) {
  const d = diffSchemas(from, to)
  const b = jumpBreakdown(d)
  const parts = [
    b.tables && plural(b.tables, 'tabla', 'tablas'),
    b.columns && plural(b.columns, 'columna', 'columnas'),
    b.indexes && plural(b.indexes, 'índice', 'índices'),
    b.relations && plural(b.relations, 'relación', 'relaciones'),
    b.views && plural(b.views, 'vista', 'vistas'),
    b.triggers && plural(b.triggers, 'trigger', 'triggers'),
  ].filter(Boolean)
  return `${plural(d.jumps, 'salto', 'saltos')}${parts.length ? ` · ${parts.join(', ')}` : ''}`
}

/**
 * Confirmar versión: calcular diff → validar esquema → crear versión → mover la cabeza de la rama.
 * Reproduce `commit()` del store en dos pasos reales (crear la versión y mover la cabeza).
 */
export async function commitWithFlow(message: string, author = 'local') {
  let version: Version | null = null
  const steps: RunnableStep[] = [
    {
      id: 'diff',
      label: 'Calcular diff',
      kind: 'check',
      run: () => {
        const { project, baseVersionId, draft } = S()
        const base = baseVersionId ? project.versions.find((v) => v.id === baseVersionId)?.schema : null
        return diffDetail(base ?? null, draft)
      },
    },
    {
      id: 'validate',
      label: 'Validar esquema',
      kind: 'check',
      run: () => {
        const problems = validateSchema(S().draft)
        return problems.length ? `${plural(problems.length, 'aviso', 'avisos')}: ${problems.slice(0, 2).join('; ')}${problems.length > 2 ? '…' : ''}` : 'sin problemas'
      },
    },
    {
      id: 'commit',
      label: 'Crear versión',
      kind: 'commit',
      run: () => {
        const { project, draft } = S()
        const branch = project.branches.find((b) => b.id === project.currentBranchId)!
        version = {
          id: uid('ver_'),
          branchId: branch.id,
          parentId: branch.headVersionId ?? branch.forkedFromVersionId,
          message,
          author,
          createdAt: new Date().toISOString(),
          schema: clone(draft),
        }
        const v = version
        useProjectStore.setState({ project: { ...project, versions: [...project.versions, v] }, baseVersionId: v.id })
        return `${shortId(v.id)} · «${message}»`
      },
    },
    {
      id: 'head',
      label: 'Mover cabeza',
      kind: 'branch',
      run: () => {
        const v = version!
        const { project } = S()
        const branch = project.branches.find((b) => b.id === v.branchId)!
        useProjectStore.setState({
          project: { ...project, branches: project.branches.map((b) => (b.id === branch.id ? { ...b, headVersionId: v.id } : b)) },
        })
        return `${branch.name} → ${shortId(v.id)}`
      },
    },
  ]
  const res = await runOperation(`Confirmar versión «${message}»`, steps)
  return { ...res, version: version as Version | null }
}

/** Crear flujo/rama: crear rama → copiar el esquema de la versión de origen → checkout. */
export async function createBranchWithFlow(name: string, description: string, fromVersionId: string | null) {
  let branch: Branch | null = null
  let schema: Schema | null = null
  const steps: RunnableStep[] = [
    {
      id: 'branch',
      label: 'Crear rama',
      detail: name,
      kind: 'branch',
      run: () => {
        const { project } = S()
        branch = {
          id: uid('br_'),
          name,
          description,
          color: BRANCH_COLORS[project.branches.length % BRANCH_COLORS.length],
          forkedFromVersionId: fromVersionId,
          headVersionId: null,
          createdAt: new Date().toISOString(),
        }
        const b = branch
        useProjectStore.setState({ project: { ...project, branches: [...project.branches, b] } })
        return name
      },
    },
    {
      id: 'copy',
      label: 'Copiar esquema',
      kind: 'table',
      run: () => {
        const { project } = S()
        const origin = fromVersionId ? project.versions.find((v) => v.id === fromVersionId) : undefined
        schema = origin ? clone(origin.schema) : emptySchema(project.dialect)
        return origin ? `${schemaSummary(schema)} desde «${origin.message}»` : 'esquema vacío'
      },
    },
    {
      id: 'checkout',
      label: 'Checkout',
      kind: 'branch',
      run: () => {
        const b = branch!
        const { project } = S()
        useProjectStore.setState({
          project: { ...project, currentBranchId: b.id },
          draft: schema!,
          baseVersionId: fromVersionId,
          selection: null,
        })
        return b.name
      },
    },
  ]
  const res = await runOperation(`Crear flujo ${name}`, steps)
  return { ...res, branch: branch as Branch | null }
}

/** Cambiar de rama o versión: descartar el borrador (si hay cambios) → cargar el esquema. */
export async function switchWithFlow(target: { branchId: string } | { versionId: string }) {
  const { project } = S()
  const targetLabel =
    'branchId' in target
      ? project.branches.find((b) => b.id === target.branchId)?.name ?? '?'
      : project.versions.find((v) => v.id === target.versionId)?.message ?? '?'
  const steps: RunnableStep[] = []
  if (S().isDirty()) {
    steps.push({
      id: 'discard',
      label: 'Descartar borrador',
      kind: 'commit',
      run: () => {
        const { project: p, baseVersionId, draft } = S()
        const base = baseVersionId ? p.versions.find((v) => v.id === baseVersionId)?.schema : null
        const detail = diffDetail(base ?? null, draft)
        S().discardDraft()
        return `${detail} descartados`
      },
    })
  }
  steps.push({
    id: 'load',
    label: 'Cargar esquema',
    kind: 'file',
    run: () => {
      if ('branchId' in target) S().checkoutBranch(target.branchId)
      else S().checkoutVersion(target.versionId)
      const { draft, project: p } = S()
      const branch = p.branches.find((b) => b.id === p.currentBranchId)
      return `${branch?.name ?? ''} · ${schemaSummary(draft)}`
    },
  })
  return runOperation('branchId' in target ? `Cambiar a ${targetLabel}` : `Abrir versión «${targetLabel}»`, steps)
}

/** Cargar el proyecto de ejemplo: crear proyecto → un paso por rama y versión → checkout de main. */
export async function loadSampleWithFlow() {
  const sample = createSampleProject()
  const main = sample.branches.find((b) => b.forkedFromVersionId === null)!
  type Event = { at: number; kind: 'branch'; branch: Branch } | { at: number; kind: 'version'; version: Version }
  const events: Event[] = [
    ...sample.branches.filter((b) => b.id !== main.id).map((b) => ({ at: new Date(b.createdAt).getTime(), kind: 'branch' as const, branch: b })),
    ...sample.versions.map((v) => ({ at: new Date(v.createdAt).getTime(), kind: 'version' as const, version: v })),
  ].sort((a, b) => a.at - b.at)
  const branchName = (id: string) => sample.branches.find((b) => b.id === id)?.name ?? '?'

  const steps: RunnableStep[] = [
    {
      id: 'init',
      label: 'Crear proyecto',
      kind: 'file',
      run: () => {
        const empty: Project = { ...sample, versions: [], branches: [{ ...main, headVersionId: null }], currentBranchId: main.id }
        S().loadProject(empty)
        return `${sample.name} · ${sample.dialect}`
      },
    },
    ...events.map<RunnableStep>((e) =>
      e.kind === 'branch'
        ? {
            id: `b:${e.branch.id}`,
            label: 'Crear rama',
            detail: e.branch.name,
            kind: 'branch',
            run: () => {
              const { project } = S()
              useProjectStore.setState({ project: { ...project, branches: [...project.branches, { ...e.branch, headVersionId: null }] } })
            },
          }
        : {
            id: `v:${e.version.id}`,
            label: 'Versión',
            detail: `${branchName(e.version.branchId)} · ${e.version.message}`,
            kind: 'commit',
            run: () => {
              const { project } = S()
              const v = e.version
              useProjectStore.setState({
                project: {
                  ...project,
                  versions: [...project.versions, v],
                  branches: project.branches.map((b) => (b.id === v.branchId ? { ...b, headVersionId: v.id } : b)),
                },
              })
            },
          },
    ),
    {
      id: 'checkout',
      label: 'Checkout',
      kind: 'branch',
      run: () => {
        S().loadProject(sample)
        return `${main.name} · ${schemaSummary(S().draft)}`
      },
    },
  ]
  return runOperation('Cargar proyecto de ejemplo', steps, { minStepMs: 140 })
}
