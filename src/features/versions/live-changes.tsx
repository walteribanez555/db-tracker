// Cambios en vivo: diff versión base → borrador como un flujo visual (base → objetos cambiados → borrador).
import { ArrowRight, Eye, FileCode2, GitCommitHorizontal, Link2, Table2, Undo2, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { CodeDiff, sqlLanguageFor } from '@/components/code'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { emptySchema, useCurrentBranch, useProjectStore } from '@/store/project'

import { CommitDialog } from './components/CommitDialog'
import { useConfirm } from './components/ConfirmDialog'
import { DIFF_TEXT, fmtDate, useIsDirty, useLaneColor, type DiffKind } from './lib'
import { useLiveDiff, type ChangeLine, type ObjectChange, type ObjectKind } from './live-diff'
import { ddlOf } from './sql'
import { usePresence } from './use-presence'

const SIGN: Record<DiffKind, string> = { add: '+', remove: '−', change: '~' }
const SR: Record<DiffKind, string> = { add: 'añadido', remove: 'eliminado', change: 'cambiado' }
const KIND_LABEL: Record<ObjectKind, string> = { table: 'tabla', view: 'vista', trigger: 'trigger', relation: 'relación' }
const KIND_ICON: Record<ObjectKind, typeof Table2> = { table: Table2, view: Eye, trigger: Zap, relation: Link2 }

const ENTER = 'animate-in fade-in slide-in-from-top-1 duration-200 ease-out fill-mode-both'
const EXIT = 'animate-out fade-out duration-200 ease-out fill-mode-forwards pointer-events-none'

function Connector() {
  return <div aria-hidden className="h-px w-5 shrink-0 self-center bg-border" />
}

function Line({ line, exiting }: { line: ChangeLine; exiting: boolean }) {
  return (
    <li className={cn('flex gap-1.5 font-mono text-[11px] leading-4', DIFF_TEXT[line.kind], exiting ? EXIT : ENTER)}>
      <span aria-hidden className="w-2.5 shrink-0 text-center font-semibold">
        {SIGN[line.kind]}
      </span>
      <span className="sr-only">{SR[line.kind]}: </span>
      <span className="min-w-0">
        <span className="break-words">{line.text}</span>
        {line.detail && <span className="block truncate text-muted-foreground" title={line.detail}>{line.detail}</span>}
      </span>
    </li>
  )
}

function ChangeColumn({ change, exiting, onOpen }: { change: ObjectChange; exiting: boolean; onOpen: (c: ObjectChange) => void }) {
  const lines = usePresence(change.lines, (l) => l.key)
  const Icon = KIND_ICON[change.objectKind]
  const header = (
    <>
      <span aria-hidden className={cn('w-2.5 shrink-0 text-center font-mono font-semibold', DIFF_TEXT[change.status])}>
        {SIGN[change.status]}
      </span>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className={cn('min-w-0 truncate font-mono text-xs font-medium', change.status === 'remove' && 'line-through decoration-1')}>{change.name}</span>
      <span className="sr-only">
        {KIND_LABEL[change.objectKind]} {SR[change.status]}
      </span>
    </>
  )
  return (
    <div className={cn('flex w-56 shrink-0 flex-col rounded-md border bg-background', exiting ? EXIT : ENTER)}>
      {change.inDraft ? (
        <button
          type="button"
          onClick={() => onOpen(change)}
          title={`Abrir ${KIND_LABEL[change.objectKind]} ${change.name} en el editor`}
          className="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">{header}</div>
      )}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-1.5">
        {lines.length === 0 && (
          <li className="text-[11px] text-muted-foreground">
            {change.status === 'remove' ? `${KIND_LABEL[change.objectKind]} eliminada del borrador` : `${KIND_LABEL[change.objectKind]} nueva`}
          </li>
        )}
        {lines.map((l) => (
          <Line key={l.key} line={l.item} exiting={l.exiting} />
        ))}
      </ul>
    </div>
  )
}

/** Diff de DDL base → borrador (sin debounce: se calcula al abrir). */
function SqlDiff({ baseLabel }: { baseLabel: string }) {
  const draft = useProjectStore((s) => s.draft)
  const base = useProjectStore((s) => (s.baseVersionId ? s.project.versions.find((v) => v.id === s.baseVersionId)?.schema : undefined))
  const dialect = useProjectStore((s) => s.project.dialect)
  const original = useMemo(() => ddlOf(base ?? emptySchema(dialect)), [base, dialect])
  const modified = useMemo(() => ddlOf(draft), [draft])
  return (
    <CodeDiff
      original={original}
      modified={modified}
      language={sqlLanguageFor(dialect)}
      originalLabel={baseLabel}
      modifiedLabel="borrador"
      height={540}
    />
  )
}

/** Diff en vivo entre la versión base y el borrador, como flujo: base → cambios por objeto → borrador. */
export function LiveChanges() {
  const { base, diff, changes, moved } = useLiveDiff(120)
  const storeDirty = useIsDirty()
  const branch = useCurrentBranch()
  const discardDraft = useProjectStore((s) => s.discardDraft)
  const setSelection = useProjectStore((s) => s.setSelection)
  const laneColor = useLaneColor()
  const navigate = useNavigate()
  const [committing, setCommitting] = useState(false)
  const [showSql, setShowSql] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const columns = usePresence(changes, (c) => c.key)
  const baseBranch = useProjectStore((s) => (base ? s.project.branches.find((b) => b.id === base.branchId) : undefined))
  const structural = diff.jumps > 0 || changes.length > 0
  const dirty = structural || storeDirty

  const open = (c: ObjectChange) => {
    setSelection({ kind: c.objectKind, id: c.id })
    navigate(c.objectKind === 'trigger' ? '/triggers' : '/editor')
  }

  const discard = async () => {
    if (
      await confirm({
        title: 'Descartar cambios',
        description: 'El borrador volverá al estado de la versión base. Esta acción no se puede deshacer.',
        confirmLabel: 'Descartar cambios',
        destructive: true,
      })
    ) {
      discardDraft()
      toast('Cambios descartados')
    }
  }

  return (
    <div className="flex h-full min-w-0 gap-3 p-3">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto pb-1" aria-live="polite">
        {/* Nodo: versión base */}
        <div className="flex w-52 shrink-0 flex-col justify-center gap-1 rounded-md border px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full" style={{ background: laneColor(baseBranch?.color ?? branch.color) }} />
            <span className="truncate font-mono">{baseBranch?.name ?? branch.name}</span>
            <span>· base</span>
          </div>
          <div className="line-clamp-2 text-xs font-medium">{base?.message ?? 'Esquema vacío'}</div>
          {base && <div className="text-[11px] text-muted-foreground">{fmtDate(base.createdAt)}</div>}
        </div>

        {columns.length === 0 ? (
          <>
            <Connector />
            <p className="self-center px-3 text-xs text-muted-foreground">
              {storeDirty ? (
                moved > 0 ? (
                  <>
                    Solo cambios de posición en <span className="text-foreground tabular-nums">{moved}</span> {moved === 1 ? 'elemento' : 'elementos'}; la estructura
                    coincide con {base ? <span className="text-foreground">«{base.message}»</span> : 'el esquema vacío'}.
                  </>
                ) : (
                  'Solo cambios sin efecto estructural (comentarios, colores o notas).'
                )
              ) : (
                <>
                  El borrador coincide con {base ? <span className="text-foreground">«{base.message}»</span> : 'el esquema vacío'}.
                </>
              )}
            </p>
          </>
        ) : (
          columns.map((c) => (
            <div key={c.key} className="flex shrink-0 items-stretch">
              <Connector />
              <ChangeColumn change={c.item} exiting={c.exiting} onOpen={open} />
            </div>
          ))
        )}

        <Connector />
        {/* Nodo: borrador */}
        <div className={cn('flex w-40 shrink-0 flex-col justify-center gap-1 rounded-md border px-3 py-2', dirty && 'border-brand/60')}>
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
            Borrador
          </div>
          <div key={diff.jumps} className="animate-in text-[11px] text-muted-foreground tabular-nums duration-300 fade-in">
            {structural
              ? `${diff.jumps} ${diff.jumps === 1 ? 'salto' : 'saltos'} · ${changes.length} ${changes.length === 1 ? 'objeto' : 'objetos'}`
              : dirty
                ? moved
                  ? `${moved} ${moved === 1 ? 'movido' : 'movidos'} · sin saltos`
                  : 'sin saltos'
                : 'sin cambios'}
          </div>
        </div>
      </div>

      <div className="flex w-44 shrink-0 flex-col justify-center gap-2 border-l pl-3">
        <Button size="sm" className="gap-1.5" disabled={!dirty} onClick={() => setCommitting(true)}>
          <GitCommitHorizontal className="size-3.5" />
          Confirmar versión
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!dirty} onClick={discard}>
          <Undo2 className="size-3.5" />
          Descartar
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setShowSql(true)}>
          <FileCode2 className="size-3.5" />
          Ver SQL
        </Button>
      </div>

      <CommitDialog open={committing} onOpenChange={setCommitting} />
      <Dialog open={showSql} onOpenChange={setShowSql}>
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>DDL: base → borrador</DialogTitle>
            <DialogDescription>
              {base ? `«${base.message}»` : 'Esquema vacío'} frente al borrador de {branch.name}. Solo se muestran diferencias reales del SQL generado.
            </DialogDescription>
          </DialogHeader>
          {showSql && <SqlDiff baseLabel={base ? `${baseBranch?.name ?? branch.name} · ${base.message}` : 'esquema vacío'} />}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  )
}
