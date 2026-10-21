// Descargas con Blob + <a download> (funciona en navegador y en Electron).
import type { ExportResult } from '@/lib/exporters'

export function downloadText(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export const downloadResult = (r: ExportResult) => downloadText(r.filename, r.content, r.mime)

/** Descarga varios archivos seguidos (los navegadores pueden pedir permiso la primera vez). */
export async function downloadMany(files: ExportResult[]) {
  for (const f of files) {
    downloadResult(f)
    await new Promise((r) => setTimeout(r, 250))
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
