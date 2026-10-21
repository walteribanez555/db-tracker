// Sesiones en memoria: el token de GitHub vive solo en el proceso del servidor.
// El navegador únicamente recibe una cookie httpOnly con un id aleatorio.
// No se persiste en disco ni se escribe en logs.
import { randomBytes } from 'node:crypto'

import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { GithubTokenKind, GithubUser } from '../../../src/features/github/types.ts'

export const SESSION_COOKIE = 'dbt_gh_sid'
const IDLE_TTL_MS = 8 * 60 * 60 * 1000 // 8 h sin actividad

export interface DeviceState {
  deviceCode: string
  interval: number
  expiresAt: number
}

export interface GhSession {
  id: string
  token?: string
  tokenKind?: GithubTokenKind
  scopes?: string[] | null
  user?: GithubUser
  device?: DeviceState
  createdAt: number
  lastSeen: number
}

const sessions = new Map<string, GhSession>()

const sweep = setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) if (now - s.lastSeen > IDLE_TTL_MS) sessions.delete(id)
}, 10 * 60 * 1000)
sweep.unref?.()

const isSecure = (c: Context) =>
  c.req.url.startsWith('https:') || c.req.header('x-forwarded-proto') === 'https'

/** Devuelve la sesión existente (si la cookie es válida) sin crear una nueva. */
export function getSession(c: Context): GhSession | undefined {
  const id = getCookie(c, SESSION_COOKIE)
  if (!id) return undefined
  const s = sessions.get(id)
  if (!s) return undefined
  if (Date.now() - s.lastSeen > IDLE_TTL_MS) {
    sessions.delete(id)
    return undefined
  }
  s.lastSeen = Date.now()
  return s
}

/** Devuelve la sesión actual o crea una nueva con id aleatorio (y fija la cookie). */
export function ensureSession(c: Context): GhSession {
  const existing = getSession(c)
  if (existing) return existing
  const id = randomBytes(32).toString('base64url')
  const s: GhSession = { id, createdAt: Date.now(), lastSeen: Date.now() }
  sessions.set(id, s)
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure(c),
    path: '/api/github',
    maxAge: IDLE_TTL_MS / 1000,
  })
  return s
}

/** Rota el id de sesión (al autenticarse) para evitar fijación de sesión. */
export function rotateSession(c: Context, s: GhSession): GhSession {
  sessions.delete(s.id)
  const id = randomBytes(32).toString('base64url')
  const next: GhSession = { ...s, id, lastSeen: Date.now() }
  sessions.set(id, next)
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure(c),
    path: '/api/github',
    maxAge: IDLE_TTL_MS / 1000,
  })
  return next
}

export function destroySession(c: Context) {
  const id = getCookie(c, SESSION_COOKIE)
  if (id) sessions.delete(id)
  deleteCookie(c, SESSION_COOKIE, { path: '/api/github' })
}
