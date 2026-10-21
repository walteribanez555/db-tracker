// Cliente mínimo común para PostgreSQL (pg) y MySQL (mysql2).
// Seguridad: la contraseña solo vive en la configuración de la conexión; nunca se registra
// y se elimina de cualquier mensaje de error que se devuelva al cliente.
import mysql from 'mysql2/promise'
import pg from 'pg'

import { LIMITS, type ConnectionConfig } from './validation.ts'

export interface QueryOutcome<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number | null
}

export interface DbClient {
  dialect: ConnectionConfig['dialect']
  query<T = Record<string, unknown>>(sql: string, params?: unknown[], opts?: { timeoutMs?: number }): Promise<QueryOutcome<T>>
  serverVersion(): Promise<string>
  close(): Promise<void>
}

export class DbError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status = 502, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Mensaje de error seguro (sin contraseña) y con pistas en español para errores comunes. */
export function toDbError(err: unknown, cfg?: Pick<ConnectionConfig, 'password' | 'host' | 'port'>): DbError {
  // (cfg.password solo se usa para ocultarla del mensaje y saber si se indicó)
  if (err instanceof DbError) return err
  const e = (err ?? {}) as { message?: string; code?: string; errno?: number; errors?: { message?: string; code?: string }[] }
  // AggregateError (p. ej. localhost → ::1 y 127.0.0.1): mensaje vacío, los detalles van en `errors`.
  let msg = String(e.message || e.errors?.map((x) => x.message).filter(Boolean).join('; ') || e.code || 'Error desconocido')
  if (!e.code && e.errors?.[0]?.code) e.code = e.errors[0].code
  if (cfg?.password && cfg.password.length >= 3) msg = msg.split(cfg.password).join('••••')
  const code = e.code ?? e.errors?.[0]?.code
  const hints: Record<string, string> = {
    ECONNREFUSED: `No se pudo conectar a ${cfg?.host}:${cfg?.port} (conexión rechazada). ¿Está el servidor en marcha?`,
    ENOTFOUND: `No se encuentra el host ${cfg?.host}.`,
    ETIMEDOUT: `Tiempo de espera agotado al conectar con ${cfg?.host}:${cfg?.port}.`,
    '28P01': 'Usuario o contraseña incorrectos.',
    '28000': 'Acceso denegado para este usuario.',
    '3D000': 'La base de datos no existe.',
    '57014': 'La consulta superó el tiempo máximo y se canceló.',
    '25006': 'La operación intentó escribir dentro de una transacción de solo lectura.',
    ER_ACCESS_DENIED_ERROR: 'Usuario o contraseña incorrectos.',
    ER_BAD_DB_ERROR: 'La base de datos no existe.',
    PROTOCOL_SEQUENCE_TIMEOUT: 'La consulta superó el tiempo máximo.',
    ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION: 'La operación intentó escribir dentro de una transacción de solo lectura.',
  }
  let hint = code ? hints[code] : undefined
  if (!hint && /password must be a string|password authentication failed|no password supplied/i.test(msg))
    hint = cfg && !cfg.password ? 'El servidor pide contraseña y no se ha indicado ninguna.' : 'Usuario o contraseña incorrectos.'
  if (/timeout/i.test(msg) && !hint) msg = `Tiempo de espera agotado: ${msg}`
  return new DbError(hint ? (msg && msg !== code ? `${hint} (${msg})` : hint) : msg, 502, code)
}

async function connectPg(cfg: ConnectionConfig): Promise<DbClient> {
  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: LIMITS.connectTimeoutMs,
    statement_timeout: LIMITS.queryTimeoutMs,
    query_timeout: LIMITS.applyStatementTimeoutMs + 5_000,
    application_name: 'db-tracker',
  })
  // Sin este handler un corte de red tumbaría el proceso.
  client.on('error', () => {})
  await client.connect()
  return {
    dialect: 'postgresql',
    async query<T>(sql: string, params?: unknown[], opts?: { timeoutMs?: number }) {
      if (opts?.timeoutMs) await client.query(`SET statement_timeout = ${Math.floor(opts.timeoutMs)}`)
      const res = await client.query(sql, params as unknown[] | undefined)
      // Un texto con varias sentencias devuelve un array de resultados.
      const last = Array.isArray(res) ? res[res.length - 1] : res
      return { rows: (last?.rows ?? []) as T[], rowCount: last?.rowCount ?? null }
    },
    async serverVersion() {
      const r = await client.query<{ v: string }>('SELECT version() AS v')
      return r.rows[0]?.v ?? 'PostgreSQL'
    },
    async close() {
      await client.end().catch(() => {})
    },
  }
}

async function connectMysql(cfg: ConnectionConfig): Promise<DbClient> {
  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: LIMITS.connectTimeoutMs,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  conn.on('error', () => {})
  return {
    dialect: 'mysql',
    async query<T>(sql: string, params?: unknown[], opts?: { timeoutMs?: number }) {
      const [res] = await conn.query({ sql, values: params, timeout: opts?.timeoutMs ?? LIMITS.queryTimeoutMs })
      if (Array.isArray(res)) return { rows: res as T[], rowCount: res.length }
      const header = res as { affectedRows?: number }
      return { rows: [], rowCount: header.affectedRows ?? null }
    },
    async serverVersion() {
      const [rows] = await conn.query('SELECT VERSION() AS v')
      return `MySQL ${(rows as { v: string }[])[0]?.v ?? ''}`.trim()
    },
    async close() {
      await conn.end().catch(() => conn.destroy())
    },
  }
}

/** Abre una conexión, ejecuta `fn` y la cierra siempre. Los errores salen ya saneados. */
export async function withClient<T>(cfg: ConnectionConfig, fn: (c: DbClient) => Promise<T>): Promise<T> {
  let client: DbClient | undefined
  try {
    client = cfg.dialect === 'postgresql' ? await connectPg(cfg) : await connectMysql(cfg)
    return await fn(client)
  } catch (err) {
    throw toDbError(err, cfg)
  } finally {
    await client?.close()
  }
}

export const elapsed = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6
export const now = () => process.hrtime.bigint()
