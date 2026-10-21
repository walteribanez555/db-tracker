// Exportación del diagrama a imagen. Quien llama pasa el elemento `.react-flow`.
// Solo para el navegador (usa html-to-image).
/// <reference lib="dom" />
import { toPng, toSvg } from 'html-to-image'

export type DiagramImageFormat = 'png' | 'svg'

export interface DiagramImageOptions {
  /** Color de fondo (por defecto el de `body`). */
  backgroundColor?: string
  /** Factor de escala para PNG (por defecto 2). */
  pixelRatio?: number
  /** Si se indica, descarga el archivo con ese nombre (sin extensión). */
  download?: string
}

/** Oculta controles, minimapa y atribución de React Flow en la captura. */
const filter = (node: HTMLElement) => {
  const cls = node.classList
  if (!cls) return true
  return !(
    cls.contains('react-flow__controls') ||
    cls.contains('react-flow__minimap') ||
    cls.contains('react-flow__attribution') ||
    cls.contains('react-flow__panel')
  )
}

/** Devuelve un data URL (PNG o SVG) del elemento; opcionalmente lo descarga. */
export async function exportDiagramImage(
  element: HTMLElement,
  format: DiagramImageFormat,
  opts: DiagramImageOptions = {},
): Promise<string> {
  const backgroundColor = opts.backgroundColor ?? getComputedStyle(document.body).backgroundColor ?? '#ffffff'
  const common = { backgroundColor, filter, cacheBust: true }
  const dataUrl =
    format === 'png' ? await toPng(element, { ...common, pixelRatio: opts.pixelRatio ?? 2 }) : await toSvg(element, common)
  if (opts.download) {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${opts.download}.${format}`
    a.click()
  }
  return dataUrl
}
