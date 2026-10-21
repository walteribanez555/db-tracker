import { useCallback, useEffect, useRef, useState } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Ctrl + clic derecho (Cmd + clic derecho en macOS; allí Ctrl + clic ya llega como contextmenu con ctrlKey). */
export const isActionMenuGesture = (e: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>) => e.ctrlKey || (isMac && e.metaKey)

/** Shift+F10 o la tecla ContextMenu. */
export const isActionMenuKey = (e: Pick<KeyboardEvent, 'key' | 'shiftKey'>) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')

/** Etiqueta del gesto para textos de ayuda. */
export const ACTION_MENU_GESTURE_LABEL = isMac ? '⌃ clic / ⌘ clic derecho' : 'Ctrl + clic derecho'

export interface ActionMenuState<T> {
  open: boolean
  x: number
  y: number
  target: T | null
}

/**
 * Estado + filtro del gesto. `handleContextMenu` suprime siempre el menú nativo y solo abre
 * el menú propio con Ctrl/Cmd; devuelve true si lo abrió. `openAt` sirve para el teclado.
 */
export function useActionMenuTrigger<T>() {
  const [state, setState] = useState<ActionMenuState<T>>({ open: false, x: 0, y: 0, target: null })

  const openAt = useCallback((x: number, y: number, target: T) => setState({ open: true, x, y, target }), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])

  const handleContextMenu = useCallback(
    (event: Pick<MouseEvent, 'preventDefault' | 'ctrlKey' | 'metaKey' | 'clientX' | 'clientY'>, target: T) => {
      event.preventDefault()
      if (!isActionMenuGesture(event)) return false
      openAt(event.clientX, event.clientY, target)
      return true
    },
    [openAt],
  )

  const menuProps = {
    open: state.open,
    x: state.x,
    y: state.y,
    onOpenChange: (open: boolean) => setState((s) => ({ ...s, open })),
  }

  return { state, target: state.target, menuProps, openAt, close, handleContextMenu }
}

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || Boolean(target.closest('[role="menu"],[role="dialog"],.monaco-editor,.nokey')))

/**
 * Abre el menú con Shift+F10 / ContextMenu. `resolve` devuelve el ancla (coordenadas de pantalla)
 * y el objetivo del elemento seleccionado, o null si no hay nada que mostrar.
 */
export function useActionMenuKeys<T>(
  resolve: () => { x: number; y: number; target: T } | null,
  openAt: (x: number, y: number, target: T) => void,
  enabled = true,
) {
  const resolveRef = useRef(resolve)
  useEffect(() => {
    resolveRef.current = resolve
  })
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isActionMenuKey(e) || isTypingTarget(e.target)) return
      const anchor = resolveRef.current()
      if (!anchor) return
      e.preventDefault()
      openAt(anchor.x, anchor.y, anchor.target)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, openAt])
}
