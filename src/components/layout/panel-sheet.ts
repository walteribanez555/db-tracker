// Estado de apertura de las hojas móviles de CollapsiblePanel (ver collapsible-panel.tsx).
import { useCallback, useSyncExternalStore } from 'react'

const sheetState = new Map<string, boolean>()
const sheetListeners = new Set<() => void>()

export const setPanelSheetOpen = (key: string, open: boolean) => {
  if ((sheetState.get(key) ?? false) === open) return
  sheetState.set(key, open)
  sheetListeners.forEach((l) => l())
}

const subscribeSheet = (cb: () => void) => {
  sheetListeners.add(cb)
  return () => {
    sheetListeners.delete(cb)
  }
}

/** Estado de apertura de la hoja móvil del panel con ese `storageKey`. */
export function usePanelSheet(storageKey: string) {
  const open = useSyncExternalStore(
    subscribeSheet,
    () => sheetState.get(storageKey) ?? false,
    () => false,
  )
  const setOpen = useCallback((next: boolean) => setPanelSheetOpen(storageKey, next), [storageKey])
  const toggle = useCallback(() => setPanelSheetOpen(storageKey, !(sheetState.get(storageKey) ?? false)), [storageKey])
  return { open, setOpen, toggle }
}

