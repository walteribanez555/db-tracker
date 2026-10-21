import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

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
 * ── Uso en un lienzo ──────────────────────────────────────────────────────────
 *   const menu = useActionMenuTrigger<T>()
 *   <div {...menu.longPressHandlers}>                       // pulsación larga táctil (500 ms, 8 px)
 *     <ReactFlow onNodeContextMenu={(e, n) => menu.handleContextMenu(e, …)} … />
 *   </div>
 *   <ActionMenu {...menu.menuProps} groups={groups} />      // en móvil se pinta como hoja inferior
 * La pulsación larga reemite un `contextmenu` con Ctrl sobre el elemento pulsado, así que los
 * manejadores de contextmenu que ya existen abren el menú sin más cambios. Para otra acción usa
 * `useLongPress(cb)` directamente.
 *
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

  // Pulsación larga (táctil): reemite un contextmenu con Ctrl sobre el elemento pulsado, así que los
  // manejadores existentes (onNodeContextMenu, onPaneContextMenu…) abren el menú sin cambios.
  const longPressHandlers = useLongPress()

  return { state, target: state.target, menuProps, openAt, close, handleContextMenu, longPressHandlers }
}

// ── Pulsación larga ───────────────────────────────────────────────────────────

/** Duración de la pulsación larga y tolerancia de movimiento antes de cancelarla. */
export const LONG_PRESS_MS = 500
export const LONG_PRESS_MOVE_TOLERANCE = 8

export interface LongPressInfo {
  x: number
  y: number
  /** Elemento bajo el dedo al disparar (el de la pulsación inicial si sigue en el DOM). */
  target: Element
}

export interface LongPressOptions {
  /** Milisegundos hasta disparar. Por defecto 500. */
  delay?: number
  /** Píxeles que puede moverse el dedo antes de cancelar. Por defecto 8. */
  tolerance?: number
  /** Desactiva el gesto (p. ej. en solo lectura). */
  disabled?: boolean
}

/** Reemite un `contextmenu` con Ctrl en el punto pulsado: es lo mismo que Ctrl + clic derecho. */
export const dispatchActionMenuGesture = ({ x, y, target }: LongPressInfo) => {
  target.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, ctrlKey: true, button: 2, view: window }),
  )
}

/** Tras disparar, se traga el clic que llega al levantar el dedo (para no deseleccionar ni cerrar el menú). */
const swallowNextClick = () => {
  const stop = (e: Event) => {
    e.stopPropagation()
    e.preventDefault()
    cleanup()
  }
  const cleanup = () => {
    window.removeEventListener('click', stop, true)
    clearTimeout(timer)
  }
  window.addEventListener('click', stop, true)
  const timer = setTimeout(cleanup, 600)
}

/**
 * Pulsación larga con el dedo o el lápiz (el ratón no la dispara). Devuelve manejadores de puntero
 * para esparcir en el contenedor (`<div {...longPress}>`). Se cancela si el dedo se mueve más de
 * `tolerance` px, si se levanta antes de `delay` ms o si entra un segundo dedo (pellizco).
 * Sin `onLongPress`, abre el menú de acciones (reemite Ctrl + clic derecho en el punto pulsado).
 */
export function useLongPress(onLongPress: (info: LongPressInfo) => void = dispatchActionMenuGesture, options: LongPressOptions = {}) {
  const { delay = LONG_PRESS_MS, tolerance = LONG_PRESS_MOVE_TOLERANCE, disabled = false } = options
  const cbRef = useRef(onLongPress)
  useEffect(() => {
    cbRef.current = onLongPress
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number; target: Element | null; id: number } | null>(null)
  const pointers = useRef(new Set<number>())

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') return
      pointers.current.add(e.pointerId)
      if (disabled || pointers.current.size > 1) return cancel()
      cancel()
      start.current = { x: e.clientX, y: e.clientY, target: e.target instanceof Element ? e.target : null, id: e.pointerId }
      timer.current = setTimeout(() => {
        const s = start.current
        cancel()
        if (!s) return
        const target = s.target?.isConnected ? s.target : document.elementFromPoint(s.x, s.y)
        if (!target) return
        swallowNextClick()
        navigator.vibrate?.(10)
        cbRef.current({ x: s.x, y: s.y, target })
      }, delay)
    },
    [cancel, delay, disabled],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const s = start.current
      if (!s || s.id !== e.pointerId) return
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > tolerance) cancel()
    },
    [cancel, tolerance],
  )

  const onPointerEnd = useCallback(
    (e: ReactPointerEvent) => {
      pointers.current.delete(e.pointerId)
      cancel()
    },
    [cancel],
  )

  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onPointerLeave: onPointerEnd }
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
