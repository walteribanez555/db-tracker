// DDL y migraciones de versiones para las vistas de código (CodeEditor / CodeDiff).
import { generateMigration, generateSQL } from '@/lib/exporters'
import { emptySchema } from '@/store/project'
import type { Project, Schema, Version } from '@/types/schema'

/** DDL completo sin cabecera con fecha (para que los diffs solo muestren cambios reales). */
export const ddlOf = (schema: Schema) => generateSQL(schema, schema.dialect, { header: false })

/** SQL de migración desde la versión padre (o desde un esquema vacío). */
export function migrationFromParent(project: Project, v: Version): string {
  const parent = v.parentId ? project.versions.find((x) => x.id === v.parentId) : undefined
  return generateMigration(parent?.schema ?? emptySchema(project.dialect), v.schema, project.dialect)
}
