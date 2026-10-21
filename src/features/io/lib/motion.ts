// Clases de animación compartidas por la vista /datos (todas respetan motion-reduce).
import type { CSSProperties } from 'react'

/** Entrada de elementos de lista: fade + desliza desde arriba. */
export const enterItem = 'animate-in fade-in slide-in-from-top-1 duration-200 ease-out [animation-fill-mode:both] motion-reduce:animate-none'

/** Retardo escalonado para los primeros ~8 elementos de una lista. */
export const stagger = (i: number): CSSProperties => ({ animationDelay: `${Math.min(i, 8) * 30}ms` })

/** Contenido que hace fade al montarse (cambiar `key` para repetir la animación). */
export const fadeIn = 'animate-in fade-in duration-200 ease-out motion-reduce:animate-none'
