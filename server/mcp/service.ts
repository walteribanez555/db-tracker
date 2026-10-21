// Estado del servidor MCP del proceso: token, URL efectiva (server.json) y acceso a la sesión colaborativa.
import { existsSync } from 'node:fs'
import path from 'node:path'

import type { CollabManager } from '../collab/manager.ts'
import { ensureToken, newToken, removeServerFiles, tokenHint, tokenMatches, writeServerFiles, writeToken } from './discovery.ts'

export interface McpServiceOptions {
  /** Carpeta de datos (la misma que la de CollabManager): `<dataDir>/mcp-token` y `<dataDir>/server.json`. */
  dataDir: string
  collab: CollabManager
  runtime: 'web' | 'desktop'
  /** Carpeta del repositorio (web: cwd; Electron en desarrollo: la ruta de la app). Para el puente stdio. */
  repoDir?: string
}

export interface McpAgentInfo {
  id: string
  name: string
  color: string
  status: 'pending' | 'active'
  role: string
  lastSeenAt: string
}

export interface McpInfo {
  /** URL base del listener local. */
  url: string
  /** Endpoint MCP (Streamable HTTP, Authorization: Bearer). */
  mcpUrl: string
  tokenHint: string
  /** Token completo (las rutas /api/mcp solo responden por loopback con Host/Origin locales). */
  token: string
  /** Nº de agentes activos en la sesión. */
  connectedAgents: number
  /** Detalle de los agentes presentes (activos y pendientes de aprobación). */
  agents: McpAgentInfo[]
  /** Carpeta del repositorio, si se conoce (para el puente stdio y el workflow). */
  repoDir?: string
  /** Comando del puente stdio para clientes sin HTTP (Claude Desktop), si dist-mcp/stdio.mjs existe. */
  stdio?: { command: string; args: string[] }
  dataDir: string
  /** Sesión colaborativa activa (resumen) o null. */
  session: { id: string; network: 'lan' | 'local'; projectName: string; seeded: boolean; ownerConnected: boolean } | null
}

export class McpService {
  private currentToken: string
  private baseUrl = ''

  constructor(readonly options: McpServiceOptions) {
    // Se crea al arrancar si no existe.
    this.currentToken = ensureToken(options.dataDir)
  }

  get collab() {
    return this.options.collab
  }

  get token() {
    return this.currentToken
  }

  get url() {
    return this.baseUrl
  }

  get mcpUrl() {
    return this.baseUrl ? `${this.baseUrl}/mcp` : ''
  }

  /** Fija la URL efectiva del listener local y la publica en server.json (y en ~/.dbtracker/server.json). */
  setUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '')
    this.options.collab.setLocalUrl(this.baseUrl)
    try {
      writeServerFiles(this.options.dataDir, { url: this.baseUrl, mcpUrl: this.mcpUrl, runtime: this.options.runtime })
    } catch (err) {
      console.warn(`[mcp] No se pudo escribir server.json: ${(err as Error).message}`)
    }
  }

  /** Borra server.json si es de este proceso (al salir). */
  cleanup() {
    removeServerFiles(this.options.dataDir)
  }

  checkAuth(header: string | undefined | null) {
    return tokenMatches(header, this.currentToken)
  }

  rotateToken() {
    const token = newToken()
    writeToken(this.options.dataDir, token)
    this.currentToken = token
    return token
  }

  /** Comando para Claude Desktop: node <repo>/dist-mcp/stdio.mjs (solo si está compilado). */
  stdioCommand(): { command: string; args: string[] } | undefined {
    const repo = this.options.repoDir
    if (!repo) return undefined
    const file = path.join(repo, 'dist-mcp', 'stdio.mjs')
    return existsSync(file) ? { command: 'node', args: [file] } : undefined
  }

  info(): McpInfo {
    const room = this.options.collab.room
    const agents = room?.agentList() ?? []
    return {
      url: this.baseUrl,
      mcpUrl: this.mcpUrl,
      tokenHint: tokenHint(this.currentToken),
      token: this.currentToken,
      connectedAgents: agents.filter((a) => a.active).length,
      ...(this.options.repoDir ? { repoDir: this.options.repoDir } : {}),
      ...(this.stdioCommand() ? { stdio: this.stdioCommand() } : {}),
      dataDir: this.options.dataDir,
      agents: agents.map((a) => ({
        id: a.participant.id,
        name: a.name,
        color: a.participant.color,
        status: a.participant.status,
        role: a.participant.role,
        lastSeenAt: new Date(a.lastSeen).toISOString(),
      })),
      session: room
        ? {
            id: room.id,
            network: this.options.collab.status().session?.network ?? 'lan',
            projectName: room.projectName,
            seeded: room.doc.getMap('meta').has('projectId') || room.doc.getMap('branches').size > 0,
            ownerConnected: room.hasOwner(),
          }
        : null,
    }
  }
}
