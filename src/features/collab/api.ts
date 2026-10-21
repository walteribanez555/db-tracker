// Cliente REST de /api/collab (contrato en src/collab/protocol.ts).
// Las rutas de anfitrión (status, share, stop, participants, discover) solo responden en loopback;
// /public/:code también existe en el listener de red y se puede pedir a otro equipo (baseUrl).
import type {
  DiscoveredSession,
  Participant,
  ParticipantAction,
  PublicSessionInfo,
  SessionInfo,
  ShareRequest,
} from '@/collab'

const BASE = '/api/collab'

export type CollabApiErrorCode = 'unavailable' | 'not_found' | 'network' | 'server'

export class CollabApiError extends Error {
  readonly status: number
  readonly code: CollabApiErrorCode
  constructor(status: number, code: CollabApiErrorCode, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Normaliza "192.168.1.24:47123", "http://…" o un enlace completo a un origen http://host:puerto. */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim()
  if (!raw) return ''
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    return new URL(withScheme).origin
  } catch {
    return withScheme.replace(/\/+$/, '')
  }
}

async function request<T>(url: string, init: RequestInit = {}, opts: { notFound?: CollabApiErrorCode } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch {
    throw new CollabApiError(0, 'network', 'No se pudo contactar con el servidor.')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string | { message?: string } } | null
    const msg = typeof body?.error === 'string' ? body.error : body?.error?.message
    if (res.status === 404) throw new CollabApiError(404, opts.notFound ?? 'not_found', msg ?? 'No encontrado.')
    if (res.status === 502 || res.status === 503 || res.status === 504)
      throw new CollabApiError(res.status, 'network', 'El servidor local no responde.')
    throw new CollabApiError(res.status, 'server', msg ?? `Error inesperado (${res.status}).`)
  }
  // Un proxy o SPA puede devolver index.html con 200: se trata como "sin colaboración".
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) throw new CollabApiError(res.status, 'unavailable', 'El servidor no tiene colaboración.')
  return (await res.json()) as T
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(`${BASE}${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export interface CollabStatus {
  session: SessionInfo | null
  participants: Participant[]
}

export const collabApi = {
  /** 404 o fallo de red ⇒ CollabApiError con code 'unavailable' / 'network'. */
  status: () => request<CollabStatus>(`${BASE}/status`, {}, { notFound: 'unavailable' }),
  share: (body: ShareRequest) => post<SessionInfo>('/share', body),
  stop: () => post<{ ok: true }>('/stop'),
  participant: (id: string, action: ParticipantAction) => post<{ ok: true }>(`/participants/${encodeURIComponent(id)}`, action),
  discover: () => request<DiscoveredSession[]>(`${BASE}/discover`, {}, { notFound: 'unavailable' }),
  /** baseUrl '' = mismo origen (página /unirse servida por el anfitrión). */
  publicInfo: (code: string, baseUrl = '') =>
    request<PublicSessionInfo>(`${baseUrl}${BASE}/public/${encodeURIComponent(code.toUpperCase())}`),
}

/** Extrae el secreto del fragmento `#s=` de un enlace (o de un hash suelto). */
export function secretFromHash(hashOrUrl: string): string | null {
  const i = hashOrUrl.indexOf('#')
  const hash = i >= 0 ? hashOrUrl.slice(i + 1) : hashOrUrl
  const s = new URLSearchParams(hash).get('s')
  return s && s.length > 0 ? s : null
}

/** Datos de un enlace de unión http://IP:PUERTO/unirse?sala=CODE#s=SECRET. */
export function parseJoinLink(link: string): { baseUrl: string; code: string | null; secret: string | null } | null {
  const raw = link.trim()
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`)
    return { baseUrl: url.origin, code: url.searchParams.get('sala'), secret: secretFromHash(url.hash) }
  } catch {
    return null
  }
}

/* ───────────────────────── MCP (agentes de Claude Code) ───────────────────────── */
// Solo loopback, como /api/collab/status. Contrato acordado con server/mcp:
//   GET  /api/mcp/info          → McpInfo (token completo solo si la petición llega por loopback)
//   GET  /api/mcp/token         → { token }  (respaldo si info no trae el token)
//   POST /api/mcp/token/rotate  → { token?, tokenHint? }

export interface McpInfo {
  /** URL de la app/API local, p. ej. http://127.0.0.1:8787 */
  url: string
  /** Endpoint MCP (Streamable HTTP), p. ej. http://127.0.0.1:8787/mcp */
  mcpUrl: string
  /** Pista del token para reconocerlo sin mostrarlo (p. ej. "…a3f9"). */
  tokenHint: string
  connectedAgents: number
  /** Token completo: solo en loopback. */
  token?: string
  /** Carpeta del repo (para el puente stdio de Claude Desktop y el workflow). */
  repoDir?: string
  /** true = respuesta simulada en desarrollo (el servidor aún no expone /api/mcp). */
  simulated?: boolean
}

const MCP = '/api/mcp'

/** Simulación solo en desarrollo, mientras el servidor no tenga /api/mcp. */
const DEV_SIMULATE = import.meta.env.DEV
let simToken = 'dbt_dev_simulado_7f3c9a1e5b2d4c6f8a0e'
const simInfo = (): McpInfo => ({
  url: 'http://127.0.0.1:8787',
  mcpUrl: 'http://127.0.0.1:8787/mcp',
  tokenHint: `…${simToken.slice(-4)}`,
  connectedAgents: 0,
  token: simToken,
  simulated: true,
})
const canSimulate = (err: unknown) => DEV_SIMULATE && err instanceof CollabApiError && (err.code === 'unavailable' || err.code === 'not_found')

export const mcpApi = {
  info: async (): Promise<McpInfo> => {
    try {
      return await request<McpInfo>(`${MCP}/info`, {}, { notFound: 'unavailable' })
    } catch (err) {
      if (canSimulate(err)) return simInfo()
      throw err
    }
  },
  /** Token completo: el de info o, si no lo trae, GET /api/mcp/token. null si el servidor no lo entrega. */
  token: async (info: McpInfo | null): Promise<string | null> => {
    if (info?.token) return info.token
    if (info?.simulated) return simToken
    try {
      return (await request<{ token: string }>(`${MCP}/token`, {}, { notFound: 'unavailable' })).token ?? null
    } catch {
      return null
    }
  },
  rotate: async (simulated = false): Promise<{ token?: string; tokenHint?: string }> => {
    if (simulated) {
      simToken = `dbt_dev_simulado_${Math.random().toString(16).slice(2, 14)}${Date.now().toString(16)}`
      return { token: simToken, tokenHint: `…${simToken.slice(-4)}` }
    }
    return request(`${MCP}/token/rotate`, { method: 'POST' })
  },
}
