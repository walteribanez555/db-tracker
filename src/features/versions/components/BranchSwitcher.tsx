import { ChevronsUpDown, GitBranch, GitBranchPlus, GitCommitHorizontal, History, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCurrentBranch, useProjectStore } from '@/store/project'

import { branchVersions, fmtRelative, lastActivity, useLaneColor, orderedBranches, useIsDirty } from '../lib'
import { switchWithFlow } from '../operations'
import { CommitDialog } from './CommitDialog'
import { useConfirm } from './ConfirmDialog'
import { CreateBranchDialog } from './CreateBranchDialog'

/**
 * Selector de rama para la cabecera: cambiar de rama, crear rama, confirmar o descartar el borrador.
 * `compact` (barra superior móvil): texto mono pequeño, sin el botón "Confirmar" aparte (está en el menú).
 */
export function BranchSwitcher({ compact = false }: { compact?: boolean } = {}) {
  const laneColor = useLaneColor()
  const project = useProjectStore((s) => s.project)
  const discardDraft = useProjectStore((s) => s.discardDraft)
  const branch = useCurrentBranch()
  const dirty = useIsDirty()
  const navigate = useNavigate()
  const [confirm, confirmDialog] = useConfirm()
  const [creating, setCreating] = useState(false)
  const [committing, setCommitting] = useState(false)

  const switchTo = async (branchId: string) => {
    if (branchId === branch.id) return
    if (
      dirty &&
      !(await confirm({
        title: 'Cambiar de rama',
        description: 'Tienes cambios sin confirmar. Si cambias de rama se descartarán.',
        confirmLabel: 'Descartar y cambiar',
        destructive: true,
      }))
    )
      return
    await switchWithFlow({ branchId })
  }

  const discard = async () => {
    if (
      await confirm({
        title: 'Descartar cambios',
        description: 'El borrador volverá al estado de la última versión confirmada. Esta acción no se puede deshacer.',
        confirmLabel: 'Descartar cambios',
        destructive: true,
      })
    ) {
      discardDraft()
      toast('Cambios descartados')
    }
  }

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={compact ? 'h-8 min-w-0 gap-1 px-1.5 font-mono text-xs text-muted-foreground' : 'gap-1.5 font-mono'}
            aria-label={`Rama actual: ${branch?.name}${dirty ? ', con cambios sin confirmar' : ''}`}>
            <GitBranch className="size-3.5" />
            <span className={compact ? 'max-w-28 truncate' : 'max-w-48 truncate'}>{branch?.name}</span>
            {dirty && (
              <span aria-hidden title="Cambios sin confirmar" className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500/60 [animation-duration:2s] motion-reduce:hidden dark:bg-amber-400/50" />
                <span className="relative inline-flex size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
              </span>
            )}
            <ChevronsUpDown className="size-3 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={compact ? 'w-[min(20rem,calc(100vw-1rem))] [&_[role^=menuitem]]:min-h-11' : 'w-80'}>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Ramas / flujos</span>
            {dirty && <span className="text-xs font-normal text-amber-700 dark:text-amber-400">● sin confirmar</span>}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={branch.id} onValueChange={switchTo}>
            {orderedBranches(project).map((b) => {
              const n = branchVersions(project, b.id).length
              return (
                <DropdownMenuRadioItem key={b.id} value={b.id} className="items-start py-1.5">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: laneColor(b.color) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">{b.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {n} {n === 1 ? 'versión' : 'versiones'} · {fmtRelative(lastActivity(project, b))}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <GitBranchPlus />
            Nueva rama…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!dirty} onSelect={() => setCommitting(true)}>
            <GitCommitHorizontal />
            Confirmar versión…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!dirty} variant="destructive" onSelect={discard}>
            <Undo2 />
            Descartar cambios
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/versiones')}>
            <History />
            Ver historial de versiones
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dirty && !compact && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCommitting(true)}>
              <GitCommitHorizontal className="size-3.5" />
              Confirmar
            </Button>
          </TooltipTrigger>
          <TooltipContent>Hay cambios sin confirmar en {branch.name}</TooltipContent>
        </Tooltip>
      )}

      <CreateBranchDialog open={creating} onOpenChange={setCreating} />
      <CommitDialog open={committing} onOpenChange={setCommitting} />
      {confirmDialog}
    </div>
  )
}
