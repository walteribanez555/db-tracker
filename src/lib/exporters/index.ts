// Contrato de exportadores. Implementación: feature "io".
// Otros módulos (github, triggers, versions) solo importan desde aquí.
// La exportación a imagen está en './image' (solo navegador) para no arrastrar html-to-image.
import type { Dialect, Project, Schema } from '@/types/schema'

import { generateDBML } from './dbml'
import { DIALECT_LABELS } from './dialects'
import { exportProjectJSON, exportSchemaJSON } from './json'
import { generateMarkdown } from './markdown'
import { generateMermaid } from './mermaid'
import { computeMigration, generateMigration } from './migration'
import { generatePrisma } from './prisma'
import { generateSQL, registerTriggerSQL, simpleTriggerSQL, type GenerateSQLOptions } from './sql'

export {
  generateSQL,
  generateDBML,
  generatePrisma,
  generateMermaid,
  generateMarkdown,
  generateMigration,
  computeMigration,
  exportProjectJSON,
  exportSchemaJSON,
  registerTriggerSQL,
  simpleTriggerSQL,
  DIALECT_LABELS,
}
export type { GenerateSQLOptions }
export type { MigrationResult, MigrationSummary } from './migration'
export type { ProjectBackup, SchemaDocument } from './json'

export type ExportFormat = 'sql' | 'dbml' | 'json' | 'prisma' | 'mermaid' | 'markdown'

export interface ExportResult {
  filename: string
  mime: string
  content: string
}

export interface ExportFormatInfo {
  id: ExportFormat
  label: string
  description: string
  extension: string
  mime: string
  /** Si el resultado depende del dialecto elegido. */
  usesDialect: boolean
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: 'sql', label: 'SQL (DDL)', description: 'CREATE TABLE, índices, FKs y comentarios', extension: 'sql', mime: 'text/sql', usesDialect: true },
  { id: 'dbml', label: 'DBML', description: 'Para dbdiagram.io y herramientas DBML', extension: 'dbml', mime: 'text/plain', usesDialect: false },
  { id: 'prisma', label: 'Prisma', description: 'schema.prisma con modelos y relaciones', extension: 'prisma', mime: 'text/plain', usesDialect: true },
  { id: 'mermaid', label: 'Mermaid', description: 'erDiagram para Markdown/GitHub', extension: 'mmd', mime: 'text/plain', usesDialect: false },
  { id: 'markdown', label: 'Markdown', description: 'Diccionario de datos', extension: 'md', mime: 'text/markdown', usesDialect: false },
  { id: 'json', label: 'JSON', description: 'Esquema en formato DB Tracker (reimportable)', extension: 'json', mime: 'application/json', usesDialect: false },
]

export interface ExportOptions {
  /** Nombre base del archivo (sin extensión). */
  name?: string
  dialect?: Dialect
  /** Título para Markdown / nombre de proyecto en DBML. */
  title?: string
  sql?: GenerateSQLOptions
}

const safeFile = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'schema'

export function exportSchema(schema: Schema, format: ExportFormat, opts: ExportOptions = {}): ExportResult {
  const name = safeFile(opts.name ?? 'schema')
  const dialect = opts.dialect ?? schema.dialect
  const info = EXPORT_FORMATS.find((f) => f.id === format) ?? EXPORT_FORMATS[0]
  const file = (content: string, suffix = ''): ExportResult => ({
    filename: `${name}${suffix}.${info.extension}`,
    mime: info.mime,
    content,
  })
  switch (format) {
    case 'json':
      return file(exportSchemaJSON(schema, opts.title ?? opts.name))
    case 'dbml':
      return file(generateDBML(schema, { projectName: opts.title }))
    case 'prisma':
      return { filename: 'schema.prisma', mime: info.mime, content: generatePrisma(schema, dialect) }
    case 'mermaid':
      return file(generateMermaid(schema))
    case 'markdown':
      return file(generateMarkdown(schema, { title: opts.title ? `Diccionario de datos · ${opts.title}` : undefined }))
    case 'sql':
    default:
      return file(generateSQL(schema, dialect, opts.sql), dialect === schema.dialect ? '' : `.${dialect}`)
  }
}

/** Migración entre dos esquemas como archivo descargable. */
export function exportMigration(from: Schema, to: Schema, dialect: Dialect, name = 'migracion'): ExportResult {
  return { filename: `${safeFile(name)}.${dialect}.sql`, mime: 'text/sql', content: generateMigration(from, to, dialect) }
}

/** Copia de seguridad del proyecto completo (ramas + versiones). */
export function exportProject(project: Project, draft?: Schema): ExportResult {
  return {
    filename: `${safeFile(project.name)}.dbtracker.json`,
    mime: 'application/json',
    content: exportProjectJSON(project, draft),
  }
}
