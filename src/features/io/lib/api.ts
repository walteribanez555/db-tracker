// Cliente de /api/db. Funciona igual en web (proxy de Vite) y escritorio (Hono en 127.0.0.1).
import type { RemoteConnection, Schema } from '@/types/schema'

import type {
  ApiError,
  ApplyResponse,
  BenchmarkRequest,
  BenchmarkResponse,
  ConnectionPayload,
  IntrospectResponse,
  SampleQueriesResponse,
  TestResponse,
} from '../api-types'

export class ApiRequestError extends Error {
  readonly code?: string
  readonly status: number
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/db${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiRequestError('No se pudo contactar con el servidor local de DB Tracker (¿está en marcha `npm run dev:api`?).', 0)
  }
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | ApiError | null
  // /apply devuelve 422 con un ApplyResponse cuando falla una sentencia: se entrega tal cual.
  if (res.status === 422 && data && 'executed' in data) return data as T
  if (!res.ok || !data || (data as ApiError).ok === false) {
    const err = data as ApiError | null
    throw new ApiRequestError(err?.error ?? `Error ${res.status}`, res.status, err?.code)
  }
  return data as T
}

export const toPayload = (c: RemoteConnection, password: string): ConnectionPayload => ({
  dialect: c.dialect,
  host: c.host,
  port: c.port,
  database: c.database,
  user: c.user,
  ssl: c.ssl,
  password,
})

export const dbApi = {
  test: (connection: ConnectionPayload, signal?: AbortSignal) => post<TestResponse>('/test', { connection }, signal),
  introspect: (connection: ConnectionPayload, schemaName?: string, signal?: AbortSignal) =>
    post<IntrospectResponse>('/introspect', { connection, schemaName }, signal),
  apply: (connection: ConnectionPayload, sql: string, opts: { dryRun?: boolean } = {}) =>
    post<ApplyResponse>('/apply', { connection, sql, confirm: true, dryRun: opts.dryRun }),
  sampleQueries: (schema: Schema, dialect: 'postgresql' | 'mysql', limit = 12) =>
    post<SampleQueriesResponse>('/sample-queries', { schema, dialect, limit }),
  benchmark: (req: BenchmarkRequest, signal?: AbortSignal) => post<BenchmarkResponse>('/benchmark', req, signal),
}
