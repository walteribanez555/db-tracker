import { GitBranchPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import type { Project } from '@/types/schema'

import { branchVersions, fmtRelative, lastActivity, orderedBranches, STAGGER_LIST, useLaneColor } from '../lib'

interface Props {
  project: Project
  activeBranchId: string | null
  onSelect: (branchId: string) => void
  onCheckout: (branchId: string) => void
  onCreate: () => void
}

export function BranchList({ project, activeBranchId, onSelect, onCheckout, onCreate }: Props) {
  const laneColor = useLaneColor()
  const isMobile = useIsMobile()
  const branches = orderedBranches(project)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {isMobile ? (
        <div className="border-b px-4 py-2">
          <Button variant="outline" className="h-11 w-full gap-1.5" onClick={onCreate}>
            <GitBranchPlus className="size-4" />
            Nueva rama
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 border-b px-4 pb-2">
          <h2 className="text-sm font-semibold">Ramas y flujos</h2>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={onCreate}>
            <GitBranchPlus className="size-3.5" />
            Nueva
          </Button>
        </div>
      )}
      <ul className={cn('min-h-0 flex-1 divide-y overflow-y-auto', STAGGER_LIST)}>
        {branches.map((b) => {
          const versions = branchVersions(project, b.id)
          const origin = b.forkedFromVersionId ? project.versions.find((v) => v.id === b.forkedFromVersionId) : undefined
          const originBranch = origin ? project.branches.find((x) => x.id === origin.branchId) : undefined
          const isCurrent = b.id === project.currentBranchId
          const isActive = b.id === activeBranchId
          return (
            <li key={b.id} className={cn('group relative transition-colors', isActive && 'bg-brand/10')}>
              <button
                type="button"
                className="block w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline-none"
                onClick={() => onSelect(b.id)}
                aria-current={isActive ? 'true' : undefined}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: laneColor(b.color) }} />
                  <span className="truncate font-mono text-sm font-medium">{b.name}</span>
                  {isCurrent && <span className="ml-auto shrink-0 text-xs text-muted-foreground">actual</span>}
                </div>
                {b.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{b.description}</p>}
                <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                  {versions.length} {versions.length === 1 ? 'versión' : 'versiones'} · {fmtRelative(lastActivity(project, b))}
                </p>
                {origin && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    desde <span className="font-mono">{originBranch?.name}</span> · {origin.message}
                  </p>
                )}
              </button>
              {!isCurrent && isMobile && (
                <div className="px-4 pb-3">
                  <Button variant="outline" className="h-11 w-full" onClick={() => onCheckout(b.id)}>
                    Cambiar a esta rama
                  </Button>
                </div>
              )}
              {!isCurrent && !isMobile && (
                <Button
                  size="xs"
                  variant="outline"
                  className="absolute top-2.5 right-3 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  onClick={() => onCheckout(b.id)}
                >
                  Cambiar a esta rama
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
