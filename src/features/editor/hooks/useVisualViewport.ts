import { useReactFlow } from '@xyflow/react'
import { useEffect, useState, type RefObject } from 'react'

import type { FlowEdge, FlowNode } from '../lib/types'

const visibleBottom = () => {
  const vv = window.visualViewport
  return vv ? vv.offsetTop + vv.height : window.innerHeight
}

const subscribe = (cb: () => void) => {
  const vv = window.visualViewport
  vv?.addEventListener('resize', cb)
  vv?.addEventListener('scroll', cb)
  window.addEventListener('resize', cb)
  return () => {
    vv?.removeEventListener('resize', cb)
    vv?.removeEventListener('scroll', cb)
    window.removeEventListener('resize', cb)
  }
}

/**
 * Píxeles del borde inferior de `ref` que tapa el teclado en pantalla (0 sin teclado).
 * Sirve para subir una hoja anclada abajo y que el campo con foco quede visible.
 */
export function useKeyboardOffset(ref: RefObject<HTMLElement | null>, enabled = true) {
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const update = () => {
      const el = ref.current
      if (!el) return
      const next = Math.max(0, Math.round(el.getBoundingClientRect().bottom - visibleBottom()))
      setOffset((prev) => (Math.abs(prev - next) < 2 ? prev : next))
    }
    update()
    return subscribe(update)
  }, [ref, enabled])
  return enabled ? offset : 0
}

/**
 * Edición en línea en el lienzo con el teclado en pantalla: si el campo con foco de un nodo
 * queda tapado (o fuera por arriba), desplaza el lienzo lo justo para mostrarlo.
 */
export function useKeepCanvasInputVisible(enabled: boolean) {
  const rf = useReactFlow<FlowNode, FlowEdge>()
  useEffect(() => {
    if (!enabled) return
    let frame = 0
    const check = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = document.activeElement
        if (!(el instanceof HTMLElement) || !el.closest('[data-editor-canvas] .react-flow__node')) return
        if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) return
        const rect = el.getBoundingClientRect()
        const vv = window.visualViewport
        const top = (vv?.offsetTop ?? 0) + 64
        // La hoja inferior del inspector también tapa el lienzo.
        const sheetTop = document.querySelector('[data-mobile-inspector]')?.getBoundingClientRect().top ?? Infinity
        const bottom = Math.min(visibleBottom(), sheetTop) - 16
        let delta = 0
        if (rect.bottom > bottom) delta = bottom - rect.bottom
        else if (rect.top < top) delta = top - rect.top
        if (Math.abs(delta) < 1) return
        const v = rf.getViewport()
        void rf.setViewport({ ...v, y: v.y + delta }, { duration: 150 })
      })
    }
    const unsubscribe = subscribe(check)
    document.addEventListener('focusin', check)
    return () => {
      cancelAnimationFrame(frame)
      unsubscribe()
      document.removeEventListener('focusin', check)
    }
  }, [enabled, rf])
}
