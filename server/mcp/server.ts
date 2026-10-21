// Fábrica del servidor MCP y rutas HTTP (solo en el listener local, nunca en el de red).
//
// Modo SIN ESTADO (sin Mcp-Session-Id): cada POST /mcp crea un McpServer + transporte y responde en JSON.
// - En desarrollo `tsx watch` reinicia el proceso a menudo: sin sesiones, los clientes (Claude Code, el
//   puente stdio) no se quedan con un Mcp-Session-Id caducado ni tienen que reinicializar.
// - La identidad de cada agente va en el parámetro `agent` de las herramientas (no en la conexión), y el
//   estado vive en la sala Yjs: no hay nada que guardar por sesión MCP.
// - No se ofrece el stream SSE de GET (405): el servidor no envía notificaciones espontáneas.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono, type Context, type MiddlewareHandler } from 'hono'

import { isTrustedLocalRequest } from '../collab/network.ts'
import { tokenHint } from './discovery.ts'
import { MCP_INSTRUCTIONS, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './meta.ts'
import { registerPrompts, registerResources } from './resources.ts'
import type { McpService } from './service.ts'
import { registerTools } from './tools.ts'

export function createMcpServer(service: McpService) {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: 'DB Tracker', version: MCP_SERVER_VERSION },
    { instructions: MCP_INSTRUCTIONS, capabilities: { tools: {}, resources: {}, prompts: {} } },
  )
  registerTools(server, service)
  registerResources(server, service)
  registerPrompts(server)
  return server
}

const rpcError = (c: Context, status: 401 | 403 | 405, code: number, message: string, headers?: Record<string, string>) =>
  c.json({ jsonrpc: '2.0', error: { code, message }, id: null }, status, headers)

/** Manejador de /mcp (POST; GET y DELETE → 405 en modo sin estado). */
export function mcpHandler(service: McpService) {
  return async (c: Context) => {
    // Mismas protecciones que /api/collab "solo loopback": socket local, Host local y Origin local o ausente.
    if (!isTrustedLocalRequest(c)) return rpcError(c, 403, -32000, 'El servidor MCP solo acepta conexiones desde este equipo.')
    if (!service.checkAuth(c.req.header('authorization'))) {
      return rpcError(c, 401, -32001, 'Token MCP no válido o ausente (Authorization: Bearer <token>). Cópialo en DB Tracker → Conectar agentes.', {
        'WWW-Authenticate': 'Bearer realm="dbtracker"',
      })
    }
    if (c.req.method !== 'POST') {
      return rpcError(c, 405, -32000, 'Método no permitido: este servidor MCP no usa sesiones ni stream SSE (solo POST).', { Allow: 'POST' })
    }
    const server = createMcpServer(service)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      void server.close().catch(() => undefined)
    }
  }
}

/** /api/mcp: información y token para la UI (solo loopback). */
export function mcpApiRoutes(service: McpService) {
  const r = new Hono()
  const localOnly: MiddlewareHandler = async (c, next) => {
    if (!isTrustedLocalRequest(c)) return c.json({ ok: false, error: 'Solo disponible desde este equipo.' }, 403)
    await next()
  }
  r.use('*', localOnly)
  r.get('/info', (c) => c.json(service.info()))
  // El token completo solo lo pide la UI (loopback + Host/Origin locales) para mostrarlo y copiarlo.
  r.get('/token', (c) => c.json({ token: service.token, tokenHint: tokenHint(service.token) }))
  r.post('/token/rotate', (c) => {
    const token = service.rotateToken()
    console.log('[mcp] Token regenerado.')
    return c.json({ token, tokenHint: tokenHint(token) })
  })
  return r
}
