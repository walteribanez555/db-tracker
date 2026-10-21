// Preferencias locales de la colaboración: nombre visible, color y sesiones recientes.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ClientKind } from '@/collab'
import { isDesktop } from '@/lib/platform'

/** Paleta de participantes (contraste suficiente sobre fondo claro y oscuro, texto blanco encima). */
export const PEER_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d']

const randomColor = () => PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)]

export interface RecentSession {
  sessionId: string
  code: string
  /** '' = mismo origen. */
  baseUrl: string
  /** Secreto del enlace (si se entró con enlace o QR). Solo se guarda en este navegador. */
  secret: string | null
  projectName: string
  hostName: string
  at: string
}

interface CollabPrefs {
  name: string
  color: string
  recent: RecentSession[]
  setName: (name: string) => void
  addRecent: (r: RecentSession) => void
  removeRecent: (sessionId: string) => void
}

const MAX_RECENT = 6

export const useCollabPrefs = create<CollabPrefs>()(
  persist(
    (set) => ({
      name: '',
      color: randomColor(),
      recent: [],
      setName: (name) => set({ name }),
      addRecent: (r) =>
        set((s) => ({ recent: [r, ...s.recent.filter((x) => x.sessionId !== r.sessionId && x.code !== r.code)].slice(0, MAX_RECENT) })),
      removeRecent: (sessionId) => set((s) => ({ recent: s.recent.filter((x) => x.sessionId !== sessionId) })),
    }),
    { name: 'db-tracker:collab-prefs' },
  ),
)

/** Tipo de cliente para el servidor (icono y texto en la lista de participantes). */
export function clientKind(): ClientKind {
  if (isDesktop) return 'desktop'
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return 'mobile'
  return 'web'
}

export const KIND_LABEL: Record<ClientKind, string> = { desktop: 'Escritorio', web: 'Navegador', mobile: 'Móvil', agent: 'Agente' }

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0]).toUpperCase()
}

/** La página se sirve desde este mismo equipo (puede ser anfitrión y usar /api/collab/status). */
export function isLoopbackOrigin(): boolean {
  if (typeof location === 'undefined') return false
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}
