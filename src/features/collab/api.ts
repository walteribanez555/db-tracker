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
