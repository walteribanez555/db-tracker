// Cliente HTTP de /api/github. El token nunca pasa por aquí salvo en POST /token:
// el servidor lo guarda en memoria y el navegador solo conserva una cookie httpOnly.
import type {
  CreateRepoInput,
  DevicePollResponse,
  DeviceStartResponse,
  GithubApiErrorBody,
  GithubErrorCode,
  GithubMe,
  GithubReportResponse,
  GithubRepoSummary,
  PullEvent,
  PullResponse,
  RemoteBranch,
  SyncEvent,
  SyncInput,
} from './types'

const BASE = '/api/github'

export class GithubApiError extends Error {
  readonly status: number
  readonly code: GithubErrorCode
  readonly resetAt?: string
  constructor(status: number, code: GithubErrorCode, message: string, resetAt?: string) {
    super(message)
    this.status = status
    this.code = code
    this.resetAt = resetAt
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch {
    throw new GithubApiError(0, 'github_error', 'No se pudo contactar con el servidor local. ¿Está corriendo `npm run dev:api`?')
  }
  if (!res.ok) throw await toError(res)
  return (await res.json()) as T
}

async function toError(res: Response): Promise<GithubApiError> {
  const body = (await res.json().catch(() => null)) as GithubApiErrorBody | null
  if (body?.error) return new GithubApiError(res.status, body.error.code, body.error.message, body.error.resetAt)
  if (res.status === 502 || res.status === 504) {
    return new GithubApiError(res.status, 'github_error', 'El servidor local no responde. Arráncalo con `npm run dev:api`.')
  }
  return new GithubApiError(res.status, 'github_error', `Error inesperado (${res.status}).`)
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const githubApi = {
  me: () => request<GithubMe>('/me'),
  connectToken: (token: string) => post<GithubMe>('/token', { token }),
  logout: () => post<{ ok: true }>('/logout'),
  deviceStart: () => post<DeviceStartResponse>('/device/start'),
  devicePoll: () => post<DevicePollResponse>('/device/poll'),

  listRepos: () => request<GithubRepoSummary[]>('/repos'),
  createRepo: (input: CreateRepoInput) => post<GithubRepoSummary>('/repos', input),
  branches: (owner: string, repo: string) =>
    request<RemoteBranch[]>(`/branches?${new URLSearchParams({ owner, repo })}`),
  pull: (owner: string, repo: string) => request<PullResponse>(`/pull?${new URLSearchParams({ owner, repo })}`),
  report: (owner: string, repo: string) =>
    request<GithubReportResponse>(`/report?${new URLSearchParams({ owner, repo })}`),

  /** Sube (push) en streaming (NDJSON) y llama a onEvent por cada evento. */
  sync: (input: SyncInput, onEvent: (ev: SyncEvent) => void, signal?: AbortSignal) =>
    streamNdjson<SyncEvent>(`${BASE}/sync`, { method: 'POST', body: JSON.stringify(input), signal }, onEvent),

  /** Baja (pull) en streaming: progreso por versión y resultado en el evento "done". */
  pullStream: (owner: string, repo: string, onEvent: (ev: PullEvent) => void, signal?: AbortSignal) =>
    streamNdjson<PullEvent>(`${BASE}/pull?${new URLSearchParams({ owner, repo })}`, { method: 'GET', signal }, onEvent),
}

async function streamNdjson<E>(url: string, init: RequestInit, onEvent: (ev: E) => void): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/x-ndjson' },
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new GithubApiError(0, 'github_error', 'No se pudo contactar con el servidor local.')
  }
  if (!res.ok || !res.body) throw await toError(res)

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) onEvent(JSON.parse(line) as E)
    }
    if (done) break
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as E)
}

export const githubUrls = {
  repo: (owner: string, repo: string) => `https://github.com/${owner}/${repo}`,
  branch: (owner: string, repo: string, branch: string) =>
    `https://github.com/${owner}/${repo}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`,
  commits: (owner: string, repo: string, branch: string) =>
    `https://github.com/${owner}/${repo}/commits/${branch.split('/').map(encodeURIComponent).join('/')}`,
  commit: (owner: string, repo: string, sha: string) => `https://github.com/${owner}/${repo}/commit/${sha}`,
  network: (owner: string, repo: string) => `https://github.com/${owner}/${repo}/network`,
}
