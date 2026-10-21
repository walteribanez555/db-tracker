import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export const fmtDay = (iso: string | Date) => format(new Date(iso), 'd MMM yyyy', { locale: es })
export const fmtShort = (iso: string | Date) => format(new Date(iso), 'd MMM', { locale: es })
export const fmtNum = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es', { maximumFractionDigits: digits })
