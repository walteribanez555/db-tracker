// Normaliza errores de Octokit/GitHub a mensajes claros en español.
import type { GithubApiErrorBody, GithubErrorCode } from '../../../src/features/github/types.ts'

export class GhError extends Error {
  readonly status: number
  readonly code: GithubErrorCode
  readonly resetAt?: string

  constructor(status: number, code: GithubErrorCode, message: string, resetAt?: string) {
    super(message)
    this.status = status
    this.code = code
    this.resetAt = resetAt
  }

  toBody(): GithubApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.resetAt ? { resetAt: this.resetAt } : {}) } }
  }
}

interface OctokitLikeError {
  status?: number
  message?: string
  response?: {
    headers?: Record<string, string | number | undefined>
    data?: { message?: string; errors?: Array<{ message?: string; code?: string; field?: string } | string> }
  }
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

export function toGhError(err: unknown): GhError {
  if (err instanceof GhError) return err
  const e = (err ?? {}) as OctokitLikeError
  const status = typeof e.status === 'number' ? e.status : 0
  const headers = e.response?.headers ?? {}
  const apiMessage = e.response?.data?.message ?? e.message ?? 'Error desconocido'
  const detailMessages = (e.response?.data?.errors ?? [])
    .map((x) => (typeof x === 'string' ? x : (x.message ?? x.code ?? '')))
    .filter(Boolean)
    .join('; ')
  const remaining = headers['x-ratelimit-remaining']
  const reset = headers['x-ratelimit-reset']
  const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : undefined

  if (status === 401) {
    return new GhError(401, 'unauthorized', 'GitHub rechazó el token (inválido, caducado o revocado). Vuelve a conectar tu cuenta.')
  }
  if (status === 429 || (status === 403 && String(remaining) === '0')) {
    return new GhError(
      429,
      'rate_limited',
      resetAt
        ? `Se alcanzó el límite de peticiones de la API de GitHub. Se restablece a las ${hhmm(resetAt)}.`
        : 'Se alcanzó el límite de peticiones de la API de GitHub. Inténtalo de nuevo en unos minutos.',
      resetAt,
    )
  }
  if (status === 403 && /secondary rate limit|abuse/i.test(apiMessage)) {
    const retry = Number(headers['retry-after'] ?? 60)
    return new GhError(
      429,
      'rate_limited',
      `GitHub aplicó un límite secundario por demasiadas peticiones seguidas. Espera ~${retry}s y reintenta.`,
      new Date(Date.now() + retry * 1000).toISOString(),
    )
  }
  if (status === 403) {
    return new GhError(
      403,
      'forbidden',
      `Permisos insuficientes en GitHub (${apiMessage}). Un token classic necesita el scope "repo"; uno fine-grained necesita Contents (lectura y escritura), Metadata y, para crear repos, Administration.`,
    )
  }
  if (status === 404) {
    return new GhError(404, 'not_found', 'No encontrado en GitHub (o el token no tiene acceso a ese repositorio).')
  }
  if (status === 409 && /empty/i.test(apiMessage)) {
    return new GhError(409, 'repo_empty', 'El repositorio está vacío.')
  }
  if (status === 422 && /already exists/i.test(`${apiMessage} ${detailMessages}`)) {
    return new GhError(409, 'repo_exists', 'Ya existe un repositorio con ese nombre en tu cuenta. Elige otro nombre o vincúlalo como existente.')
  }
  if (status === 422) {
    return new GhError(422, 'validation', `GitHub rechazó la petición: ${detailMessages || apiMessage}`)
  }
  if (status >= 500) {
    return new GhError(502, 'github_error', `GitHub respondió con un error (${status}). Inténtalo de nuevo.`)
  }
  if (!status) {
    return new GhError(502, 'github_error', `No se pudo contactar con GitHub: ${e.message ?? 'error de red'}`)
  }
  return new GhError(502, 'github_error', `Error de GitHub (${status}): ${apiMessage}`)
}

export const errStatus = (err: unknown): number => {
  const s = (err as { status?: unknown })?.status
  return typeof s === 'number' ? s : 0
}
