import { addDays, eachDayOfInterval, endOfDay, format, isWeekend, startOfDay, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { diffSchemas } from '@/lib/diff'
import { cn } from '@/lib/utils'
import type { Project, Version } from '@/types/schema'

import { fmtDate, orderedBranches, ts, useLaneColor, viewTriggerMarker } from '../lib'

export type GraphZoom = 'dia' | 'semana'

const PX_PER_DAY: Record<GraphZoom, number> = { dia: 104, semana: 20 }
const RULER_H = 46
const LANE_H = 60
const PAD_L = 28
const PAD_R = 48
const MIN_GAP = 18
const DAY = 86_400_000
const LABEL_W = 212
/** Duración de la transición de escala (día ↔ semana). */
const ZOOM_MS = 280

// Animaciones locales del grafo: trazo de carriles y aparición escalonada de puntos.
const GRAPH_CSS = `
@keyframes vg-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes vg-pop { from { opacity: 0; transform: scale(0.4) } to { opacity: 1; transform: scale(1) } }
@keyframes vg-fade { from { opacity: 0 } to { opacity: 1 } }
.vg-draw { stroke-dasharray: 1; animation: vg-draw 450ms cubic-bezier(0.4, 0, 0.2, 1) both }
.vg-pop { transform-box: fill-box; transform-origin: center; animation: vg-pop 220ms ease-out both }
.vg-fade { animation: vg-fade 250ms ease-out both }
@keyframes vg-grow { from { stroke-dashoffset: var(--grow-from) } to { stroke-dashoffset: 0 } }
@keyframes vg-born { from { transform: translateX(var(--born-dx)) } to { transform: none } }
@keyframes vg-breathe { 0% { transform: scale(1); opacity: 0.55 } 100% { transform: scale(2.4); opacity: 0 } }
.vg-grow { stroke-dasharray: 1; animation: vg-grow 380ms cubic-bezier(0.4, 0, 0.2, 1) both }
.vg-born { animation: vg-born 380ms cubic-bezier(0.4, 0, 0.2, 1) both }
.vg-breathe { transform-box: fill-box; transform-origin: center; animation: vg-breathe 1.8s ease-out infinite }
@media (prefers-reduced-motion: reduce) { .vg-draw, .vg-pop, .vg-fade, .vg-grow, .vg-born, .vg-breathe { animation: none } }
`

interface Props {
  project: Project
  zoom: GraphZoom
  selectedId: string | null
  compareId?: string | null
  /** Versión sobre la que está el borrador (se marca como "actual"). */
  baseVersionId: string | null
  dirty: boolean
  /** Saltos del borrador respecto a su versión base (se muestran junto al punto de borrador). */
  draftJumps?: number
  onSelect: (versionId: string) => void
  onSelectBranch?: (branchId: string) => void
}

interface Point {
  v: Version
  x: number
  y: number
  r: number
  jumps: number
  color: string
  /** Marcador de texto de cambios en vistas/triggers, p. ej. "+1 vista ~1 trigger". */
  marker: string
  /** Desplazamiento vertical del marcador (se escalona si se solapa con el anterior del carril). */
  markerRow: number
  /** Orden cronológico (para escalonar la entrada). */
  order: number
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function VersionGraph({ project, zoom, selectedId, compareId, baseVersionId, dirty, draftJumps, onSelect, onSelectBranch }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const laneColor = useLaneColor()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const branches = useMemo(() => orderedBranches(project), [project])

  /* ---------------- Escala animada (px por día) ---------------- */
  const [px, setPx] = useState(PX_PER_DAY[zoom])
  const pxRef = useRef(px)
  /** Día (desde t0) que debe quedar centrado mientras cambia la escala. */
  const anchorDays = useRef<number | null>(null)

  useEffect(() => {
    const from = pxRef.current
    const to = PX_PER_DAY[zoom]
    if (from === to) return
    const el = scroller.current
    anchorDays.current = el ? (el.scrollLeft + el.clientWidth / 2 - PAD_L) / from : null
    const duration = reducedMotion() ? 0 : ZOOM_MS
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = duration ? Math.min(1, (now - start) / duration) : 1
      const eased = 1 - (1 - k) ** 3
      const value = from + (to - from) * eased
      pxRef.current = value
      setPx(value)
      if (k < 1) raf = requestAnimationFrame(tick)
      else anchorDays.current = null
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [zoom])

  /* ---------------- Datos por versión (independientes de la escala) ---------------- */
  const meta = useMemo(() => {
    const byId = new Map(project.versions.map((v) => [v.id, v]))
    return new Map(
      project.versions.map((v) => {
        const parent = v.parentId ? byId.get(v.parentId) : undefined
        const diff = diffSchemas(parent?.schema ?? null, v.schema)
        return [v.id, { jumps: diff.jumps, marker: viewTriggerMarker(diff), parent }]
      }),
    )
  }, [project.versions])

  const layout = useMemo(() => {
    const now = Date.now()
    const times = [...project.versions.map((v) => ts(v.createdAt)), ...project.branches.map((b) => ts(b.createdAt))]
    const minT = times.length ? Math.min(...times) : now
    const maxT = times.length ? Math.max(...times) : now
    // Se extiende hasta hoy si la última actividad es reciente (≤ 60 días) para ver la inactividad.
    const endT = now - maxT < 60 * DAY ? Math.max(maxT, now) : maxT
    // Márgenes fijos para que la transición de escala sea continua.
    const t0 = startOfDay(addDays(minT, -2)).getTime()
    const t1 = endOfDay(addDays(endT, 3)).getTime()
    const xOf = (t: number) => PAD_L + ((t - t0) / DAY) * px
    const width = Math.max(xOf(t1) + PAD_R, 480)
    const height = RULER_H + branches.length * LANE_H + 14
    const laneY = new Map(branches.map((b, i) => [b.id, RULER_H + i * LANE_H + LANE_H / 2]))

    // Posiciones: cronológicas, con separación mínima en el carril y respecto al padre de otra rama.
    const sorted = [...project.versions].sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
    const lastInLane = new Map<string, number>()
    const lastMarkerEnd = new Map<string, number>()
    const points = new Map<string, Point>()
    sorted.forEach((v, order) => {
      const m = meta.get(v.id)!
      const parent = m.parent
      let x = xOf(ts(v.createdAt))
      const prev = lastInLane.get(v.branchId)
      if (prev !== undefined) x = Math.max(x, prev + MIN_GAP)
      const pp = parent ? points.get(parent.id) : undefined
      if (pp && parent!.branchId !== v.branchId) x = Math.max(x, pp.x + MIN_GAP)
      lastInLane.set(v.branchId, x)
      // Escalona el marcador si el texto se solaparía con el anterior del mismo carril (≈5 px por carácter).
      let markerRow = 0
      if (m.marker) {
        const half = (m.marker.length * 5) / 2
        const prevEnd = lastMarkerEnd.get(v.branchId) ?? -Infinity
        markerRow = x - half < prevEnd + 4 ? 1 : 0
        if (markerRow === 0) lastMarkerEnd.set(v.branchId, x + half)
      }
      const branch = project.branches.find((b) => b.id === v.branchId)
      points.set(v.id, {
        v,
        x,
        y: laneY.get(v.branchId) ?? RULER_H,
        r: 5 + Math.min(4, Math.sqrt(m.jumps)),
        jumps: m.jumps,
        color: laneColor(branch?.color ?? '#888888'),
        marker: m.marker,
        markerRow,
        order,
      })
    })

    // Regla
    const days = eachDayOfInterval({ start: t0, end: t1 })
    const months: { x: number; label: string }[] = []
    let lastMonth = -1
    for (const d of days) {
      if (d.getMonth() !== lastMonth) {
        const x = xOf(d.getTime())
        // Si el mes anterior apenas tiene espacio (inicio del eje), se omite su etiqueta para no solaparse.
        if (months.length && x - months[months.length - 1].x < 120) months.pop()
        months.push({ x, label: format(d, 'LLLL yyyy', { locale: es }) })
        lastMonth = d.getMonth()
      }
    }
    const ticks =
      zoom === 'dia'
        ? days.map((d) => ({
            key: d.getTime(),
            x: xOf(d.getTime()),
            // El mes se repite los lunes y el día 1 para no perder la referencia al desplazarse.
            label: format(d, d.getDate() === 1 || d.getDay() === 1 ? 'EEE d MMM' : 'EEE d', { locale: es }),
            major: true,
            weekend: isWeekend(d),
          }))
        : days.map((d) => {
            const major = startOfWeek(d, { weekStartsOn: 1 }).getTime() === d.getTime()
            return { key: d.getTime(), x: xOf(d.getTime()), label: major ? format(d, 'd MMM', { locale: es }) : '', major, weekend: isWeekend(d) }
          })

    return { xOf, width, height, laneY, points, months, ticks, nowX: xOf(now), showNow: now <= t1 }
  }, [project, branches, zoom, px, meta, laneColor])

  // Mantiene centrado el mismo instante mientras cambia la escala.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || anchorDays.current === null) return
    el.scrollLeft = PAD_L + anchorDays.current * px - el.clientWidth / 2
  }, [px])

  // Al cargar un proyecto: muestra la versión seleccionada (o el final del eje).
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const p = selectedId ? layout.points.get(selectedId) : undefined
    const target = p ? p.x - el.clientWidth / 2 : el.scrollWidth
    el.scrollTo({ left: Math.max(0, target) })
    // Solo al cambiar de proyecto: no queremos saltar en cada selección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const { width, height, laneY, points, months, ticks, nowX, showNow, xOf } = layout
  const currentBranchId = project.currentBranchId
  const hover = hoverId ? points.get(hoverId) : undefined
  const zoomLabelsVisible = px >= 60

  /** Geometría de un carril: puntos propios ordenados, inicio/fin del segmento y posición del borrador. */
  const lane = (branchId: string) => {
    const b = project.branches.find((x) => x.id === branchId)!
    const own = project.versions
      .filter((v) => v.branchId === branchId)
      .map((v) => points.get(v.id)!)
      .sort((p, q) => p.x - q.x)
    const startX = own[0]?.x ?? xOf(ts(b.createdAt))
    const endX = own.length ? own[own.length - 1].x : startX
    return { own, startX, endX, draftX: Math.max(nowX, endX + MIN_GAP) }
  }

  /* --- Seguimiento entre renders (estado derivado): puntos nuevos que nacen del borrador y carriles que crecen --- */
  const draftNow = dirty && showNow ? { branchId: currentBranchId, x: lane(currentBranchId).draftX } : null
  const [track, setTrack] = useState(() => ({
    projectId: project.id,
    versions: project.versions,
    known: new Set(project.versions.map((v) => v.id)),
    /** Versiones presentes al montar (entran escalonadas); las posteriores aparecen sin retardo. */
    initial: new Set(project.versions.map((v) => v.id)),
    lastDraft: draftNow,
    born: new Map<string, number>(),
    /** Última versión de cada carril y crecimiento pendiente de animar. */
    laneHead: new Map(project.branches.map((b) => [b.id, lane(b.id).own.at(-1)?.v.id ?? null])),
    grow: new Map<string, { from: number; count: number }>(),
  }))
  if (track.projectId !== project.id) {
    setTrack({
      projectId: project.id,
      versions: project.versions,
      known: new Set(project.versions.map((v) => v.id)),
      initial: new Set(project.versions.map((v) => v.id)),
      lastDraft: draftNow,
      born: new Map(),
      laneHead: new Map(project.branches.map((b) => [b.id, lane(b.id).own.at(-1)?.v.id ?? null])),
      grow: new Map(),
    })
  } else if (track.versions !== project.versions) {
    const born = new Map(track.born)
    const grow = new Map(track.grow)
    const laneHead = new Map<string, string | null>()
    for (const b of project.branches) {
      const g = lane(b.id)
      laneHead.set(b.id, g.own.at(-1)?.v.id ?? null)
      const prevHead = track.laneHead.get(b.id)
      const prevPoint = prevHead ? points.get(prevHead) : undefined
      const total = g.endX - g.startX
      if (g.own.length > 1 && total > 0 && g.own.at(-1)!.v.id !== prevHead) {
        const prevLen = prevPoint ? Math.max(0, prevPoint.x - g.startX) : 0
        grow.set(b.id, { from: 1 - prevLen / total, count: g.own.length })
      }
    }
    for (const v of project.versions) {
      if (track.known.has(v.id)) continue
      const p = points.get(v.id)
      if (p && track.lastDraft && track.lastDraft.branchId === v.branchId) born.set(v.id, track.lastDraft.x - p.x)
    }
    setTrack({ ...track, versions: project.versions, known: new Set(project.versions.map((v) => v.id)), born, grow, laneHead, lastDraft: draftNow })
  } else if ((draftNow?.branchId ?? null) !== (track.lastDraft?.branchId ?? null) || Math.round(draftNow?.x ?? 0) !== Math.round(track.lastDraft?.x ?? 0)) {
    setTrack({ ...track, lastDraft: draftNow })
  }

  return (
    <div className="flex">
      {/* Etiquetas de carril (fijas) */}
      <div className="shrink-0 border-r" style={{ width: LABEL_W }}>
        <div className="flex items-end border-b px-3 pb-1.5 text-xs text-muted-foreground" style={{ height: RULER_H }}>
          Rama / flujo
        </div>
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelectBranch?.(b.id)}
            className={cn(
              'flex w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none',
              b.id === currentBranchId && 'font-medium',
            )}
            style={{ height: LANE_H }}
            title={`${b.name}${b.description ? ` — ${b.description}` : ''}`}
          >
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: laneColor(b.color) }} />
            <span className="truncate font-mono text-xs">{b.name}</span>
            {b.id === currentBranchId && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">actual</span>}
          </button>
        ))}
      </div>

      {/* Eje temporal desplazable */}
      <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <svg
          key={project.id}
          width={width}
          height={height}
          role="group"
          aria-label="Grafo de versiones por rama a lo largo del tiempo"
          className="block select-none"
        >
          <style>{GRAPH_CSS}</style>
          {/* fines de semana */}
          {ticks
            .filter((t) => t.weekend)
            .map((t) => (
              <rect key={`we-${t.key}`} x={t.x} y={RULER_H} width={px} height={height - RULER_H} className="fill-muted/60" />
            ))}
          {/* meses */}
          {months.map((m) => (
            <g key={m.label}>
              <line x1={m.x} x2={m.x} y1={0} y2={18} className="stroke-border" />
              <text x={m.x + 6} y={13} className="fill-foreground text-[11px] font-medium capitalize">
                {m.label}
              </text>
            </g>
          ))}
          {/* ticks */}
          {ticks.map((t) => (
            <g key={`t-${t.key}`}>
              <line x1={t.x} x2={t.x} y1={t.major ? 22 : 34} y2={RULER_H} className="stroke-muted-foreground/40" />
              {t.major && <line x1={t.x} x2={t.x} y1={RULER_H} y2={height} className="stroke-border" strokeDasharray="2 4" />}
              {t.label && (zoom === 'semana' || zoomLabelsVisible) && (
                <text x={t.x + 4} y={36} className="fill-muted-foreground text-[10px]">
                  {t.label}
                </text>
              )}
            </g>
          ))}
          <line x1={0} x2={width} y1={RULER_H} y2={RULER_H} className="stroke-border" />
          {/* separadores de carril */}
          {branches.map((b, i) => (
            <line key={`sep-${b.id}`} x1={0} x2={width} y1={RULER_H + (i + 1) * LANE_H} y2={RULER_H + (i + 1) * LANE_H} className="stroke-border/70" />
          ))}

          {/* hoy */}
          {showNow && (
            <g>
              <line x1={nowX} x2={nowX} y1={20} y2={height} className="stroke-brand/70" strokeDasharray="4 3" />
              <text x={nowX + 4} y={RULER_H - 2} className="fill-brand text-[10px] font-medium">
                hoy
              </text>
            </g>
          )}

          {/* segmentos de rama y forks (se trazan al entrar) */}
          {branches.map((b, laneIdx) => {
            const y = laneY.get(b.id)!
            const color = laneColor(b.color)
            const own = project.versions
              .filter((v) => v.branchId === b.id)
              .map((v) => points.get(v.id)!)
              .sort((p, q) => p.x - q.x)
            const fork = b.forkedFromVersionId ? points.get(b.forkedFromVersionId) : undefined
            const startX = own[0]?.x ?? xOf(ts(b.createdAt))
            const endX = own.length ? own[own.length - 1].x : startX
            const delay = { animationDelay: `${laneIdx * 70}ms` }
            const elements: React.ReactNode[] = []
            if (fork) {
              const fx = fork.x
              const fy = fork.y
              const dir = y > fy ? 1 : -1
              const r = Math.max(0, Math.min(12, Math.abs(y - fy), startX - fx))
              const d = `M ${fx} ${fy} L ${fx} ${y - dir * r} Q ${fx} ${y} ${fx + r} ${y} L ${startX} ${y}`
              elements.push(
                <path key="fork" d={d} pathLength={1} className="vg-draw" style={delay} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />,
              )
            }
            if (own.length > 1) {
              const growth = track.grow.get(b.id)
              const growing = growth && growth.count === own.length
              elements.push(
                <line
                  key={`seg-${own.length}`}
                  x1={startX}
                  x2={endX}
                  y1={y}
                  y2={y}
                  pathLength={1}
                  className={growing ? 'vg-grow' : 'vg-draw'}
                  style={
                    growing
                      ? ({ '--grow-from': growth.from } as React.CSSProperties)
                      : { animationDelay: `${laneIdx * 70 + (fork ? 150 : 0)}ms` }
                  }
                  stroke={color}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />,
              )
            }
            if (!own.length) {
              elements.push(
                <circle key="empty" className="vg-fade" cx={startX} cy={y} r={5} fill="var(--background)" stroke={color} strokeWidth={2} strokeDasharray="2 2">
                  <title>{`${b.name}: rama sin versiones`}</title>
                </circle>,
              )
            }
            if (b.id === currentBranchId && dirty && showNow) {
              const from = own.length ? endX : startX
              const dx = Math.max(nowX, from + MIN_GAP)
              elements.push(
                <g key="draft" className="vg-fade">
                  <line x1={from} x2={dx} y1={y} y2={y} stroke={color} strokeWidth={2} strokeDasharray="3 3" />
                  <circle className="vg-breathe" cx={dx} cy={y} r={5} fill="none" stroke={color} strokeWidth={2} />
                  <circle cx={dx} cy={y} r={5} fill="var(--background)" stroke={color} strokeWidth={2} strokeDasharray="2 2" />
                  <text x={dx + 9} y={y + 3} className="fill-muted-foreground text-[10px] tabular-nums">
                    borrador
                    {draftJumps !== undefined && (
                      <tspan key={draftJumps} className="vg-fade fill-foreground">
                        {` · ${draftJumps} ${draftJumps === 1 ? 'salto' : 'saltos'}`}
                      </tspan>
                    )}
                  </text>
                </g>,
              )
            }
            return <g key={b.id}>{elements}</g>
          })}

          {/* versiones (aparecen escalonadas) */}
          {[...points.values()].map((p) => {
            const selected = p.v.id === selectedId
            const comparing = p.v.id === compareId
            const isBase = p.v.id === baseVersionId
            const branch = project.branches.find((b) => b.id === p.v.branchId)
            const isHead = branch?.headVersionId === p.v.id
            const showJumps = zoom === 'dia' && zoomLabelsVisible
            return (
              <g
                key={p.v.id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={`${branch?.name ?? ''}: ${p.v.message}. ${fmtDate(p.v.createdAt)}. ${p.jumps} ${p.jumps === 1 ? 'salto' : 'saltos'}${p.marker ? ` (${p.marker})` : ''}${isBase ? '. Versión actual' : ''}`}
                className={cn('group/pt cursor-pointer outline-none', track.born.has(p.v.id) ? 'vg-born' : 'vg-pop')}
                style={
                  track.born.has(p.v.id)
                    ? ({ '--born-dx': `${track.born.get(p.v.id)}px` } as React.CSSProperties)
                    : { animationDelay: track.initial.has(p.v.id) ? `${200 + Math.min(p.order, 16) * 35}ms` : '0ms' }
                }
                onClick={() => onSelect(p.v.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(p.v.id)
                  }
                }}
                onMouseEnter={() => setHoverId(p.v.id)}
                onMouseLeave={() => setHoverId((h) => (h === p.v.id ? null : h))}
                onFocus={() => setHoverId(p.v.id)}
                onBlur={() => setHoverId(null)}
              >
                <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                <g className="origin-center transition-transform duration-150 ease-out [transform-box:fill-box] group-hover/pt:scale-125 group-focus-visible/pt:scale-125 motion-reduce:transition-none">
                  <circle
                    className="opacity-0 transition-opacity duration-150 group-focus-visible/pt:opacity-100"
                    cx={p.x}
                    cy={p.y}
                    r={p.r + 6}
                    fill="none"
                    stroke="var(--ring)"
                    strokeWidth={2}
                  />
                  {selected && <circle cx={p.x} cy={p.y} r={p.r + 4} fill="none" stroke="var(--brand)" strokeWidth={2.5} />}
                  {comparing && (
                    <circle cx={p.x} cy={p.y} r={p.r + 4} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="3 2" />
                  )}
                  {isHead ? (
                    <circle cx={p.x} cy={p.y} r={p.r} fill={p.color} stroke="var(--background)" strokeWidth={2} />
                  ) : (
                    <circle cx={p.x} cy={p.y} r={p.r} fill="var(--background)" stroke={p.color} strokeWidth={2.5} />
                  )}
                </g>
                {(showJumps || isBase) && (
                  <text x={p.x} y={p.y - p.r - 6} textAnchor="middle" className="text-[9px] tabular-nums">
                    {showJumps && <tspan className="fill-muted-foreground">{p.jumps}</tspan>}
                    {showJumps && isBase && <tspan className="fill-muted-foreground"> · </tspan>}
                    {isBase && <tspan className="fill-foreground font-semibold">actual</tspan>}
                  </text>
                )}
                {p.marker && (
                  <text x={p.x} y={p.y + p.r + 11 + p.markerRow * 10} textAnchor="middle" className="fill-foreground/85 text-[9px] tabular-nums">
                    {p.marker}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-64 animate-in rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md duration-150 fade-in zoom-in-95"
            style={{
              left: Math.min(hover.x + 14, width - 270),
              top: hover.y + 14 > height - 60 ? hover.y - 80 : hover.y + 14,
            }}
          >
            <div className="font-medium">{hover.v.message}</div>
            <div className="mt-0.5 text-muted-foreground">
              {hover.v.author} · {fmtDate(hover.v.createdAt)}
            </div>
            <div className="mt-0.5 text-muted-foreground tabular-nums">
              {hover.jumps} {hover.jumps === 1 ? 'salto' : 'saltos'}
              {hover.marker && <> · {hover.marker}</>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
