import { useSyncExternalStore } from 'react'

/** Punto de corte móvil: por debajo de `md` (768 px). */
export const MOBILE_BREAKPOINT = 768
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const getMql = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY) : null

const subscribe = (cb: () => void) => {
  const mql = getMql()
  if (!mql) return () => {}
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

const getSnapshot = () => getMql()?.matches ?? false
const getServerSnapshot = () => false

/** Lectura puntual (fuera de React), p. ej. en manejadores o valores iniciales de estado. */
export const isMobileViewport = getSnapshot

/**
 * `true` cuando el viewport mide menos de 768 px.
 * Lee `matchMedia` de forma síncrona en el primer render (sin parpadeo) y se actualiza al cambiar.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
