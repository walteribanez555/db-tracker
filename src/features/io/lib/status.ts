// Estado de la última prueba de cada conexión (solo en memoria), compartido entre la lista y el formulario.
import { useSyncExternalStore } from 'react'

export type ConnectionStatus =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; detail: string }
  | { state: 'error'; detail: string }

const IDLE: ConnectionStatus = { state: 'idle' }
const statuses = new Map<string, ConnectionStatus>()
const listeners = new Set<() => void>()

export function setConnectionStatus(id: string, status: ConnectionStatus) {
  statuses.set(id, status)
  listeners.forEach((l) => l())
}

export function useConnectionStatus(id: string): ConnectionStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => statuses.get(id) ?? IDLE,
  )
}
