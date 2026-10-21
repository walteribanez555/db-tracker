// Contraseñas de conexiones remotas: solo en memoria y, si el usuario lo pide, en sessionStorage
// (se borra al cerrar la pestaña). Nunca se guardan en el store persistido ni en exportaciones.
import { useSyncExternalStore } from 'react'

const memory = new Map<string, string>()
const listeners = new Set<() => void>()
const KEY = (id: string) => `db-tracker:pw:${id}`
let version = 0

const emit = () => {
  version++
  listeners.forEach((l) => l())
}

export function getPassword(connectionId: string): string | undefined {
  if (memory.has(connectionId)) return memory.get(connectionId)
  try {
    const v = sessionStorage.getItem(KEY(connectionId))
    if (v !== null) {
      memory.set(connectionId, v)
      return v
    }
  } catch {
    /* sessionStorage no disponible */
  }
  return undefined
}

export function setPassword(connectionId: string, password: string, remember: boolean) {
  memory.set(connectionId, password)
  try {
    if (remember) sessionStorage.setItem(KEY(connectionId), password)
    else sessionStorage.removeItem(KEY(connectionId))
  } catch {
    /* ignorar */
  }
  emit()
}

export function forgetPassword(connectionId: string) {
  memory.delete(connectionId)
  try {
    sessionStorage.removeItem(KEY(connectionId))
  } catch {
    /* ignorar */
  }
  emit()
}

export function isRemembered(connectionId: string): boolean {
  try {
    return sessionStorage.getItem(KEY(connectionId)) !== null
  } catch {
    return false
  }
}

/** Re-renderiza cuando cambia alguna contraseña guardada. */
export function usePasswordVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}
