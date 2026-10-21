// Copia de seguridad JSON: esquema suelto o proyecto completo con ramas y versiones.
import type { Project, Schema } from '@/types/schema'

export const BACKUP_FORMAT = 'db-tracker/project'
export const SCHEMA_FORMAT = 'db-tracker/schema'
export const BACKUP_VERSION = 1

export interface ProjectBackup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  project: Project
  /** Borrador sin confirmar en el momento de exportar (opcional). */
  draft?: Schema
}

export interface SchemaDocument {
  format: typeof SCHEMA_FORMAT
  version: number
  exportedAt: string
  name?: string
  schema: Schema
}

export function exportSchemaJSON(schema: Schema, name?: string): string {
  const doc: SchemaDocument = { format: SCHEMA_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), name, schema }
  return JSON.stringify(doc, null, 2)
}

/** Proyecto completo (ramas, versiones, conexiones sin contraseñas, vínculo de GitHub). */
export function exportProjectJSON(project: Project, draft?: Schema): string {
  const backup: ProjectBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // Las conexiones nunca llevan contraseña (el tipo no la incluye), pero filtramos por si acaso.
    project: {
      ...project,
      connections: project.connections.map(({ id, name, dialect, host, port, database, user, ssl }) => ({
        id,
        name,
        dialect,
        host,
        port,
        database,
        user,
        ssl,
      })),
    },
    draft,
  }
  return JSON.stringify(backup, null, 2)
}
