// Importador JSON: esquema de DB Tracker (suelto o envuelto) o copia de seguridad del proyecto.
import type { Dialect, Project, Schema } from '@/types/schema'

import { gridLayout } from './layout'
import { reidSchema, type ParseOptions } from './normalize'

export type JsonImport =
  | { kind: 'schema'; schema: Schema; warnings: string[]; name?: string }
  | { kind: 'project'; project: Project; draft?: Schema; schema: Schema; warnings: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Completa campos que puedan faltar en esquemas de versiones antiguas (p. ej. `views`). */
function completeSchema(s: unknown, dialect: Dialect): Schema {
  const o = (isObj(s) ? s : {}) as Partial<Schema>
  return {
    dialect: o.dialect ?? dialect,
    tables: o.tables ?? [],
    views: o.views ?? [],
    relations: o.relations ?? [],
    enums: o.enums ?? [],
    functions: o.functions ?? [],
    triggers: o.triggers ?? [],
    notes: o.notes ?? [],
  }
}

export function importJSON(text: string, dialect: Dialect = 'postgresql', opts: ParseOptions = {}): JsonImport {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`JSON inválido: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isObj(data)) throw new Error('El JSON no contiene un objeto.')

  // Copia de seguridad del proyecto (exportProjectJSON) o un Project "pelado".
  const projectLike = data.format === 'db-tracker/project' ? data.project : isObj(data.project) ? data.project : 'branches' in data && 'versions' in data ? data : null
  if (isObj(projectLike) && Array.isArray(projectLike.branches) && Array.isArray(projectLike.versions)) {
    const p = projectLike as unknown as Project
    if (!p.branches.length) throw new Error('El proyecto no tiene ramas.')
    const project: Project = {
      ...p,
      connections: p.connections ?? [],
      versions: p.versions.map((v) => ({ ...v, schema: completeSchema(v.schema, p.dialect ?? dialect) })),
      currentBranchId: p.branches.some((b) => b.id === p.currentBranchId) ? p.currentBranchId : p.branches[0].id,
    }
    const draft = isObj(data.draft) ? completeSchema(data.draft, project.dialect) : undefined
    const branch = project.branches.find((b) => b.id === project.currentBranchId)!
    const head = project.versions.find((v) => v.id === branch.headVersionId)
    return {
      kind: 'project',
      project,
      draft,
      schema: draft ?? head?.schema ?? completeSchema({}, project.dialect),
      warnings: [],
    }
  }

  // Esquema (envuelto por exportSchemaJSON o suelto).
  const raw = data.format === 'db-tracker/schema' ? data.schema : isObj(data.schema) ? data.schema : data
  if (!isObj(raw) || !Array.isArray(raw.tables)) throw new Error('No se reconoce el formato: falta la lista "tables".')
  if (opts.normalize === false) {
    // Solo parseo: ids originales; la normalización la hace quien llama (reidSchema).
    return { kind: 'schema', schema: completeSchema(raw, dialect), warnings: [], name: typeof data.name === 'string' ? data.name : undefined }
  }
  const { schema, hadPositions } = reidSchema(raw, dialect)
  if (!hadPositions && opts.layout !== false) gridLayout(schema)
  const warnings: string[] = []
  const lostRels = (Array.isArray(raw.relations) ? raw.relations.length : 0) - schema.relations.length
  if (lostRels > 0) warnings.push(`${lostRels} relación(es) apuntan a tablas o columnas inexistentes y se omitieron.`)
  return { kind: 'schema', schema, warnings, name: typeof data.name === 'string' ? data.name : undefined }
}
