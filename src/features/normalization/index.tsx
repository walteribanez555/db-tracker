import { Check, GitBranch, Sparkles, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'

import { CollapsiblePanel } from '@/components/layout/collapsible-panel'
import { FlowSteps, useOperationStore, type Operation } from '@/components/operation-flow'
import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { relationName } from '@/features/triggers/lib/graph'
import { cn } from '@/lib/utils'
import { useCurrentBranch, useProjectStore } from '@/store/project'
import type { Schema } from '@/types/schema'

import { BeforeAfter } from './components/BeforeAfter'
import { BranchDialog, type BranchDraft } from './components/BranchDialog'
import { slugify } from './lib/names'
import { buildPreview } from './lib/preview'
import {
  analyzeSchema,
  describeFix,
  LEVELS,
  normalFormStatus,
  RULE_LABELS,
  type Finding,
  type LevelStatus,
  type NormalLevel,
  type Severity,
} from './lib/rules'
import { createSampleSchema } from './lib/sample'
import { operationTitle, previewSteps, runFix } from './operations'

interface ActiveOp {
  opId: string
  findingId: string
  title: string
}

const LEVEL_TITLE: Record<NormalLevel, string> = {
  '1FN': 'Primera forma normal',
  '2FN': 'Segunda forma normal',
  '3FN': 'Tercera forma normal',
  BCNF: 'Forma normal de Boyce-Codd',
  'buenas-prácticas': 'Buenas prácticas',
}

const SEVERITY_CLS: Record<Severity, string> = {
  alta: 'text-destructive',
  media: 'text-amber-700 dark:text-amber-400',
  baja: 'text-muted-foreground',
}

export function NormalizationView() {
  const draft = useProjectStore((s) => s.draft)
  const replaceDraft = useProjectStore((s) => s.replaceDraft)
  const findings = useMemo(() => analyzeSchema(draft), [draft])
  const status = useMemo(() => normalFormStatus(draft, findings), [draft, findings])
  const [picked, setPicked] = useState<{ id: string; index: number } | null>(null)
  const [active, setActive] = useState<ActiveOp | null>(null)
  const activeOp = useOperationStore((s) => (active ? s.operations.find((o) => o.id === active.opId) : undefined))
  const busy = activeOp?.status === 'running'
  const navigate = useNavigate()

  const start = (finding: Finding, mode: { kind: 'draft' } | { kind: 'branch'; form: BranchDraft }) => {
    if (busy) return
    const run = runFix(finding, mode)
    if (!run) return
    setActive({ opId: run.opId, findingId: finding.id, title: finding.title })
    void run.done.then((r) => {
      if (!r.ok) {
        toast.error('La corrección no se completó', {
          description: r.error instanceof Error ? r.error.message : String(r.error),
          action: mode.kind === 'draft' ? { label: 'Restaurar', onClick: () => replaceDraft(run.before) } : undefined,
        })
        return
      }
      if (mode.kind === 'draft')
        toast.success('Corrección aplicada en el borrador', {
          description: finding.title,
          action: { label: 'Deshacer', onClick: () => replaceDraft(run.before) },
        })
      else
        toast.success(`Flujo ${mode.form.name} creado`, {
          description: mode.form.message,
          action: { label: 'Ver versiones', onClick: () => navigate('/versiones') },
        })
    })
  }

  // Si el hallazgo seleccionado desaparece (p. ej. tras aplicarlo), se pasa al que ocupaba su lugar.
  const selected = findings.find((f) => f.id === picked?.id) ?? findings[Math.min(picked?.index ?? 0, findings.length - 1)]
  const onSelect = (id: string) => setPicked({ id, index: findings.findIndex((f) => f.id === id) })

  if (!draft.tables.length)
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <Sparkles className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-medium">Asesor de normalización</h1>
        <p className="text-sm text-muted-foreground">
          Analiza el esquema y explica, paso a paso, qué le falta para cumplir 1FN, 2FN, 3FN y BCNF. Crea tablas en el Diagrama o prueba con un
          esquema de ejemplo lleno de problemas típicos.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/editor">Ir al Diagrama</Link>
          </Button>
          <Button onClick={() => replaceDraft(createSampleSchema())}>Cargar ejemplo</Button>
        </div>
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScoreHeader status={status} findings={findings} />
      <div className="flex min-h-0 flex-1">
        <FindingList findings={findings} schema={draft} selectedId={selected?.id} onSelect={onSelect} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          {activeOp && active && active.findingId !== selected?.id && (
            <section
              className="border-b px-6 py-3 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"
              aria-label="Última corrección aplicada"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{busy ? 'Aplicando' : activeOp.status === 'error' ? 'Falló' : 'Aplicado'}:</span>
                <span className="truncate text-foreground">{active.title}</span>
                <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setActive(null)} disabled={busy}>
                  Ocultar
                </Button>
              </div>
              <FlowSteps operation={activeOp} />
            </section>
          )}
          {selected ? (
            <FindingDetail
              key={selected.id}
              finding={selected}
              schema={draft}
              operation={active?.findingId === selected.id ? activeOp : undefined}
              busy={busy}
              onApply={(mode) => start(selected, mode)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <Check className="size-8 text-emerald-600" aria-hidden />
              <p className="font-medium">Sin hallazgos</p>
              <p className="max-w-sm text-sm text-muted-foreground">El esquema alcanza BCNF según las heurísticas y sigue las buenas prácticas revisadas.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ScoreHeader({ status, findings }: { status: LevelStatus[]; findings: Finding[] }) {
  const reached = status.filter((s) => s.reached)
  const highest = reached.length ? reached[reached.length - 1].level : null
  const count = (sev: Severity) => findings.filter((f) => f.severity === sev).length

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b px-6 py-4">
      <div>
        <h1 className="text-lg font-medium">Asesor de normalización</h1>
        <p className="text-sm text-muted-foreground">
          Forma normal alcanzada: <span className="font-medium text-foreground">{highest ?? 'ninguna'}</span>
          <span className="mx-1.5">·</span>
          {findings.length} hallazgos ({count('alta')} alta, {count('media')} media, {count('baja')} baja)
        </p>
      </div>
      <ol className="grid w-full max-w-md grid-cols-4 gap-1.5" aria-label="Progreso de normalización">
        {status.map((s, i) => {
          const pct = s.reached ? 100 : s.totalTables ? (s.compliantTables / s.totalTables) * 100 : 0
          return (
            <li key={s.level}>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
                aria-label={`${s.level}: ${s.reached ? 'alcanzada' : `${s.compliantTables} de ${s.totalTables} tablas cumplen`}`}
              >
                <div
                  className={cn(
                    'h-full animate-in slide-in-from-left-full fill-mode-both transition-[width,background-color] duration-500 ease-out motion-reduce:animate-none motion-reduce:transition-none',
                    s.reached ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-foreground/30',
                  )}
                  style={{ width: `${pct}%`, animationDelay: `${i * 80}ms` }}
                />
              </div>
              <p className="mt-1.5 text-xs">
                <span className="font-medium">{s.level}</span>{' '}
                <span className="text-muted-foreground">
                  {s.reached ? 'cumple' : s.blocking ? `${s.blocking} por resolver` : 'bloqueada'}
                </span>
              </p>
            </li>
          )
        })}
      </ol>
    </header>
  )
}

function FindingList({
  findings,
  schema,
  selectedId,
  onSelect,
}: {
  findings: Finding[]
  schema: Schema
  selectedId?: string
  onSelect: (id: string) => void
}) {
  const groups = LEVELS.map((level) => ({ level, items: findings.filter((f) => f.level === level) })).filter((g) => g.items.length)
  return (
    <CollapsiblePanel side="left" width={380} title="Hallazgos" storageKey="normalizacion-hallazgos" shortcut="[">
      <nav className="pb-4" aria-label="Hallazgos">
        {groups.map((g) => (
          <CollapsibleSection
            key={g.level}
            title={
              <>
                <span className="text-foreground">{g.level === 'buenas-prácticas' ? 'Buenas prácticas' : g.level}</span>
                {g.level !== 'buenas-prácticas' && <span className="ml-1.5 font-normal">{LEVEL_TITLE[g.level]}</span>}
              </>
            }
            meta={<span className="transition-opacity duration-200">{g.items.length}</span>}
            storageKey={`normalizacion-${g.level}`}
            className="border-b px-2.5 py-1.5"
            contentClassName="-mx-2.5"
          >
            <ul className="divide-y border-t">
              {g.items.map((f, i) => (
                <li
                  key={f.id}
                  className="animate-in fade-in slide-in-from-top-1 fill-mode-both duration-200 motion-reduce:animate-none"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(f.id)}
                    aria-current={f.id === selectedId ? 'true' : undefined}
                    className={cn(
                      'relative w-full px-4 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                      'before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand before:opacity-0 before:transition-opacity',
                      f.id === selectedId && 'bg-brand/10 before:opacity-100 hover:bg-brand/10',
                    )}
                  >
                    <span className="block text-sm leading-snug">{f.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {relationName(schema, f.tableId)} · {RULE_LABELS[f.rule]} · <span className={SEVERITY_CLS[f.severity]}>severidad {f.severity}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        ))}
      </nav>
    </CollapsiblePanel>
  )
}

function uniqueBranchName(base: string, taken: string[]): string {
  let name = base
  for (let i = 2; taken.includes(name); i++) name = `${base}-${i}`
  return name
}

function FindingDetail({
  finding,
  schema,
  operation,
  busy,
  onApply,
}: {
  finding: Finding
  schema: Schema
  /** Operación en curso (o recién terminada) de este hallazgo. */
  operation?: Operation
  busy: boolean
  onApply: (mode: { kind: 'draft' } | { kind: 'branch'; form: BranchDraft }) => void
}) {
  const branches = useProjectStore((s) => s.project.branches)
  const branch = useCurrentBranch()
  const [branchForm, setBranchForm] = useState<BranchDraft | null>(null)
  const fix = finding.fix
  const preview = useMemo(() => (fix ? buildPreview(schema, fix) : null), [schema, fix])
  const change = fix ? describeFix(schema, fix) : ''
  const relName = relationName(schema, finding.tableId)

  const applyInDraft = () => onApply({ kind: 'draft' })
  // Vista previa del flujo: los pasos reales del plan, pendientes hasta que se aplique.
  const previewOp = useMemo<Operation | null>(() => {
    const steps = previewSteps(schema, finding)
    return steps.length ? { id: `preview-${finding.id}`, title: operationTitle(finding), status: 'running', steps, startedAt: 0 } : null
  }, [schema, finding])

  const openBranchDialog = () => {
    if (!fix) return
    const base = `flujo/normalizacion-${slugify(`${finding.level} ${relName} ${finding.rule}`)}`
    setBranchForm({
      name: uniqueBranchName(base, branches.map((b) => b.name)),
      description: `${finding.title}. ${finding.suggestion}`,
      message: `Normalización (${finding.level}): ${change}`,
    })
  }

  const applyInBranch = (form: BranchDraft) => {
    setBranchForm(null)
    onApply({ kind: 'branch', form })
  }

  return (
    <article className="max-w-4xl space-y-6 p-6 animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none">
      <header className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          {finding.level === 'buenas-prácticas' ? 'Buenas prácticas' : `${finding.level} · ${LEVEL_TITLE[finding.level]}`}
          <span className="mx-1.5">·</span>
          {RULE_LABELS[finding.rule]}
          <span className="mx-1.5">·</span>
          <span className={SEVERITY_CLS[finding.severity]}>severidad {finding.severity}</span>
        </p>
        <h2 className="text-xl font-medium tracking-tight">{finding.title}</h2>
      </header>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium">Por qué importa</h3>
        <p className="max-w-prose text-sm leading-relaxed text-foreground/85">{finding.explanation}</p>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-sm font-medium">Qué hacer</h3>
        <p className="max-w-prose text-sm leading-relaxed text-foreground/85">{finding.suggestion}</p>
      </section>

      {fix && preview ? (
        <>
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">Antes y después</h3>
              <p className="text-sm text-muted-foreground">Cambio propuesto: {change}.</p>
            </div>
            <BeforeAfter before={preview.before} after={preview.after} migrations={preview.migrations} onApply={busy ? undefined : applyInDraft} applyLabel="en el borrador" />
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="text-emerald-700 dark:text-emerald-400">verde</span>: añadido
              </span>
              <span>
                <span className="text-amber-700 dark:text-amber-400">ámbar</span>: modificado
              </span>
              <span>
                <span className="text-destructive line-through">rojo</span>: se elimina o se mueve
              </span>
            </p>
          </section>
          {(operation ?? previewOp) && (
            <section className="space-y-1" aria-label="Flujo de la corrección">
              <h3 className="text-sm font-medium">Flujo</h3>
              <p className="text-xs text-muted-foreground">
                {operation
                  ? operation.status === 'running'
                    ? 'Aplicando paso a paso…'
                    : operation.status === 'error'
                      ? `Se detuvo: ${operation.error ?? 'error'}`
                      : 'Aplicado.'
                  : `Vista previa: ${previewOp!.steps.length} paso${previewOp!.steps.length > 1 ? 's' : ''} que se ejecutarán en orden.`}
              </p>
              <div className="-mx-4">
                <FlowSteps operation={operation ?? previewOp!} />
              </div>
            </section>
          )}
          <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button onClick={applyInDraft} disabled={busy}>
              <Wand2 />
              Aplicar en el borrador
            </Button>
            <Button variant="outline" onClick={openBranchDialog} disabled={busy}>
              <GitBranch />
              Aplicar en un flujo nuevo
            </Button>
            <p className="text-xs text-muted-foreground">
              El borrador es el de <span className="font-mono">{branch?.name}</span>. Un flujo nuevo guarda este consejo como una rama con su propia versión.
            </p>
          </footer>
        </>
      ) : (
        <p className="border-t pt-4 text-sm text-muted-foreground">
          Este hallazgo requiere una decisión de diseño y no tiene corrección automática. Edítalo en el Diagrama.
        </p>
      )}

      {branchForm && <BranchDialog initial={branchForm} onCancel={() => setBranchForm(null)} onConfirm={applyInBranch} />}
    </article>
  )
}
