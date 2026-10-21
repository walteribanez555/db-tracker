// Esquemas zod de las peticiones a /api/db.
import { z } from 'zod'

export const LIMITS = {
  connectTimeoutMs: 8_000,
  /** Timeout por sentencia en introspección y pruebas. */
  queryTimeoutMs: 20_000,
  /** Timeout por sentencia al aplicar migraciones. */
  applyStatementTimeoutMs: 120_000,
  maxApplySqlBytes: 1_000_000,
  maxApplyStatements: 2_000,
  maxBenchmarkQueries: 20,
  maxBenchmarkRuns: 50,
  maxQueryChars: 20_000,
  benchmarkTimeoutMs: 15_000,
  /** Presupuesto total de un benchmark. */
  benchmarkBudgetMs: 90_000,
  maxTables: 1_000,
} as const

export const connectionSchema = z.object({
  dialect: z.enum(['postgresql', 'mysql']),
  host: z.string().trim().min(1, 'Falta el host').max(255),
  port: z.coerce.number().int().min(1).max(65_535),
  database: z.string().trim().min(1, 'Falta la base de datos').max(128),
  user: z.string().trim().min(1, 'Falta el usuario').max(128),
  password: z.string().max(1_024).default(''),
  ssl: z.boolean().default(false),
})
export type ConnectionConfig = z.infer<typeof connectionSchema>

export const testSchema = z.object({ connection: connectionSchema })

export const introspectSchema = z.object({
  connection: connectionSchema,
  schemaName: z
    .string()
    .trim()
    .max(128)
    .regex(/^[^\0]*$/)
    .optional(),
})

export const applySchema = z.object({
  connection: connectionSchema,
  sql: z.string().min(1, 'No hay SQL que aplicar').max(LIMITS.maxApplySqlBytes, 'El SQL es demasiado grande (máx. 1 MB)'),
  confirm: z.literal(true, { error: 'Se requiere confirmación explícita (confirm: true)' }),
  dryRun: z.boolean().optional(),
})

export const benchmarkSchema = z.object({
  connection: connectionSchema,
  queries: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        query: z.string().trim().min(1).max(LIMITS.maxQueryChars),
      }),
    )
    .min(1, 'Indica al menos una consulta')
    .max(LIMITS.maxBenchmarkQueries, `Máximo ${LIMITS.maxBenchmarkQueries} consultas`),
  runs: z.coerce.number().int().min(1).max(LIMITS.maxBenchmarkRuns).default(5),
  explain: z.boolean().default(false),
  versionId: z.string().min(1).max(200),
})

const columnLite = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  pk: z.boolean().optional(),
  unique: z.boolean().optional(),
})

export const sampleQueriesSchema = z.object({
  dialect: z.enum(['postgresql', 'mysql']),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  schema: z.looseObject({
    tables: z
      .array(
        z.looseObject({
          id: z.string(),
          name: z.string(),
          columns: z.array(columnLite),
          indexes: z.array(z.looseObject({ name: z.string().optional(), columnIds: z.array(z.string()), unique: z.boolean().optional() })).default([]),
        }),
      )
      .max(LIMITS.maxTables),
    relations: z
      .array(
        z.looseObject({
          sourceTableId: z.string(),
          sourceColumnId: z.string(),
          targetTableId: z.string(),
          targetColumnId: z.string(),
        }),
      )
      .default([]),
    views: z.array(z.looseObject({ name: z.string() })).default([]),
  }),
})
export type SampleSchemaInput = z.infer<typeof sampleQueriesSchema>['schema']
