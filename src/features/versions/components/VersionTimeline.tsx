// Línea de tiempo vertical de versiones (móvil): sustituye al grafo horizontal por debajo de 768 px.
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronRight, GitCommitHorizontal } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { diffSchemas } from '@/lib/diff'
import { cn } from '@/lib/utils'
import type { Project } from '@/types/schema'

import { fmtDate, fmtShortDate, ts, useLaneColor, viewTriggerMarker } from '../lib'

interface Props {
  project: Project
  /** Si se indica, solo se muestran las versiones de esa rama. */
  branchId: string | null
  selectedId: string | null
  compareId?: string | null
  baseVersionId: string | null
  dirty: boolean
  draftJumps?: number
  onSelect: (versionId: string) => void
  onCommit: () => void
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const day = (iso: string) => format(new Date(iso), 'd MMM', { locale: es })
const time = (iso: string) => format(new Date(iso), 'HH:mm')

export function VersionTimeline({ project, branchId, selectedId, compareId, baseVersionId, dirty, draftJumps, onSelect, onCommit }: Props) {
  const laneColor = useLaneColor()

  const rows = useMemo(() => {
    const byId = new Map(project.versions.map((v) => [v.id, v]))
    const branchOf = new Map(project.branches.map((b) => [b.id, b]))
    return [...project.versions]
      .filter((v) => !branchId || v.branchId === branchId)
      .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
      .map((v) => {
        const parent = v.parentId ? byId.get(v.parentId) : undefined
        const diff = diffSchemas(parent?.schema ?? null, v.schema)
        const branch = branchOf.get(v.branchId)
        const fork = parent && parent.branchId !== v.branchId ? { from: branchOf.get(parent.branchId), at: parent } : undefined
        return { v, parent, branch, fork, jumps: diff.jumps, marker: viewTriggerMarker(diff), isHead: branch?.headVersionId === v.id }
      })
  }, [project, branchId])

  const current = project.branches.find((b) => b.id === project.currentBranchId)
  const showDraft = dirty && (!branchId || branchId === project.currentBranchId)

  return (
    <ol className="relative pb-2" aria-label="Línea de tiempo de versiones">
      {/* raíl */}
      <span aria-hidden className="absolute top-0 bottom-0 left-[82px] w-px bg-border" />

      {showDraft && (
        <li className="relative flex gap-3 border-b px-4 py-3">
          <div className="w-12 shrink-0 pt-0.5 text-right text-xs text-muted-foreground">ahora</div>
          <div className="relative w-3 shrink-0">
            <span
              aria-hidden
              className="absolute top-1 left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-dashed bg-background"
              style={{ borderColor: laneColor(current?.color ?? '#888') }}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-sm font-medium">Borrador sin confirmar</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                <span className="font-mono">{current?.name}</span>
                {draftJumps !== undefined && <> · {plural(draftJumps, 'salto', 'saltos')}</>}
              </p>
            </div>
            <Button className="h-11 w-full gap-1.5" onClick={onCommit}>
              <GitCommitHorizontal className="size-4" />
              Confirmar versión
            </Button>
          </div>
        </li>
      )}

      {rows.map(({ v, branch, fork, jumps, marker, isHead }, i) => {
        const color = laneColor(branch?.color ?? '#888')
        const prev = rows[i - 1]
        const newDay = !prev || day(prev.v.createdAt) !== day(v.createdAt)
        const isSel = v.id === selectedId
        const isCmp = v.id === compareId
        const isBase = v.id === baseVersionId
        return (
          <li key={v.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(v.id)}
              aria-current={isSel ? 'true' : undefined}
              aria-label={`${branch?.name ?? ''}: ${v.message}. ${fmtDate(v.createdAt)}. ${plural(jumps, 'salto', 'saltos')}${marker ? ` (${marker})` : ''}${isBase ? '. Versión actual' : ''}`}
              className={cn(
                'flex min-h-14 w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline-none',
                isSel && 'bg-brand/10',
              )}
            >
              <div className="w-12 shrink-0 pt-0.5 text-right text-xs leading-4 tabular-nums">
                <div className={cn(newDay ? 'text-foreground' : 'sr-only')}>{day(v.createdAt)}</div>
                <div className="text-muted-foreground">{time(v.createdAt)}</div>
              </div>
              <div className="relative w-3 shrink-0">
                <span
                  aria-hidden
                  className={cn('absolute top-1 left-1/2 size-3 -translate-x-1/2 rounded-full border-2', (isSel || isCmp) && 'ring-2 ring-offset-2 ring-offset-background')}
                  style={{
                    borderColor: color,
                    background: isHead ? color : 'var(--background)',
                    ['--tw-ring-color' as string]: isCmp ? 'var(--muted-foreground)' : color,
                  }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm leading-5 font-medium">{v.message}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
                  <span className="max-w-[12rem] truncate font-mono" style={{ color }} title={branch?.name}>
                    {branch?.name}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{plural(jumps, 'salto', 'saltos')}</span>
                  {isBase && <span className="font-medium text-foreground">· actual</span>}
                  {isCmp && <span className="font-medium text-foreground">· comparando</span>}
                </p>
                {marker && <p className="mt-0.5 text-xs text-foreground/80 tabular-nums">{marker}</p>}
                {fork && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    ↳ desde <span className="font-mono">{fork.from?.name ?? '?'}</span> · {fmtShortDate(fork.at.createdAt)}
                  </p>
                )}
              </div>
              <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
            </button>
          </li>
        )
      })}

      {rows.length === 0 && !showDraft && <li className="px-4 py-6 text-sm text-muted-foreground">Este flujo aún no tiene versiones.</li>}
    </ol>
  )
}
