import { Database, GitBranch, ListTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { CollapsiblePanel, usePanelSheet } from '@/components/layout/collapsible-panel'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ReportPdfButton } from '@/features/reports/pdf/ReportPdfButton'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'

import { BranchList } from './components/BranchList'
import { CommitDialog } from './components/CommitDialog'
import { useConfirm } from './components/ConfirmDialog'
import { CreateBranchDialog } from './components/CreateBranchDialog'
import { VersionDetail } from './components/VersionDetail'
import { VersionGraph, type GraphZoom } from './components/VersionGraph'
import { VersionTimeline } from './components/VersionTimeline'
import { branchVersions, ts, useIsDirty } from './lib'
import { useLiveDiff } from './live-diff'
import { loadSampleWithFlow, switchWithFlow } from './operations'

export { BranchSwitcher } from './components/BranchSwitcher'
export { CommitDialog } from './components/CommitDialog'
export { CreateBranchDialog } from './components/CreateBranchDialog'
export { DiffList, DiffSummary } from './components/DiffList'

/** Botón "Cargar proyecto de ejemplo" (pide confirmación si ya hay datos). */
export function LoadSampleButton({
  onLoaded,
  variant = 'outline',
  className,
}: {
  onLoaded?: () => void
  variant?: 'outline' | 'default'
  className?: string
}) {
  const project = useProjectStore((s) => s.project)
  const draft = useProjectStore((s) => s.draft)
  const [confirm, dialog] = useConfirm()

  const load = async () => {
    const hasData = project.versions.length > 0 || draft.tables.length > 0
    if (
      hasData &&
      !(await confirm({
        title: 'Cargar proyecto de ejemplo',
        description: `Se reemplazará el proyecto «${project.name}» (${project.versions.length} versiones y el borrador actual) por «tienda-online». Exporta antes si quieres conservarlo.`,
        confirmLabel: 'Reemplazar',
        destructive: true,
      }))
    )
      return
    const res = await loadSampleWithFlow()
    if (res.ok) {
      toast.success('Proyecto de ejemplo cargado', { description: 'tienda-online · flujos 1FN, 2FN, 3FN y triggers de auditoría' })
      onLoaded?.()
    }
  }

  return (
    <>
      <Button size="sm" variant={variant} className={cn('gap-1.5', className)} onClick={load}>
        <Database className="size-3.5" />
        Cargar proyecto de ejemplo
      </Button>
      {dialog}
    </>
  )
}

export function VersionsView() {
  const project = useProjectStore((s) => s.project)
  const baseVersionId = useProjectStore((s) => s.baseVersionId)
  const dirty = useIsDirty()
  const live = useLiveDiff(120)
  const navigate = useNavigate()
  const [confirm, confirmDialog] = useConfirm()

  const [zoom, setZoom] = useState<GraphZoom>('semana')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [branchDialog, setBranchDialog] = useState<{ open: boolean; from?: string | null }>({ open: false })
  const isMobile = useIsMobile()
  const [scope, setScope] = useState<'todos' | 'flujo'>('todos')
  const [detailOpen, setDetailOpen] = useState(false)
  const [committing, setCommitting] = useState(false)
  const branchesSheet = usePanelSheet('versions:branches')

  const latest = useMemo(
    () => [...project.versions].sort((a, b) => ts(b.createdAt) - ts(a.createdAt))[0],
    [project.versions],
  )
  const selected =
    project.versions.find((v) => v.id === selectedId) ??
    project.versions.find((v) => v.id === baseVersionId) ??
    latest

  // Al cambiar de proyecto, limpia selección y comparación (ajuste durante el render, sin efecto).
  const [seenProjectId, setSeenProjectId] = useState(project.id)
  if (seenProjectId !== project.id) {
    setSeenProjectId(project.id)
    setSelectedId(null)
    setCompareId(null)
    setPicking(false)
    setDetailOpen(false)
  }

  const select = (id: string) => {
    if (picking && selected && id !== selected.id) {
      setCompareId(id)
      setPicking(false)
      return
    }
    setSelectedId(id)
    if (id === compareId) setCompareId(null)
  }

  const guardDirty = async (title: string) =>
    !dirty ||
    confirm({
      title,
      description: 'Tienes cambios sin confirmar en el borrador. Si continúas se descartarán.',
      confirmLabel: 'Descartar y continuar',
      destructive: true,
    })

  const openInEditor = async () => {
    if (!selected) return
    if (selected.id !== baseVersionId && !(await guardDirty('Abrir versión en el editor'))) return
    if (selected.id !== baseVersionId) await switchWithFlow({ versionId: selected.id })
    navigate('/editor')
  }

  const checkout = async (branchId: string) => {
    if (!(await guardDirty('Cambiar de rama'))) return
    await switchWithFlow({ branchId })
  }

  const selectBranch = (branchId: string) => {
    const vs = branchVersions(project, branchId)
    const head = project.branches.find((b) => b.id === branchId)?.headVersionId
    const target = head ?? vs[vs.length - 1]?.id
    if (target) {
      setSelectedId(target)
      setCompareId(null)
      setPicking(false)
    }
    if (isMobile) {
      setScope('flujo')
      branchesSheet.setOpen(false)
    }
  }

  const activeBranchId = selected?.branchId ?? project.currentBranchId

  const branchPanel = (
    <CollapsiblePanel
      side="left"
      width={288}
      title="Ramas y flujos"
      storageKey="versions:branches"
      shortcut="["
      mobileTrigger={false}
      mobileSide="bottom"
    >
      <BranchList
        project={project}
        activeBranchId={activeBranchId}
        onSelect={selectBranch}
        onCheckout={checkout}
        onCreate={() => setBranchDialog({ open: true, from: undefined })}
      />
    </CollapsiblePanel>
  )

  const detail = selected ? (
    <VersionDetail
      key={selected.id}
      project={project}
      version={selected}
      isBase={selected.id === baseVersionId}
      compareId={compareId}
      picking={picking}
      onOpenInEditor={openInEditor}
      onBranchFrom={() => setBranchDialog({ open: true, from: selected.id })}
      onStartCompare={() => setPicking((p) => !p)}
      onCompare={(id) => {
        setCompareId(id)
        setPicking(false)
      }}
    />
  ) : null

  const dialogs = (
    <>
      <CreateBranchDialog
        open={branchDialog.open}
        fromVersionId={branchDialog.from}
        onOpenChange={(open) => setBranchDialog((s) => ({ ...s, open }))}
      />
      {confirmDialog}
    </>
  )

  if (isMobile) {
    const activeBranch = project.branches.find((b) => b.id === activeBranchId)
    const empty = project.versions.length === 0 && project.branches.length <= 1
    return (
      <div className="flex h-full min-h-0 flex-col">
        {branchPanel}
        <div className="shrink-0 space-y-2.5 border-b px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">Historial de versiones</h1>
            <p className="text-xs text-muted-foreground tabular-nums">
              {project.versions.length} versiones · {project.branches.length} ramas · {project.name}
            </p>
          </div>
          {!empty && (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="h-11 gap-1.5" onClick={branchesSheet.toggle} aria-expanded={branchesSheet.open}>
                <ListTree className="size-4" />
                Flujos
              </Button>
              <ToggleGroup
                type="single"
                variant="outline"
                value={scope}
                onValueChange={(v) => v && setScope(v as 'todos' | 'flujo')}
                aria-label="Versiones a mostrar"
                className="ml-auto"
              >
                <ToggleGroupItem value="todos" className="h-11 px-3">
                  Todos
                </ToggleGroupItem>
                <ToggleGroupItem value="flujo" className="h-11 px-3">
                  Este flujo
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          {!empty && scope === 'flujo' && activeBranch && (
            <p className="truncate text-xs text-muted-foreground">
              Flujo: <span className="font-mono text-foreground">{activeBranch.name}</span>
            </p>
          )}
        </div>

        {empty ? (
          <EmptyState />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {picking && (
              <p className="border-b bg-muted/40 px-4 py-2 text-xs font-medium">Toca la versión con la que comparar.</p>
            )}
            <VersionTimeline
              project={project}
              branchId={scope === 'flujo' ? activeBranchId : null}
              selectedId={selected?.id ?? null}
              compareId={compareId}
              baseVersionId={baseVersionId}
              dirty={dirty}
              draftJumps={live.diff.jumps}
              onSelect={(id) => {
                select(id)
                setDetailOpen(true)
              }}
              onCommit={() => setCommitting(true)}
            />
            <div className="grid gap-2 border-t px-4 py-4">
              <ReportPdfButton size="default" className="h-11 w-full" />
              <LoadSampleButton className="h-11 w-full" />
            </div>
          </div>
        )}

        <Sheet open={detailOpen && !!selected} onOpenChange={setDetailOpen}>
          <SheetContent side="bottom" className="h-[92svh] gap-0 rounded-t-xl data-[side=bottom]:h-[92svh] p-0 pb-[env(safe-area-inset-bottom)]">
            <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
            <SheetHeader className="shrink-0 border-b px-4 py-2.5 pr-14">
              <SheetTitle>Detalle de la versión</SheetTitle>
              <SheetDescription className="sr-only">Acciones, cambios y SQL de la versión seleccionada</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{detail}</div>
          </SheetContent>
        </Sheet>
        <CommitDialog open={committing} onOpenChange={setCommitting} />
        {dialogs}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="hidden md:flex">{branchPanel}</div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
          <div>
            <h1 className="text-sm font-semibold">Historial de versiones</h1>
            <p className="text-xs text-muted-foreground tabular-nums">
              {project.versions.length} versiones · {project.branches.length} ramas · {project.name}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground" id="zoom-label">
              Escala
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={zoom}
              onValueChange={(v) => v && setZoom(v as GraphZoom)}
              aria-labelledby="zoom-label"
            >
              <ToggleGroupItem value="dia">Día</ToggleGroupItem>
              <ToggleGroupItem value="semana">Semana</ToggleGroupItem>
            </ToggleGroup>
            <ReportPdfButton />
            <LoadSampleButton />
          </div>
        </div>

        {project.versions.length === 0 && project.branches.length <= 1 ? (
          <EmptyState />
        ) : (
          <>
            <div className="border-b">
              <VersionGraph
                project={project}
                zoom={zoom}
                selectedId={selected?.id ?? null}
                compareId={compareId}
                baseVersionId={baseVersionId}
                dirty={dirty}
                draftJumps={live.diff.jumps}
                onSelect={select}
                onSelectBranch={selectBranch}
              />
              <p className="border-t px-4 py-1.5 text-xs text-muted-foreground">
                <span aria-hidden>●</span> cabeza de rama · <span aria-hidden>○</span> versión intermedia · tamaño y número = saltos respecto
                a la anterior · «+1 vista», «+2 triggers» = cambios en vistas/triggers · «actual» = versión cargada en el editor
                {picking && <span className="ml-2 font-medium text-foreground">Elige en el grafo la versión con la que comparar.</span>}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-5xl px-6 py-5">
                {detail ?? (
                  <p className="text-sm text-muted-foreground">
                    Esta rama aún no tiene versiones. Edita el diagrama y confirma una versión desde el selector de ramas.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {dialogs}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-3 text-center">
        <GitBranch className="mx-auto size-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">Aún no hay versiones</h2>
        <p className="text-sm text-muted-foreground">
          Diseña el esquema en el editor y confirma la primera versión desde el selector de ramas de la cabecera, o carga el proyecto de
          ejemplo «tienda-online» para ver los flujos de normalización 1FN → 2FN → 3FN y de triggers de auditoría.
        </p>
        <div className="pt-1">
          <LoadSampleButton variant="default" />
        </div>
      </div>
    </div>
  )
}
