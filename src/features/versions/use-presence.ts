import { useEffect, useState } from 'react'

export interface Presence<T> {
  item: T
  key: string
  /** El elemento ya no está en la lista y está saliendo (fade-out). */
  exiting: boolean
}

interface State<T> {
  prev: T[]
  /** Generación: aumenta con cada cambio de la lista. */
  gen: number
  exiting: { item: T; key: string; index: number; gen: number }[]
}

/**
 * Mantiene montados durante `ms` los elementos que desaparecen de `items`, marcados como `exiting`,
 * para poder animar su salida. Los que reaparecen se recuperan al instante.
 */
export function usePresence<T>(items: T[], keyOf: (item: T) => string, ms = 200): Presence<T>[] {
  const [state, setState] = useState<State<T>>({ prev: items, gen: 0, exiting: [] })

  // Ajuste durante el render (patrón "estado derivado del valor anterior").
  if (state.prev !== items) {
    const keys = new Set(items.map(keyOf))
    const gen = state.gen + 1
    const removed = state.prev
      .map((item, index) => ({ item, key: keyOf(item), index, gen }))
      .filter((x) => !keys.has(x.key))
    setState({ prev: items, gen, exiting: [...state.exiting.filter((e) => !keys.has(e.key) && !removed.some((r) => r.key === e.key)), ...removed] })
  }

  useEffect(() => {
    if (!state.exiting.length) return
    const upTo = state.gen
    const t = setTimeout(() => setState((s) => ({ ...s, exiting: s.exiting.filter((e) => e.gen > upTo) })), ms)
    return () => clearTimeout(t)
  }, [state.exiting, state.gen, ms])

  const out: Presence<T>[] = items.map((item) => ({ item, key: keyOf(item), exiting: false }))
  for (const e of [...state.exiting].sort((a, b) => a.index - b.index)) {
    out.splice(Math.min(e.index, out.length), 0, { item: e.item, key: e.key, exiting: true })
  }
  return out
}
