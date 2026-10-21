// Estado de la colaboración (ligero: no importa Yjs). Lo reexporta index.ts.
import { create } from 'zustand'

import { isDesktop } from '@/lib/platform'

import type { AwarenessState, ClientKind, CollabRole, Participant, PublicSessionInfo } from './protocol'

export type ConnectionStatus = 'idle' | 'connecting' | 'pending' | 'connected' | 'reconnecting' | 'offline' | 'rejected' | 'kicked' | 'ended'

export interface CollabState {
  status: ConnectionStatus
  /** Sesión a la que está unido este cliente (como anfitrión o invitado). */
  session: PublicSessionInfo | null
  /** true si este cliente es el anfitrión (role owner). */
  isHost: boolean
  me: { participantId: string | null; name: string; color: string; kind: ClientKind; role: CollabRole | null }
  /** Lista de participantes (control {t:'participants'}). */
  participants: Participant[]
  /** Awareness de los demás, por clientID de Yjs. */
  peers: Record<number, AwarenessState>
  error: string | null
  /** true con rol 'viewer': el proyecto compartido es de solo lectura (las ediciones se revierten). */
  readOnly: boolean
  /** Cambia cada vez que se monta el binding o se cambia de rama (para recalcular getSharedText). */
  bindingEpoch: number
}

/** Paleta fija de colores de participante. */
export const COLLAB_COLORS = ['#2563eb', '#db2777', '#ea580c', '#16a34a', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#0d9488'] as const

export const COLLAB_NAME_KEY = 'db-tracker:collab-name'
export const COLLAB_COLOR_KEY = 'db-tracker:collab-color'
const CLIENT_ID_KEY = 'db-tracker:collab-client-id'

const safeGet = (storage: () => Storage, key: string): string | null => {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}
const safeSet = (storage: () => Storage, key: string, value: string) => {
  try {
    storage().setItem(key, value)
  } catch {
    // sin almacenamiento: solo en memoria
  }
}

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

/** Nombre visible por defecto (el último usado en este equipo). */
export const getDefaultName = (): string => safeGet(() => localStorage, COLLAB_NAME_KEY) ?? ''
export const saveDefaultName = (name: string) => safeSet(() => localStorage, COLLAB_NAME_KEY, name)

/** Color de este equipo: el guardado o uno de la paleta (se recuerda). */
export const getDefaultColor = (): string => {
  const saved = safeGet(() => localStorage, COLLAB_COLOR_KEY)
  if (saved) return saved
  const color = COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)]
  safeSet(() => localStorage, COLLAB_COLOR_KEY, color)
  return color
}

/** Color de la paleta para un id (determinista), útil para participantes sin color. */
export const colorFor = (id: string): string => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return COLLAB_COLORS[Math.abs(h) % COLLAB_COLORS.length]
}

/** Id estable de este cliente por pestaña (sessionStorage). */
export const getClientId = (): string => {
  const saved = safeGet(() => sessionStorage, CLIENT_ID_KEY)
  if (saved) return saved
  const id = randomId()
  safeSet(() => sessionStorage, CLIENT_ID_KEY, id)
  return id
}

export const detectKind = (): ClientKind => {
  if (isDesktop) return 'desktop'
  if (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return 'mobile'
  return 'web'
}

const initialMe = (): CollabState['me'] => ({
  participantId: null,
  name: typeof window === 'undefined' ? '' : getDefaultName(),
  color: typeof window === 'undefined' ? COLLAB_COLORS[0] : getDefaultColor(),
  kind: detectKind(),
  role: null,
})

export const initialCollabState = (): Omit<CollabState, 'me'> => ({
  status: 'idle',
  session: null,
  isHost: false,
  participants: [],
  peers: {},
  error: null,
  readOnly: false,
  bindingEpoch: 0,
})

export const useCollabStore = create<CollabState>()(() => ({ ...initialCollabState(), me: initialMe() }))
