import { Octokit } from '@octokit/rest'

import type { GithubTokenKind, GithubUser } from '../../../src/features/github/types.ts'
import { GhError, toGhError } from './errors.ts'

const noop = () => {}

/** Crea un cliente Octokit. El token nunca se registra: el logger interno solo emite warn/error sin cabeceras. */
export function makeOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    userAgent: 'db-tracker',
    log: { debug: noop, info: noop, warn: noop, error: noop },
    request: { retries: 0 },
  })
}

/** Codifica una ruta de rama segmento a segmento (mantiene las "/" de "flujo/3fn"). */
export const encodeRefPath = (name: string) => name.split('/').map(encodeURIComponent).join('/')

export function tokenKindOf(token: string): GithubTokenKind {
  if (token.startsWith('github_pat_')) return 'fine-grained'
  if (token.startsWith('gho_')) return 'oauth'
  return 'classic'
}

export interface WhoAmI {
  user: GithubUser
  scopes: string[] | null
  warnings: string[]
}

/** Valida el token contra GET /user y revisa los scopes (tokens classic / OAuth). */
export async function whoAmI(token: string): Promise<WhoAmI> {
  const octokit = makeOctokit(token)
  try {
    const res = await octokit.users.getAuthenticated()
    const header = res.headers['x-oauth-scopes']
    const scopes = typeof header === 'string' ? header.split(',').map((s) => s.trim()).filter(Boolean) : null
    const warnings: string[] = []
    if (scopes) {
      if (!scopes.includes('repo') && !scopes.includes('public_repo')) {
        throw new GhError(
          403,
          'forbidden',
          'El token no tiene el scope "repo". Crea un token classic con el scope "repo" (o uno fine-grained con Contents y Administration).',
        )
      }
      if (!scopes.includes('repo')) {
        warnings.push('El token solo tiene "public_repo": no podrás crear ni sincronizar repositorios privados.')
      }
    }
    return {
      user: {
        id: res.data.id,
        login: res.data.login,
        name: res.data.name ?? null,
        avatarUrl: res.data.avatar_url,
        htmlUrl: res.data.html_url,
      },
      scopes,
      warnings,
    }
  } catch (err) {
    throw toGhError(err)
  }
}

// ---------- OAuth Device Flow ----------

export const deviceFlowClientId = () => process.env.GITHUB_CLIENT_ID?.trim() || undefined

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'db-tracker' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
  })
  const data = (await res.json().catch(() => ({}))) as Partial<DeviceCodeResponse> & { error?: string; error_description?: string }
  if (!res.ok || data.error || !data.device_code) {
    const msg =
      data.error === 'device_flow_disabled'
        ? 'La OAuth App no tiene habilitado "Device Flow" (actívalo en la configuración de la app en GitHub).'
        : data.error_description || data.error || `GitHub respondió ${res.status}`
    throw new GhError(502, data.error === 'device_flow_disabled' ? 'device_flow_disabled' : 'github_error', msg)
  }
  return data as DeviceCodeResponse
}

export type DeviceTokenResult =
  | { kind: 'token'; token: string }
  | { kind: 'pending' }
  | { kind: 'slow_down'; interval: number }
  | { kind: 'expired' }
  | { kind: 'denied' }

export async function pollDeviceToken(clientId: string, deviceCode: string): Promise<DeviceTokenResult> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'db-tracker' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error?: string
    error_description?: string
    interval?: number
  }
  if (data.access_token) return { kind: 'token', token: data.access_token }
  switch (data.error) {
    case 'authorization_pending':
      return { kind: 'pending' }
    case 'slow_down':
      return { kind: 'slow_down', interval: data.interval ?? 10 }
    case 'expired_token':
      return { kind: 'expired' }
    case 'access_denied':
      return { kind: 'denied' }
    default:
      throw new GhError(502, 'github_error', data.error_description || data.error || `GitHub respondió ${res.status}`)
  }
}
