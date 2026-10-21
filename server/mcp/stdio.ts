// Puente stdio → HTTP para clientes MCP que solo hablan stdio (p. ej. Claude Desktop):
//   { "command": "node", "args": ["<repo>/dist-mcp/stdio.mjs"] }
//
// Es un Server MCP por stdio que reenvía cada petición, con un Client MCP, al endpoint Streamable HTTP de
// DB Tracker (/mcp). La URL y el token salen de DBTRACKER_MCP_URL / DBTRACKER_MCP_TOKEN o de server.json
// (DBTRACKER_DATA_DIR, ~/.dbtracker/server.json o ./.dbtracker-data).
// - `initialize` se responde aquí: el cliente arranca aunque la app aún no esté abierta.
// - Si la app no responde, se reintenta (y se relee server.json: el puerto o el token pueden cambiar) hasta
//   RETRY_MS; después la petición falla con un mensaje claro. Cuando la app aparece se avisa con list_changed.
// - La lista de herramientas se cachea en ~/.dbtracker/tools-cache.json para ofrecerla con la app cerrada.
// stdout es el protocolo: los registros van a stderr.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'

import { globalDir, resolveEndpoint, type ResolvedEndpoint } from './discovery.ts'
import { MCP_INSTRUCTIONS, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './meta.ts'

const RETRY_MS = Number(process.env.DBTRACKER_MCP_WAIT_MS ?? 30_000)
const RETRY_EVERY_MS = 1_500
const BACKGROUND_EVERY_MS = 5_000
/** Herramientas largas (session_open espera 20 s; db_benchmark puede tardar 90 s). */
const CALL_TIMEOUT_MS = 10 * 60_000
const CACHE_FILE = path.join(globalDir(), 'tools-cache.json')

const log = (msg: string) => process.stderr.write(`[dbtracker-mcp] ${msg}\n`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let client: Client | null = null
let connecting: Promise<Client> | null = null
let lastProblem = ''
/** Se sirvió algo sin la app (caché o error): al conectar se avisa con list_changed. */
let needsNotify = false

function describe(err: unknown) {
  const e = err as { message?: string; code?: unknown; cause?: { code?: string } }
  if (e?.cause?.code === 'ECONNREFUSED') return 'conexión rechazada'
  if (/401|unauthori[sz]ed|token/i.test(e?.message ?? '')) return 'token rechazado (¿se regeneró? cópialo de nuevo o reinicia el puente)'
  return e?.message ?? String(err)
}

async function connectOnce(ep: ResolvedEndpoint): Promise<Client> {
  const c = new Client({ name: 'dbtracker-stdio-bridge', version: MCP_SERVER_VERSION })
  const transport = new StreamableHTTPClientTransport(new URL(ep.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${ep.token}` } },
  })
  await c.connect(transport)
  return c
}

/** Un intento de conexión (compartido si ya hay uno en curso). */
function attempt(): Promise<Client> {
  connecting ??= (async () => {
    const ep = resolveEndpoint()
    if (!ep) {
      lastProblem = 'no se encuentra server.json ni DBTRACKER_MCP_URL/DBTRACKER_MCP_TOKEN'
      throw new Error(lastProblem)
    }
    try {
      const c = await connectOnce(ep)
      client = c
      lastProblem = ''
      log(`Conectado a ${ep.mcpUrl} (configuración: ${ep.source}).`)
      if (needsNotify) {
        needsNotify = false
        notifyListsChanged()
      }
      return c
    } catch (err) {
      lastProblem = `${ep.mcpUrl}: ${describe(err)}`
      throw err
    }
  })().finally(() => {
    connecting = null
  })
  return connecting
}

/** Cliente conectado a la app; reintenta hasta `waitMs` releyendo server.json en cada intento. */
async function getClient(waitMs: number): Promise<Client> {
  const deadline = Date.now() + waitMs
  for (;;) {
    if (client) return client
    try {
      return await attempt()
    } catch {
      if (Date.now() >= deadline) {
        needsNotify = true
        throw new McpError(
          ErrorCode.ConnectionClosed,
          `DB Tracker no está disponible (${lastProblem}). Abre la app de escritorio o ejecuta «npm run dev» en el repositorio y vuelve a intentarlo.`,
        )
      }
      await sleep(RETRY_EVERY_MS)
    }
  }
}

/** Error de transporte (no un error JSON-RPC devuelto por el servidor): hay que reconectar. */
const isTransportError = (err: unknown) => !(err instanceof McpError) || err.code === ErrorCode.ConnectionClosed

async function forward<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await getClient(RETRY_MS)
  try {
    return await fn(c)
  } catch (err) {
    if (!isTransportError(err)) throw err
    // La app se reinició (otro puerto o token): se reconecta y se repite una vez.
    log(`Conexión perdida (${describe(err)}); reconectando…`)
    if (client === c) client = null
    void c.close().catch(() => undefined)
    return fn(await getClient(RETRY_MS))
  }
}

/* ───────────────────────── Caché de herramientas ───────────────────────── */

function readCache(): ListToolsResult | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as ListToolsResult
  } catch {
    return null
  }
}

function writeCache(result: ListToolsResult) {
  try {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify({ tools: result.tools }))
  } catch {
    /* sin caché */
  }
}

/* ───────────────────────── Servidor stdio ───────────────────────── */

const server = new Server(
  { name: MCP_SERVER_NAME, title: 'DB Tracker', version: MCP_SERVER_VERSION },
  {
    instructions: MCP_INSTRUCTIONS,
    capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true }, completions: {} },
  },
)

function notifyListsChanged() {
  void server.sendToolListChanged().catch(() => undefined)
  void server.sendResourceListChanged().catch(() => undefined)
  void server.sendPromptListChanged().catch(() => undefined)
}

server.setRequestHandler(ListToolsRequestSchema, async (req) => {
  try {
    const result = await forward((c) => c.listTools(req.params))
    writeCache(result)
    return result
  } catch (err) {
    const cached = readCache()
    if (cached) {
      log('La app no responde: se ofrece la lista de herramientas en caché.')
      startBackgroundReconnect()
      return cached
    }
    throw err
  }
})
server.setRequestHandler(CallToolRequestSchema, (req) =>
  forward((c) => c.callTool(req.params, undefined, { timeout: CALL_TIMEOUT_MS, resetTimeoutOnProgress: true })),
)
server.setRequestHandler(ListResourcesRequestSchema, (req) => forward((c) => c.listResources(req.params)))
server.setRequestHandler(ListResourceTemplatesRequestSchema, (req) => forward((c) => c.listResourceTemplates(req.params)))
server.setRequestHandler(ReadResourceRequestSchema, (req) => forward((c) => c.readResource(req.params)))
server.setRequestHandler(ListPromptsRequestSchema, (req) => forward((c) => c.listPrompts(req.params)))
server.setRequestHandler(GetPromptRequestSchema, (req) => forward((c) => c.getPrompt(req.params)))
server.setRequestHandler(CompleteRequestSchema, (req) => forward((c) => c.complete(req.params)))

let background: ReturnType<typeof setInterval> | null = null
/** Con la app cerrada se sigue intentando en segundo plano; al conectar se avisa al cliente (list_changed). */
function startBackgroundReconnect() {
  if (background) return
  background = setInterval(() => {
    if (client) {
      clearInterval(background!)
      background = null
      return
    }
    attempt().catch(() => undefined)
  }, BACKGROUND_EVERY_MS)
  background.unref()
}

const transport = new StdioServerTransport()
transport.onclose = () => process.exit(0)
await server.connect(transport)
log('Puente stdio listo.')
// Primer intento sin bloquear el arranque.
attempt().catch(() => {
  needsNotify = true
  log(`DB Tracker aún no está disponible (${lastProblem}); se reintentará al recibir peticiones.`)
  startBackgroundReconnect()
})
