import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { uid } from '@/lib/id'
import type {
  Branch,
  Column,
  DbFunction,
  EnumType,
  GithubLink,
  Note,
  Project,
  Relation,
  RemoteConnection,
  Schema,
  Table,
  Trigger,
  Version,
  View,
} from '@/types/schema'

export const TABLE_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#f43f5e', '#06b6d4', '#64748b']
export const BRANCH_COLORS = ['#18181b', '#2563eb', '#ea580c', '#7c3aed', '#059669', '#db2777', '#0891b2']

export const emptySchema = (dialect: Schema['dialect'] = 'postgresql'): Schema => ({
  dialect,
  tables: [],
  views: [],
  relations: [],
  enums: [],
  functions: [],
  triggers: [],
  notes: [],
})

export const newColumn = (partial: Partial<Column> = {}): Column => ({
  id: uid('col_'),
  name: 'columna',
  type: 'varchar(255)',
  pk: false,
  nullable: true,
  unique: false,
  autoIncrement: false,
  ...partial,
})

const clone = <T,>(v: T): T => structuredClone(v)

/** JSON con claves ordenadas: la comparación no depende del orden en que se crearon los campos. */
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  )

const GITHUB_SESSION_KEY = 'db-tracker:github-link'

const readSessionGithub = (): GithubLink | undefined => {
  try {
    const raw = sessionStorage.getItem(GITHUB_SESSION_KEY)
    return raw ? (JSON.parse(raw) as GithubLink) : undefined
  } catch {
    return undefined
  }
}

/** Reemplaza en su sitio o añade al final (mantiene el orden). */
const upsertById = <T extends { id: string }>(list: T[], item: T): T[] =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

const createInitialProject = (): Project => {
  const branchId = uid('br_')
  return {
    id: uid('prj_'),
    name: 'nuevo-proyecto',
    dialect: 'postgresql',
    branches: [
      {
        id: branchId,
        name: 'main',
        color: BRANCH_COLORS[0],
        description: 'Rama principal',
        forkedFromVersionId: null,
        headVersionId: null,
        createdAt: new Date().toISOString(),
      },
    ],
    versions: [],
    currentBranchId: branchId,
    connections: [],
  }
}

type SchemaRecipe = (draft: Schema) => void

export interface ProjectState {
  project: Project
  /** Esquema de trabajo (sin confirmar) de la rama actual. */
  draft: Schema
  /** Versión sobre la que se editó el borrador. */
  baseVersionId: string | null
  selection: { kind: 'table' | 'relation' | 'trigger' | 'function' | 'note' | 'view'; id: string } | null

  // Proyecto
  loadProject: (project: Project, branchId?: string) => void
  renameProject: (name: string) => void
  setSelection: (selection: ProjectState['selection']) => void

  // Edición del esquema (siempre sobre el borrador)
  mutate: (recipe: SchemaRecipe) => void
  replaceDraft: (schema: Schema) => void
  addTable: (partial?: Partial<Table>) => Table
  updateTable: (id: string, patch: Partial<Omit<Table, 'id' | 'columns'>>) => void
  removeTable: (id: string) => void
  addColumn: (tableId: string, partial?: Partial<Column>) => Column
  updateColumn: (tableId: string, columnId: string, patch: Partial<Column>) => void
  removeColumn: (tableId: string, columnId: string) => void
  moveColumn: (tableId: string, from: number, to: number) => void
  addRelation: (rel: Omit<Relation, 'id'>) => Relation
  updateRelation: (id: string, patch: Partial<Relation>) => void
  removeRelation: (id: string) => void
  upsertEnum: (e: EnumType) => void
  removeEnum: (id: string) => void
  upsertFunction: (f: DbFunction) => void
  removeFunction: (id: string) => void
  upsertTrigger: (t: Trigger) => void
  removeTrigger: (id: string) => void
  upsertView: (v: View) => void
  removeView: (id: string) => void
  upsertNote: (n: Note) => void
  removeNote: (id: string) => void

  // Versionado
  isDirty: () => boolean
  commit: (message: string, author?: string) => Version
  createBranch: (name: string, description: string, fromVersionId?: string | null) => Branch
  checkoutBranch: (branchId: string) => void
  checkoutVersion: (versionId: string) => void
  discardDraft: () => void
  setVersionGithubSha: (versionId: string, sha: string) => void

  // Integraciones
  setGithub: (link: GithubLink | undefined) => void
  upsertConnection: (c: RemoteConnection) => void
  removeConnection: (id: string) => void
}

const headSchema = (project: Project, branchId: string): { schema: Schema; versionId: string | null } => {
  const branch = project.branches.find((b) => b.id === branchId)
  const head = branch?.headVersionId ? project.versions.find((v) => v.id === branch.headVersionId) : undefined
  if (head) return { schema: clone(head.schema), versionId: head.id }
  const fork = branch?.forkedFromVersionId ? project.versions.find((v) => v.id === branch.forkedFromVersionId) : undefined
  if (fork) return { schema: clone(fork.schema), versionId: fork.id }
  return { schema: emptySchema(project.dialect), versionId: null }
}

const initial = createInitialProject()

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      project: initial,
      draft: emptySchema(),
      baseVersionId: null,
      selection: null,

      loadProject: (project, branchId) => {
        const target = branchId ?? project.currentBranchId
        const { schema, versionId } = headSchema(project, target)
        set({ project: { ...project, currentBranchId: target }, draft: schema, baseVersionId: versionId, selection: null })
      },
      renameProject: (name) => set((s) => ({ project: { ...s.project, name } })),
      setSelection: (selection) => set({ selection }),

      mutate: (recipe) =>
        set((s) => {
          const next = clone(s.draft)
          recipe(next)
          return { draft: next }
        }),
      replaceDraft: (schema) => set({ draft: clone(schema) }),

      addTable: (partial = {}) => {
        const count = get().draft.tables.length
        const table: Table = {
          id: uid('tbl_'),
          name: `tabla_${count + 1}`,
          color: TABLE_COLORS[count % TABLE_COLORS.length],
          columns: [newColumn({ name: 'id', type: 'uuid', pk: true, nullable: false, default: 'gen_random_uuid()' })],
          indexes: [],
          position: { x: 80 + (count % 4) * 300, y: 80 + Math.floor(count / 4) * 280 },
          ...partial,
        }
        get().mutate((d) => void d.tables.push(table))
        set({ selection: { kind: 'table', id: table.id } })
        return table
      },
      updateTable: (id, patch) =>
        get().mutate((d) => {
          const t = d.tables.find((x) => x.id === id)
          if (t) Object.assign(t, patch)
        }),
      removeTable: (id) =>
        get().mutate((d) => {
          d.tables = d.tables.filter((t) => t.id !== id)
          d.relations = d.relations.filter((r) => r.sourceTableId !== id && r.targetTableId !== id)
          d.triggers = d.triggers.filter((t) => t.tableId !== id)
          d.views.forEach((v) => (v.sourceIds = v.sourceIds.filter((s) => s !== id)))
        }),
      addColumn: (tableId, partial = {}) => {
        const column = newColumn(partial)
        get().mutate((d) => void d.tables.find((t) => t.id === tableId)?.columns.push(column))
        return column
      },
      updateColumn: (tableId, columnId, patch) =>
        get().mutate((d) => {
          const c = d.tables.find((t) => t.id === tableId)?.columns.find((x) => x.id === columnId)
          if (c) Object.assign(c, patch)
        }),
      removeColumn: (tableId, columnId) =>
        get().mutate((d) => {
          const t = d.tables.find((x) => x.id === tableId)
          if (t) {
            t.columns = t.columns.filter((c) => c.id !== columnId)
            t.indexes = t.indexes.map((i) => ({ ...i, columnIds: i.columnIds.filter((c) => c !== columnId) }))
          }
          d.relations = d.relations.filter((r) => r.sourceColumnId !== columnId && r.targetColumnId !== columnId)
        }),
      moveColumn: (tableId, from, to) =>
        get().mutate((d) => {
          const cols = d.tables.find((t) => t.id === tableId)?.columns
          if (!cols) return
          const [c] = cols.splice(from, 1)
          cols.splice(to, 0, c)
        }),
      addRelation: (rel) => {
        const relation: Relation = { id: uid('rel_'), ...rel }
        get().mutate((d) => void d.relations.push(relation))
        return relation
      },
      updateRelation: (id, patch) =>
        get().mutate((d) => {
          const r = d.relations.find((x) => x.id === id)
          if (r) Object.assign(r, patch)
        }),
      removeRelation: (id) => get().mutate((d) => void (d.relations = d.relations.filter((r) => r.id !== id))),
      upsertEnum: (e) => get().mutate((d) => void (d.enums = upsertById(d.enums, e))),
      removeEnum: (id) => get().mutate((d) => void (d.enums = d.enums.filter((x) => x.id !== id))),
      upsertFunction: (f) => get().mutate((d) => void (d.functions = upsertById(d.functions, f))),
      removeFunction: (id) =>
        get().mutate((d) => {
          d.functions = d.functions.filter((x) => x.id !== id)
          d.triggers = d.triggers.filter((t) => t.functionId !== id)
        }),
      upsertTrigger: (t) => get().mutate((d) => void (d.triggers = upsertById(d.triggers, t))),
      removeTrigger: (id) => get().mutate((d) => void (d.triggers = d.triggers.filter((x) => x.id !== id))),
      upsertView: (v) => get().mutate((d) => void (d.views = upsertById(d.views, v))),
      removeView: (id) =>
        get().mutate((d) => {
          d.views = d.views.filter((x) => x.id !== id)
          d.views.forEach((v) => (v.sourceIds = v.sourceIds.filter((s) => s !== id)))
        }),
      upsertNote: (n) => get().mutate((d) => void (d.notes = upsertById(d.notes, n))),
      removeNote: (id) => get().mutate((d) => void (d.notes = d.notes.filter((x) => x.id !== id))),

      isDirty: () => {
        const { draft, baseVersionId, project } = get()
        const base = baseVersionId ? project.versions.find((v) => v.id === baseVersionId)?.schema : emptySchema(project.dialect)
        return stableStringify(base) !== stableStringify(draft)
      },
      commit: (message, author = 'local') => {
        const { project, draft } = get()
        const branch = project.branches.find((b) => b.id === project.currentBranchId)!
        const version: Version = {
          id: uid('ver_'),
          branchId: branch.id,
          parentId: branch.headVersionId ?? branch.forkedFromVersionId,
          message,
          author,
          createdAt: new Date().toISOString(),
          schema: clone(draft),
        }
        set({
          project: {
            ...project,
            versions: [...project.versions, version],
            branches: project.branches.map((b) => (b.id === branch.id ? { ...b, headVersionId: version.id } : b)),
          },
          baseVersionId: version.id,
        })
        return version
      },
      createBranch: (name, description, fromVersionId) => {
        const { project, baseVersionId } = get()
        const branch: Branch = {
          id: uid('br_'),
          name,
          description,
          color: BRANCH_COLORS[project.branches.length % BRANCH_COLORS.length],
          forkedFromVersionId: fromVersionId === undefined ? baseVersionId : fromVersionId,
          headVersionId: null,
          createdAt: new Date().toISOString(),
        }
        set({ project: { ...project, branches: [...project.branches, branch] } })
        get().checkoutBranch(branch.id)
        return branch
      },
      checkoutBranch: (branchId) => {
        const { project } = get()
        const { schema, versionId } = headSchema(project, branchId)
        set({ project: { ...project, currentBranchId: branchId }, draft: schema, baseVersionId: versionId, selection: null })
      },
      checkoutVersion: (versionId) => {
        const { project } = get()
        const v = project.versions.find((x) => x.id === versionId)
        if (!v) return
        set({ project: { ...project, currentBranchId: v.branchId }, draft: clone(v.schema), baseVersionId: v.id, selection: null })
      },
      discardDraft: () => {
        const { project, baseVersionId } = get()
        const base = baseVersionId ? project.versions.find((v) => v.id === baseVersionId)?.schema : undefined
        set({ draft: base ? clone(base) : emptySchema(project.dialect) })
      },
      setVersionGithubSha: (versionId, sha) =>
        set((s) => ({
          project: { ...s.project, versions: s.project.versions.map((v) => (v.id === versionId ? { ...v, githubSha: sha } : v)) },
        })),

      setGithub: (github) => {
        // Se recuerda solo en la pestaña actual (sessionStorage) para sobrevivir a una recarga.
        try {
          if (github) sessionStorage.setItem(GITHUB_SESSION_KEY, JSON.stringify(github))
          else sessionStorage.removeItem(GITHUB_SESSION_KEY)
        } catch {
          // sin sessionStorage: queda solo en memoria
        }
        set((s) => ({ project: { ...s.project, github } }))
      },
      upsertConnection: (c) =>
        set((s) => ({ project: { ...s.project, connections: [...s.project.connections.filter((x) => x.id !== c.id), c] } })),
      removeConnection: (id) =>
        set((s) => ({ project: { ...s.project, connections: s.project.connections.filter((x) => x.id !== id) } })),
    }),
    {
      name: 'db-tracker:project',
      // El vínculo con GitHub es solo de sesión: no se guarda junto al proyecto.
      partialize: (s) => ({ project: { ...s.project, github: undefined }, draft: s.draft, baseVersionId: s.baseVersionId }),
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Pick<ProjectState, 'project' | 'draft' | 'baseVersionId'>
        const withViews = (schema: Schema) => ({ ...schema, views: schema.views ?? [] })
        state.draft = withViews(state.draft)
        state.project.versions = state.project.versions.map((v) => ({ ...v, schema: withViews(v.schema) }))
        return state
      },
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<ProjectState>) }
        return { ...state, project: { ...state.project, github: readSessionGithub() } }
      },
    },
  ),
)

/** Selectores útiles */
export const useCurrentBranch = () =>
  useProjectStore((s) => s.project.branches.find((b) => b.id === s.project.currentBranchId)!)
