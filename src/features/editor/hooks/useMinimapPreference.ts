import { useCallback, useState } from 'react'

const KEY = 'db-tracker:editor:minimap'

const read = () => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

/** Minimapa abierto/plegado, recordado en localStorage. */
export function useMinimapPreference(): [boolean, () => void] {
  const [open, setOpen] = useState(read)
  const toggle = useCallback(() => {
    setOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? '0' : '1')
      } catch {
        // sin almacenamiento: solo en memoria
      }
      return !o
    })
  }, [])
  return [open, toggle]
}
