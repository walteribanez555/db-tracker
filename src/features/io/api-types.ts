// Contrato HTTP de /api/db (lo comparten el cliente y server/routes/db.ts).
// Solo tipos: sin dependencias de runtime ni del DOM.
import type { QueryBenchmark } from '@/types/report'
import type { RemoteConnection, Schema } from '@/types/schema'

/** Datos de conexión que viajan al servidor (la contraseña nunca se persiste). */
export interface ConnectionPayload extends Omit<RemoteConnection, 'id' | 'name'> {
  password: string
}

export interface ApiError {
  ok: false
  error: string
  /** Código del motor (p. ej. 28P01, ER_ACCESS_DENIED_ERROR) cuando existe. */
  code?: string
}

export interface TestResponse {
  ok: true
  serverVersion: string
  latencyMs: number
  database: string
  user: string
}

export interface IntrospectRequest {
  connection: ConnectionPayload
  /** Esquema de PostgreSQL (por defecto 'public'). En MySQL se usa la base de datos. */
  schemaName?: string
}

/** Fase de la introspección con su tiempo real en el servidor. */
export interface IntrospectPhase {
  id: 'connect' | 'tables' | 'columns' | 'keys' | 'relations' | 'indexes' | 'views' | 'routines' | 'build'
  ms: number
}

export interface IntrospectResponse {
  ok: true
  /** Tiempos por fase (la de relaciones solo existe en MySQL; en Postgres van con las claves). */
  phases?: IntrospectPhase[]
  schema: Schema
  warnings: string[]
  serverVersion: string
  durationMs: number
  stats: {
    tables: number
    views: number
    relations: number
    enums: number
    functions: number
    triggers: number
    /** Filas estimadas por tabla (estadísticas del motor, no COUNT(*)). */
    rowEstimates: Record<string, number>
  }
}

export interface ApplyRequest {
  connection: ConnectionPayload
  sql: string
  confirm: true
  /** Solo PostgreSQL: ejecuta todo y hace ROLLBACK (validación sin cambios). */
  dryRun?: boolean
}

export interface ApplyStatementResult {
  index: number
  statement: string
  ms: number
  rowCount: number | null
}

export interface ApplyResponse {
  ok: boolean
  /** true si todo se ejecutó dentro de una transacción (PostgreSQL). */
  transactional: boolean
  committed: boolean
  dryRun: boolean
  totalMs: number
  executed: ApplyStatementResult[]
  failed?: { index: number; statement: string; error: string; code?: string }
  notes: string[]
}

export interface SampleQuery {
  label: string
  query: string
  kind: 'scan' | 'count' | 'join' | 'filter' | 'aggregate' | 'view'
}

export interface SampleQueriesRequest {
  schema: Schema
  dialect: 'postgresql' | 'mysql'
  limit?: number
}

export interface SampleQueriesResponse {
  ok: true
  queries: SampleQuery[]
}

export interface BenchmarkRequest {
  connection: ConnectionPayload
  queries: { label: string; query: string }[]
  /** Repeticiones medidas por consulta (1–50). */
  runs?: number
  /** Ejecuta EXPLAIN ANALYZE una vez por consulta y devuelve el plan. */
  explain?: boolean
  /** Versión a la que se atribuyen las mediciones. */
  versionId: string
}

export interface BenchmarkDetail {
  label: string
  query: string
  minMs: number
  maxMs: number
  medianMs: number
  rows: number | null
  plan?: string
  error?: string
}

export interface BenchmarkResponse {
  ok: true
  results: QueryBenchmark[]
  details: BenchmarkDetail[]
  totalMs: number
  /** true si se cortó por el presupuesto de tiempo. */
  truncated: boolean
}
