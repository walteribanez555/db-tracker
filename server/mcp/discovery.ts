// Descubrimiento del servidor local para clientes MCP: token en `<dataDir>/mcp-token` y URL efectiva en
// `<dataDir>/server.json` (+ puntero global `~/.dbtracker/server.json`, para que el puente stdio lo encuentre
// sin saber dónde está dataDir). Sin dependencias pesadas: lo usa también server/mcp/stdio.ts.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const TOKEN_FILE = 'mcp-token'
export const SERVER_FILE = 'server.json'

export interface ServerFile {
  /** URL base del listener local (http://127.0.0.1:PUERTO). */
  url: string
  /** Endpoint MCP (Streamable HTTP). */
  mcpUrl: string
  pid: number
  /** Solo en el puntero global y en server.json: dónde están el token y las salas. */
  dataDir?: string
  tokenFile?: string
  runtime?: 'web' | 'desktop'
  updatedAt?: string
}

/** Carpeta del puntero global (~/.dbtracker). DBTRACKER_HOME la cambia (pruebas). */
export const globalDir = () => process.env.DBTRACKER_HOME || path.join(os.homedir(), '.dbtracker')

function writeAtomic(file: string, content: string, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, content, { mode })
  renameSync(tmp, file)
  try {
    chmodSync(file, mode)
  } catch {
    /* Windows */
  }
}

/* ───────────────────────── Token ───────────────────────── */

export const newToken = () => `dbt_${randomBytes(32).toString('base64url')}`

/** Lee el token de `<dataDir>/mcp-token`; si no existe (o está vacío) lo crea. */
export function ensureToken(dataDir: string): string {
  const file = path.join(dataDir, TOKEN_FILE)
  try {
    const token = readFileSync(file, 'utf8').trim()
    if (token.length >= 16) return token
  } catch {
    /* no existe */
  }
  const token = newToken()
  writeAtomic(file, `${token}\n`)
  return token
}

export function writeToken(dataDir: string, token: string) {
  writeAtomic(path.join(dataDir, TOKEN_FILE), `${token}\n`)
}

export function readTokenFile(file: string): string | null {
  try {
    const token = readFileSync(file, 'utf8').trim()
    return token || null
  } catch {
    return null
  }
}

/** Comparación en tiempo constante del token Bearer. */
export function tokenMatches(header: string | undefined | null, token: string) {
  const m = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '')
  if (!m) return false
  const a = Buffer.from(m[1].trim())
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Pista visible del token (nunca el token completo). */
export const tokenHint = (token: string) => `${token.slice(0, 4)}…${token.slice(-4)}`

/* ───────────────────────── server.json ───────────────────────── */

export function writeServerFiles(dataDir: string, info: Omit<ServerFile, 'pid' | 'updatedAt' | 'dataDir' | 'tokenFile'>) {
  const full: ServerFile = {
    ...info,
    pid: process.pid,
    dataDir,
    tokenFile: path.join(dataDir, TOKEN_FILE),
    updatedAt: new Date().toISOString(),
  }
  const json = `${JSON.stringify(full, null, 2)}\n`
  writeAtomic(path.join(dataDir, SERVER_FILE), json, 0o644)
  try {
    writeAtomic(path.join(globalDir(), SERVER_FILE), json, 0o644)
  } catch (err) {
    console.warn(`[mcp] No se pudo escribir el puntero global ${globalDir()}: ${(err as Error).message}`)
  }
}

/** Borra server.json (local y global) si los escribió este proceso. Síncrono: se llama al salir. */
export function removeServerFiles(dataDir: string) {
  for (const file of [path.join(dataDir, SERVER_FILE), path.join(globalDir(), SERVER_FILE)]) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as ServerFile
      if (data.pid === process.pid) unlinkSync(file)
    } catch {
      /* no existe o no es nuestro */
    }
  }
}

export function readServerFile(file: string): ServerFile | null {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as ServerFile
    return typeof data?.mcpUrl === 'string' ? data : null
  } catch {
    return null
  }
}

export function pidAlive(pid: number | undefined) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface ResolvedEndpoint {
  mcpUrl: string
  token: string
  /** De dónde salió (para los mensajes del puente). */
  source: string
}

/**
 * Busca la URL y el token: variables DBTRACKER_MCP_URL / DBTRACKER_MCP_TOKEN; si no, server.json de
 * DBTRACKER_DATA_DIR, del puntero global (~/.dbtracker) o de ./.dbtracker-data. Prefiere los de un proceso vivo.
 */
export function resolveEndpoint(): ResolvedEndpoint | null {
  const envUrl = process.env.DBTRACKER_MCP_URL?.trim()
  const envToken = process.env.DBTRACKER_MCP_TOKEN?.trim()
  if (envUrl && envToken) return { mcpUrl: envUrl, token: envToken, source: 'variables de entorno' }

  const candidates: string[] = []
  if (process.env.DBTRACKER_DATA_DIR) candidates.push(path.join(path.resolve(process.env.DBTRACKER_DATA_DIR), SERVER_FILE))
  candidates.push(path.join(globalDir(), SERVER_FILE))
  candidates.push(path.resolve('.dbtracker-data', SERVER_FILE))

  const found = candidates
    .filter((f, i) => candidates.indexOf(f) === i && existsSync(f))
    .map((file) => ({ file, data: readServerFile(file) }))
    .filter((x): x is { file: string; data: ServerFile } => !!x.data)
  const best = found.find((x) => pidAlive(x.data.pid)) ?? found[0]
  if (!best) return null
  const tokenFile = best.data.tokenFile ?? path.join(path.dirname(best.file), TOKEN_FILE)
  const token = envToken || readTokenFile(tokenFile)
  if (!token) return null
  return { mcpUrl: envUrl || best.data.mcpUrl, token, source: best.file }
}
