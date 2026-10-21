// Flujo de unión compartido por el diálogo de escritorio y la página /unirse.
import { create } from 'zustand'

import { CODE_ALPHABET, joinSession, useCollabStore, type PublicSessionInfo } from '@/collab'

import { CollabApiError, collabApi } from '../api'
import { clientKind, useCollabPrefs } from './identity'

/**
 * Datos con los que se entró a la sesión actual (para "Copiar enlace" del invitado y para reintentar).
 * Se guardan en sessionStorage: sobreviven a una recarga de la pestaña, no a cerrarla.
 */
interface JoinContext {
  baseUrl: string
  code: string
  secret: string
  sessionId: string
}

const CTX_KEY = 'db-tracker:collab-join'

const readCtx = (): JoinContext | null => {
  try {
    const raw = sessionStorage.getItem(CTX_KEY)
    return raw ? (JSON.parse(raw) as JoinContext) : null
  } catch {
    return null
  }
}

export const useJoinContext = create<{ ctx: JoinContext | null; set: (ctx: JoinContext | null) => void }>()((set) => ({
  ctx: readCtx(),
  set: (ctx) => {
    try {
      if (ctx) sessionStorage.setItem(CTX_KEY, JSON.stringify(ctx))
      else sessionStorage.removeItem(CTX_KEY)
    } catch {
      // sin almacenamiento
    }
    set({ ctx })
  },
}))

/** Enlace para compartir con otros: http://host/unirse?sala=CODE[#s=SECRET]. */
export function buildJoinLink(ctx: JoinContext): string {
  const origin = ctx.baseUrl || location.origin
  const hash = ctx.secret && ctx.secret !== ctx.code ? `#s=${encodeURIComponent(ctx.secret)}` : ''
  return `${origin}/unirse?sala=${encodeURIComponent(ctx.code)}${hash}`
}

export const normalizeCode = (raw: string) =>
  raw
    .toUpperCase()
    .split('')
    .filter((c) => CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, 6)

export const isValidCode = (code: string) => code.length === 6 && [...code].every((c) => CODE_ALPHABET.includes(c))

export class JoinError extends Error {
  readonly code: 'not_found' | 'needs_link' | 'network' | 'unavailable' | 'failed'
  constructor(code: JoinError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Secreto para el saludo del WebSocket.
 * - Con enlace o QR: el secreto largo del fragmento #s=.
 * - Solo con código: el propio código actúa como secreto corto, y SOLO si el anfitrión aprueba a cada
 *   invitado (needsApproval). Así nadie entra sin que el anfitrión lo acepte. Con aprobación automática
 *   el código no basta y hace falta el enlace.
 */
export function resolveSecret(info: PublicSessionInfo, secret: string | null): string | null {
  if (secret) return secret
  return info.needsApproval ? info.code : null
}

export interface JoinParams {
  baseUrl: string
  code: string
  secret: string | null
  name: string
}

/** Busca la sala, resuelve el secreto y conecta como invitado. Devuelve la info pública de la sala. */
export async function joinFlow({ baseUrl, code, secret, name }: JoinParams): Promise<PublicSessionInfo> {
  let info: PublicSessionInfo
  try {
    info = await collabApi.publicInfo(code, baseUrl)
  } catch (err) {
    if (err instanceof CollabApiError && err.code === 'not_found')
      throw new JoinError('not_found', 'No hay ninguna sesión con ese código en esa dirección.')
    if (err instanceof CollabApiError && err.code === 'unavailable')
      throw new JoinError('unavailable', 'Esa dirección no es una sesión de DB Tracker.')
    throw new JoinError('network', 'No se pudo contactar con el anfitrión. Comprueba la dirección y que estéis en la misma red.')
  }
  const resolved = resolveSecret(info, secret)
  if (!resolved)
    throw new JoinError('needs_link', 'El anfitrión acepta invitados automáticamente: para entrar necesitas su enlace o el QR.')

  const prefs = useCollabPrefs.getState()
  try {
    await joinSession({
      baseUrl,
      sessionId: info.id,
      secret: resolved,
      name,
      color: prefs.color,
      kind: clientKind(),
      mode: 'adopt-remote',
    })
  } catch (err) {
    throw new JoinError('failed', err instanceof Error ? err.message : 'No se pudo conectar a la sesión.')
  }
  useJoinContext.getState().set({ baseUrl, code: info.code, secret: resolved, sessionId: info.id })
  const status = useCollabStore.getState().status
  if (status !== 'rejected')
    prefs.addRecent({
      sessionId: info.id,
      code: info.code,
      baseUrl,
      secret: secret ?? null,
      projectName: info.projectName,
      hostName: info.hostName,
      at: new Date().toISOString(),
    })
  return info
}
