// API pública de importadores.
import type { Dialect, Project, Schema } from '@/types/schema'

import type { ParseOptions } from './normalize'

import { importDBML, importWithDbmlCore } from './dbml'
import { importJSON } from './json'
import { detectSQLDialect, importSQL } from './sql'

export { importSQL, detectSQLDialect } from './sql'
export { importDBML, importWithDbmlCore, dbmlJsonToSchema } from './dbml'
export { importJSON } from './json'
export { gridLayout } from './layout'
export { reidSchema } from './normalize'
export { splitStatements } from './split'
export { inferViewColumns, resolveViewSources, orderViews } from './views'

export type ImportFormat = 'dbml' | 'sql' | 'json'

export interface ImportResult {
  format: ImportFormat
  schema: Schema
  warnings: string[]
  /** Solo para copias de seguridad de proyecto (JSON). */
  project?: Project
  projectDraft?: Schema
  /** Nombre sugerido (p. ej. el del archivo o el guardado en el JSON). */
  name?: string
}

export const IMPORT_FORMATS: { id: ImportFormat; label: string; extensions: string[] }[] = [
  { id: 'sql', label: 'SQL (DDL)', extensions: ['sql', 'ddl', 'psql', 'mysql'] },
  { id: 'dbml', label: 'DBML', extensions: ['dbml'] },
  { id: 'json', label: 'JSON (DB Tracker)', extensions: ['json'] },
]

/** Detecta el formato por extensión y, si no, por contenido. */
export function detectFormat(text: string, filename?: string): ImportFormat {
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (ext) {
    const hit = IMPORT_FORMATS.find((f) => f.extensions.includes(ext))
    if (hit) return hit.id
  }
  const t = text.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) return 'json'
  if (/^\s*(Table|Enum|Ref|Project|TableGroup)\b[^;]*\{/m.test(text) && !/\bCREATE\s+TABLE\b/i.test(text)) return 'dbml'
  return 'sql'
}

export type { ParseOptions } from './normalize'

/**
 * Importa texto a un Schema. Con `opts` se pueden saltar el posicionado (`layout: false`) y,
 * en JSON, la regeneración de ids (`normalize: false`) para hacerlos como pasos separados.
 */
export async function importSchema(
  text: string,
  format: ImportFormat = detectFormat(text),
  dialect?: Dialect,
  opts: ParseOptions = {},
): Promise<ImportResult> {
  if (!text.trim()) throw new Error('El contenido está vacío.')
  switch (format) {
    case 'json': {
      const r = importJSON(text, dialect, opts)
      return r.kind === 'project'
        ? { format, schema: r.schema, warnings: r.warnings, project: r.project, projectDraft: r.draft, name: r.project.name }
        : { format, schema: r.schema, warnings: r.warnings, name: r.name }
    }
    case 'dbml': {
      const r = await importDBML(text, dialect, opts)
      return { format, ...r }
    }
    case 'sql': {
      const r = importSQL(text, dialect, opts)
      if (r.schema.tables.length || r.schema.enums.length || r.schema.views.length) {
        return { format, schema: r.schema, warnings: r.warnings }
      }
      // Alternativa: el parser de @dbml/core (más estricto pero cubre otras sintaxis).
      const d = dialect ?? detectSQLDialect(text)
      try {
        const alt = await importWithDbmlCore(text, d === 'mysql' ? 'mysql' : d === 'sqlserver' ? 'mssql' : 'postgres', d, opts)
        return { format, schema: alt.schema, warnings: ['Se usó el parser de @dbml/core.', ...alt.warnings] }
      } catch {
        return { format, schema: r.schema, warnings: r.warnings.length ? r.warnings : ['No se encontró ninguna sentencia CREATE TABLE.'] }
      }
    }
  }
}
