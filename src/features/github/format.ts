import { format, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : format(d, "d MMM yyyy, HH:mm", { locale: es })
}

export const fmtAgo = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true, locale: es })
}

export const fmtHours = (h: number | null | undefined) => {
  if (h === null || h === undefined) return '—'
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toLocaleString('es', { maximumFractionDigits: 1 })} h`
  return `${(h / 24).toLocaleString('es', { maximumFractionDigits: 1 })} d`
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export const shortSha = (sha: string) => sha.slice(0, 7)
