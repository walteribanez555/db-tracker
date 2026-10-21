import { differenceInMinutes, format, formatDistanceStrict, formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useCallback } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { useTheme } from '@/components/theme/theme-provider'
import { useProjectStore } from '@/store/project'
import type { SchemaDiff } from '@/types/report'
import type { Branch, Project, Version } from '@/types/schema'

export const ts = (iso: string) => new Date(iso).getTime()

/** main primero; el resto por fecha de creación. */
export function orderedBranches(project: Project): Branch[] {
  return [...project.branches].sort((a, b) => {
    if (a.forkedFromVersionId === null && b.forkedFromVersionId !== null) return -1
    if (b.forkedFromVersionId === null && a.forkedFromVersionId !== null) return 1
    return ts(a.createdAt) - ts(b.createdAt)
  })
}

export function branchVersions(project: Project, branchId: string): Version[] {
  return project.versions.filter((v) => v.branchId === branchId).sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
}

export function lastActivity(project: Project, branch: Branch): string {
  const vs = branchVersions(project, branch.id)
  return vs.length ? vs[vs.length - 1].createdAt : branch.createdAt
}

const BG = { light: '#ffffff', dark: '#0e1621' } as const
const MIN_CONTRAST = 4.5

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbToHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const luminance = ([r, g, b]: number[]) => {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: number[], b: number[]) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const laneCache = new Map<string, string>()

/**
 * Color de rama ajustado al tema: se oscurece (claro) o aclara (oscuro) lo mínimo necesario
 * para alcanzar contraste ≥ 4.5:1 con el fondo, conservando el tono.
 */
export function laneColorFor(hex: string, theme: 'light' | 'dark'): string {
  const key = `${theme}|${hex}`
  const hit = laneCache.get(key)
  if (hit) return hit
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const bg = hexToRgb(BG[theme])!
  const target = theme === 'dark' ? [255, 255, 255] : [0, 0, 0]
  let out = rgb
  for (let t = 0; t <= 1.0001; t += 0.04) {
    out = rgb.map((v, i) => v + (target[i] - v) * t) as [number, number, number]
    if (contrast(out, bg) >= MIN_CONTRAST) break
  }
  const res = rgbToHex(out)
  laneCache.set(key, res)
  return res
}

/** `const laneColor = useLaneColor()` → función hex → color legible en el tema actual. */
export function useLaneColor() {
  const { resolved } = useTheme()
  return useCallback((hex: string) => laneColorFor(hex, resolved), [resolved])
}

export const fmtDate = (iso: string) => format(new Date(iso), "d MMM yyyy, HH:mm", { locale: es })
export const fmtShortDate = (iso: string) => format(new Date(iso), 'd MMM', { locale: es })
export const fmtRelative = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es })
export const fmtGap = (fromIso: string, toIso: string) => {
  const mins = differenceInMinutes(new Date(toIso), new Date(fromIso))
  if (mins < 60) return `${mins} min`
  return formatDistanceStrict(new Date(fromIso), new Date(toIso), { locale: es })
}

export const shortId = (id: string) => id.replace(/^ver_/, '').slice(0, 10)

/** Indicador reactivo de cambios sin confirmar. */
export const useIsDirty = () => useProjectStore((s) => s.isDirty())

/** Preferencias locales de la feature (autor de los commits). */
interface VersionsPrefs {
  author: string
  setAuthor: (author: string) => void
}

export const useVersionsPrefs = create<VersionsPrefs>()(
  persist(
    (set) => ({
      author: '',
      setAuthor: (author) => set({ author }),
    }),
    { name: 'db-tracker:versions-prefs' },
  ),
)

export const BRANCH_PREFIX = 'flujo/'

export type DiffKind = 'add' | 'remove' | 'change'

/** Color de texto por tipo de cambio (siempre acompañado de signo +/−/~). */
export const DIFF_TEXT: Record<DiffKind, string> = {
  add: 'text-emerald-700 dark:text-emerald-400',
  remove: 'text-red-700 dark:text-red-400',
  change: 'text-amber-700 dark:text-amber-400',
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "+1 vista", "−2 triggers", "~1 trigger"… (texto plano). */
export function viewTriggerMarker(d: SchemaDiff): string {
  const parts: string[] = []
  if (d.addedViews.length) parts.push(`+${count(d.addedViews.length, 'vista', 'vistas')}`)
  if (d.removedViews.length) parts.push(`−${count(d.removedViews.length, 'vista', 'vistas')}`)
  if (d.changedViews.length) parts.push(`~${count(d.changedViews.length, 'vista', 'vistas')}`)
  if (d.addedTriggers.length) parts.push(`+${count(d.addedTriggers.length, 'trigger', 'triggers')}`)
  if (d.removedTriggers.length) parts.push(`−${count(d.removedTriggers.length, 'trigger', 'triggers')}`)
  if (d.changedTriggers.length) parts.push(`~${count(d.changedTriggers.length, 'trigger', 'triggers')}`)
  return parts.join(' ')
}

/**
 * Clases para que los hijos directos (`li`) de una lista entren con fade + slide escalonado
 * (hasta 8 elementos; el resto, sin retardo). Respeta prefers-reduced-motion (regla global).
 */
export const STAGGER_LIST = [
  '[&>*]:animate-in [&>*]:fade-in [&>*]:slide-in-from-top-1 [&>*]:duration-200 [&>*]:ease-out [&>*]:fill-mode-both',
  '[&>*:nth-child(2)]:[animation-delay:30ms] [&>*:nth-child(3)]:[animation-delay:60ms] [&>*:nth-child(4)]:[animation-delay:90ms]',
  '[&>*:nth-child(5)]:[animation-delay:120ms] [&>*:nth-child(6)]:[animation-delay:150ms] [&>*:nth-child(7)]:[animation-delay:180ms]',
  '[&>*:nth-child(n+8)]:[animation-delay:210ms]',
].join(' ')
