// Rutas montadas en /api/db: probar conexión, introspección, aplicar SQL, benchmarks y consultas de ejemplo.
// Seguridad: nunca se registra el cuerpo de las peticiones (contiene contraseñas) y los mensajes
// de error se sanean antes de devolverse.
import { Hono, type Context } from 'hono'
import type { z } from 'zod'

import type {
  ApiError,
  IntrospectResponse,
  SampleQueriesResponse,
  TestResponse,
} from '../../src/features/io/api-types.ts'
import { applySQL } from '../lib/db/apply.ts'
import { runBenchmark } from '../lib/db/benchmark.ts'
import { DbError, elapsed, now, toDbError, withClient } from '../lib/db/client.ts'
import { introspectMysql } from '../lib/db/introspect-mysql.ts'
import { introspectPostgres } from '../lib/db/introspect-pg.ts'
import { suggestQueries } from '../lib/db/samples.ts'
import {
  applySchema,
  benchmarkSchema,
  introspectSchema,
  sampleQueriesSchema,
  testSchema,
} from '../lib/db/validation.ts'

export const dbRoutes = new Hono()

dbRoutes.onError((err, c) => {
  const e = err instanceof DbError ? err : toDbError(err)
  // Solo método, ruta y mensaje saneado (sin cuerpo ni credenciales).
  if (e.status >= 500 && e.status !== 502) console.error(`[db] ${c.req.method} ${c.req.path}: ${e.message}`)
  const body: ApiError = { ok: false, error: e.message, ...(e.code ? { code: e.code } : {}) }
  return c.json(body, e.status as 400)
})

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => {
    throw new DbError('El cuerpo de la petición no es JSON válido.', 400)
  })
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new DbError(`Datos no válidos (${issue.path.join('.') || 'cuerpo'}): ${issue.message}`, 400)
  }
  return parsed.data
}

dbRoutes.post('/test', async (c) => {
  const { connection } = await parseBody(c, testSchema)
  const t0 = now()
  const res = await withClient(connection, async (client) => {
    const serverVersion = await client.serverVersion()
    return { serverVersion }
  })
  const body: TestResponse = {
    ok: true,
    serverVersion: res.serverVersion,
    latencyMs: Math.round(elapsed(t0)),
    database: connection.database,
    user: connection.user,
  }
  return c.json(body)
})

dbRoutes.post('/introspect', async (c) => {
  const { connection, schemaName } = await parseBody(c, introspectSchema)
  const t0 = now()
  const out = await withClient(connection, async (client) => {
    const serverVersion = await client.serverVersion()
    const connectMs = Math.round(elapsed(t0) * 10) / 10
    const r =
      client.dialect === 'postgresql'
        ? await introspectPostgres(client, schemaName || 'public')
        : await introspectMysql(client, connection.database)
    return { ...r, serverVersion, phases: [{ id: 'connect' as const, ms: connectMs }, ...r.phases] }
  })
  const s = out.schema
  if (!s.tables.length && !s.views.length)
    out.warnings.unshift(
      connection.dialect === 'postgresql'
        ? `El esquema "${schemaName || 'public'}" no tiene tablas visibles para este usuario.`
        : `La base de datos "${connection.database}" no tiene tablas visibles para este usuario.`,
    )
  const body: IntrospectResponse = {
    ok: true,
    phases: out.phases,
    schema: s,
    warnings: out.warnings,
    serverVersion: out.serverVersion,
    durationMs: Math.round(elapsed(t0)),
    stats: {
      tables: s.tables.length,
      views: s.views.length,
      relations: s.relations.length,
      enums: s.enums.length,
      functions: s.functions.length,
      triggers: s.triggers.length,
      rowEstimates: out.rowEstimates,
    },
  }
  return c.json(body)
})

dbRoutes.post('/apply', async (c) => {
  const { connection, sql, dryRun } = await parseBody(c, applySchema)
  const res = await withClient(connection, (client) => applySQL(client, sql, { dryRun }))
  return c.json(res, res.ok ? 200 : 422)
})

dbRoutes.post('/benchmark', async (c) => {
  const { connection, ...input } = await parseBody(c, benchmarkSchema)
  const res = await withClient(connection, (client) => runBenchmark(client, input))
  return c.json(res)
})

dbRoutes.post('/sample-queries', async (c) => {
  const { schema, dialect, limit } = await parseBody(c, sampleQueriesSchema)
  const body: SampleQueriesResponse = { ok: true, queries: suggestQueries(schema, dialect, limit) }
  return c.json(body)
})
