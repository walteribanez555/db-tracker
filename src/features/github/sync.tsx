import { Check, ExternalLink, Loader2, Minus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { GithubLink, Project } from '@/types/schema'

import { githubApi, GithubApiError, githubUrls } from './api'
import { plural, shortSha } from './format'
import { ProgressBar, ProgressList, type RowState } from './progress-list'
import { PullPanel } from './pull'
import type { RefResult, RemoteBranch } from './types'
import type { SyncRun, useSyncRunner } from './useSyncRunner'

// ---------- Estado por rama ----------

type BranchStatus = { tone: 'ok' | 'pending' | 'warn' | 'muted'; label: string }

function branchStatus(project: Project, branchId: string, remote: RemoteBranch[] | null, refs: RefResult[]): BranchStatus {
  const b = project.branches.find((x) => x.id === branchId)!
  const versions = project.versions.filter((v) => v.branchId === b.id)
  const headId = b.headVersionId ?? b.forkedFromVersionId
  if (!headId) return { tone: 'muted', label: 'Sin versiones' }
  const pending = versions.filter((v) => !v.githubSha).length
  const r = remote?.find((x) => x.name === b.name)
  const localShas = new Set(project.versions.map((v) => v.githubSha).filter(Boolean))
  if (r && !localShas.has(r.sha)) return { tone: 'warn', label: 'Hay commits en GitHub que no tienes' }
  if (pending) return { tone: 'pending', label: `${plural(pending, 'versión sin subir', 'versiones sin subir')}` }
  if (refs.find((x) => x.branch === b.name && x.status === 'conflict')) return { tone: 'warn', label: 'Diverge de GitHub (requiere forzar)' }
  if (!remote) return { tone: 'muted', label: 'Comprobando…' }
  const headSha = project.versions.find((v) => v.id === headId)?.githubSha
  if (!r) return { tone: 'pending', label: 'Rama sin subir' }
  if (r.sha !== headSha) return { tone: 'pending', label: 'GitHub va por detrás' }
  return { tone: 'ok', label: 'Al día' }
}

// Colores de estado con contraste suficiente en claro y en oscuro.
const DOT: Record<BranchStatus['tone'], string> = {
  ok: 'bg-emerald-600 dark:bg-emerald-400',
  pending: 'bg-amber-500 dark:bg-amber-300',
  warn: 'bg-red-600 dark:bg-red-400',
  muted: 'bg-muted-foreground/50',
}
const LABEL: Record<BranchStatus['tone'], string> = {
  ok: 'text-foreground',
  pending: 'text-foreground',
  warn: 'text-red-700 dark:text-red-400',
  muted: 'text-muted-foreground',
}

const SECTION = 'border-b py-4'
const CONTENT = 'pt-3'

// ---------- Vista ----------

export function SyncSection({ link, runner }: { link: GithubLink; runner: ReturnType<typeof useSyncRunner> }) {
  const project = useProjectStore((s) => s.project)
  const [force, setForce] = useState(false)
  const repoKey = `${link.owner}/${link.repo}`
  const [remoteState, setRemoteState] = useState<{ key: string; branches: RemoteBranch[] | null; error: string | null } | null>(null)
  const remote = remoteState?.key === repoKey ? remoteState.branches : null
  const remoteError = remoteState?.key === repoKey ? remoteState.error : null
  const { run, start, running } = runner
  const [panel, setPanel] = useState<'none' | 'pull' | 'confirm-push'>('none')
  const [aheadOf, setAheadOf] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const isMobile = useIsMobile()

  const loadRemote = useCallback(() => {
    const key = `${link.owner}/${link.repo}`
    githubApi
      .branches(link.owner, link.repo)
      .then((branches) => setRemoteState({ key, branches, error: null }))
      .catch((err) =>
        setRemoteState({ key, branches: null, error: err instanceof GithubApiError ? err.message : 'No se pudieron leer las ramas remotas.' }),
      )
  }, [link.owner, link.repo])

  useEffect(() => {
    loadRemote()
  }, [loadRemote])

  // Recarga el estado remoto al terminar una subida.
  const runStatus = run?.status
  useEffect(() => {
    if (runStatus === 'done' || runStatus === 'error') loadRemote()
  }, [runStatus, loadRemote])

  // La comprobación de ramas remotas es el primer paso de la operación (dock); si alguien subió desde
  // otra sesión, la subida no empieza y se propone bajar primero.
  const push = (ignoreAhead: boolean) => {
    setPanel('none')
    setChecking(true)
    void start({
      link,
      force,
      ignoreAhead,
      onAhead: (ahead) => {
        setAheadOf(ahead)
        setPanel('confirm-push')
        loadRemote()
      },
    }).finally(() => setChecking(false))
  }

  const totalPending = project.versions.filter((v) => !v.githubSha).length
  const versionsById = useMemo(() => new Map(project.versions.map((v) => [v.id, v])), [project.versions])
  const branchName = (id: string) => project.branches.find((b) => b.id === id)?.name ?? '?'
  const remoteNames = new Set(remote?.map((r) => r.name))
  const upToDate = project.branches.filter((b) => branchStatus(project, b.id, remote, run?.refs ?? []).tone === 'ok').length

  return (
    <>
      <CollapsibleSection
        title="Ramas por flujo"
        meta={
          <span key={upToDate} className="animate-in fade-in duration-200">
            {upToDate} de {project.branches.length} al día
          </span>
        }
        storageKey="github:branches"
        className={SECTION}
        contentClassName={CONTENT}
      >
        {remoteError && <p className="mb-3 text-sm text-destructive">{remoteError}</p>}
        {isMobile ? (
          // Móvil: lista en lugar de tabla (nombre y estado arriba; versiones y enlaces debajo).
          <ul className="divide-y border-y">
            {project.branches.map((b) => {
              const st = branchStatus(project, b.id, remote, run?.refs ?? [])
              const count = project.versions.filter((v) => v.branchId === b.id).length
              const published = remoteNames.has(b.name)
              return (
                <li key={b.id} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full bg-(--branch) dark:bg-[color-mix(in_oklab,var(--branch),white_40%)]"
                      style={{ '--branch': b.color } as React.CSSProperties}
                    />
                    <span className="min-w-0 truncate font-mono text-sm">{b.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{plural(count, 'versión', 'versiones')}</span>
                  </div>
                  {b.description && <p className="truncate pl-4.5 text-xs text-muted-foreground">{b.description}</p>}
                  <div className="flex items-center gap-3 pl-4.5 text-sm">
                    <span className={cn('flex min-w-0 items-center gap-2', LABEL[st.tone])}>
                      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[st.tone])} />
                      <span className="truncate">{st.label}</span>
                    </span>
                    {published && (
                      <span className="ml-auto flex shrink-0">
                        <a className="flex h-11 items-center px-2 hover:text-brand hover:underline" href={githubUrls.branch(link.owner, link.repo, b.name)} target="_blank" rel="noreferrer">
                          Rama
                        </a>
                        <a className="flex h-11 items-center px-2 hover:text-brand hover:underline" href={githubUrls.commits(link.owner, link.repo, b.name)} target="_blank" rel="noreferrer">
                          Commits
                        </a>
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flujo</TableHead>
                <TableHead className="text-right">Versiones</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">En GitHub</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {project.branches.map((b, i) => {
                const st = branchStatus(project, b.id, remote, run?.refs ?? [])
                const count = project.versions.filter((v) => v.branchId === b.id).length
                const published = remoteNames.has(b.name)
                return (
                  <TableRow
                    key={b.id}
                    style={i < 8 ? { animationDelay: `${i * 30}ms` } : undefined}
                    className="transition-colors animate-in fade-in slide-in-from-top-1 fill-mode-backwards duration-200"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full bg-(--branch) dark:bg-[color-mix(in_oklab,var(--branch),white_40%)]"
                          style={{ '--branch': b.color } as React.CSSProperties}
                        />
                        <span className="font-mono">{b.name}</span>
                      </div>
                      {b.description && <div className="mt-0.5 max-w-md truncate pl-4.5 text-xs text-muted-foreground">{b.description}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{count}</TableCell>
                    <TableCell>
                      <span key={st.label} className={cn('flex items-center gap-2 animate-in fade-in duration-200', LABEL[st.tone])}>
                        <span className={cn('size-1.5 shrink-0 rounded-full transition-colors', DOT[st.tone])} />
                        {st.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {published ? (
                        <span className="inline-flex gap-3 text-sm">
                          <a className="transition-colors hover:text-brand hover:underline" href={githubUrls.branch(link.owner, link.repo, b.name)} target="_blank" rel="noreferrer">
                            Rama
                          </a>
                          <a className="transition-colors hover:text-brand hover:underline" href={githubUrls.commits(link.owner, link.repo, b.name)} target="_blank" rel="noreferrer">
                            Commits
                          </a>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Subir y bajar"
        meta={totalPending ? `${plural(totalPending, 'versión sin subir', 'versiones sin subir')}` : 'nada pendiente'}
        storageKey="github:push-pull"
        className={SECTION}
        contentClassName={CONTENT}
      >
        <p className="max-w-2xl text-sm text-muted-foreground">
          <span className="text-foreground">Subir</span> publica cada flujo como una rama y cada versión como un commit con su autor y fecha
          originales; el padre de cada commit es la versión de la que nace, así el grafo de GitHub muestra las bifurcaciones.{' '}
          <span className="text-foreground">Bajar</span> reconstruye el proyecto desde el repositorio y reemplaza el local. Nada se hace en
          segundo plano: solo cuando pulsas un botón.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button className="max-md:h-11" onClick={() => push(false)} disabled={running || checking || !project.versions.length}>
            {(running || checking) && <Loader2 className="animate-spin" />}
            {running ? 'Subiendo…' : 'Subir'}
            {!running && totalPending > 0 && (
              <span key={totalPending} className="tabular-nums animate-in fade-in duration-200">
                ({totalPending})
              </span>
            )}
          </Button>
          <Button className="max-md:h-11" variant="outline" onClick={() => setPanel((p) => (p === 'pull' ? 'none' : 'pull'))} disabled={running}>
            Bajar
          </Button>
          <label className="ml-2 flex items-center gap-2 text-sm" title="Reescribe ramas remotas que no avanzan en fast-forward (equivale a push --force).">
            <Switch checked={force} onCheckedChange={setForce} size="sm" />
            Forzar actualización de ramas
          </label>
        </div>
        {force && (
          <p className="mt-3 text-sm text-amber-800 animate-in fade-in duration-200 dark:text-amber-300">
            Con esta opción, los commits que existan en GitHub y no estén en DB Tracker se perderán en las ramas afectadas.
          </p>
        )}

        {panel === 'confirm-push' && (
          <div className="mt-4 space-y-3 border-y py-4 text-sm animate-in fade-in slide-in-from-top-1 duration-200">
            <p>
              En GitHub hay commits que no tienes en {aheadOf.length === 1 ? 'la rama' : 'las ramas'}{' '}
              {aheadOf.map((n, i) => (
                <span key={n}>
                  {i > 0 && ', '}
                  <span className="font-mono">{n}</span>
                </span>
              ))}
              . Probablemente alguien subió desde otra sesión.{' '}
              {force
                ? 'Con «Forzar actualización de ramas» activado, esos commits se perderán.'
                : 'Si subes ahora, esas ramas no se actualizarán (no es fast-forward).'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button className="max-md:h-11" onClick={() => setPanel('pull')}>Bajar primero</Button>
              <Button
                className="max-md:h-11"
                variant={force ? 'destructive' : 'outline'}
                onClick={() => push(true)}
              >
                {force ? 'Subir forzando' : 'Subir de todos modos'}
              </Button>
              <Button className="max-md:h-11" variant="ghost" onClick={() => setPanel('none')}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {panel === 'pull' && (
          <div className="mt-4 border-y py-4 animate-in fade-in slide-in-from-top-1 duration-200">
            <h3 className="mb-3 text-sm font-medium">
              Bajar de {link.owner}/{link.repo}
            </h3>
            <PullPanel initial={{ owner: link.owner, repo: link.repo }} onDone={() => setPanel('none')} />
          </div>
        )}
      </CollapsibleSection>

      {run && (
        <CollapsibleSection
          title="Progreso de la subida"
          meta={run.status === 'running' ? 'en curso' : run.status === 'done' ? 'completada' : 'interrumpida'}
          storageKey="github:progress"
          className={SECTION}
          contentClassName={CONTENT}
        >
          <RunLog run={run} link={link} versionsById={versionsById} branchName={branchName} />
        </CollapsibleSection>
      )}
    </>
  )
}

const UI_STATE: Record<SyncRun['items'][string]['state'], RowState> = {
  pending: 'pending',
  created: 'done',
  skipped: 'skipped',
  error: 'error',
}

function RunLog({
  run,
  link,
  versionsById,
  branchName,
}: {
  run: SyncRun
  link: GithubLink
  versionsById: Map<string, Project['versions'][number]>
  branchName: (id: string) => string
}) {
  const done = run.order.filter((id) => run.items[id]?.state !== 'pending').length
  const total = run.order.length
  const currentId = run.status === 'running' ? run.order.find((id) => run.items[id]?.state === 'pending') : undefined
  const refProblems = run.refs.filter((r) => r.status === 'conflict' || r.status === 'error')

  return (
    <div>
      <ProgressBar
        done={done}
        total={total}
        label={run.status === 'running' ? 'Subiendo versiones' : run.status === 'done' ? 'Última subida' : 'Subida interrumpida'}
      />
      {run.error && <p className="mt-3 text-sm text-destructive">{run.error}</p>}
      {run.notes.map((n, i) => (
        <p key={i} className="mt-2 text-sm text-muted-foreground animate-in fade-in duration-200">
          {n}
        </p>
      ))}

      <ProgressList
        className="mt-4"
        rows={run.order.map((id) => {
          const v = versionsById.get(id)
          const item = run.items[id]
          const state: RowState = id === currentId ? 'current' : UI_STATE[item?.state ?? 'pending']
          return {
            id,
            state,
            label: v?.message ?? id,
            meta: v ? branchName(v.branchId) : '',
            trailing: item?.sha ? (
              <a
                href={githubUrls.commit(link.owner, link.repo, item.sha)}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-brand hover:underline"
              >
                {shortSha(item.sha)}
              </a>
            ) : state === 'skipped' ? (
              'ya existía'
            ) : (
              ''
            ),
          }
        })}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        <Check className="inline size-3 text-emerald-700 dark:text-emerald-400" /> commit creado · <Minus className="inline size-3" /> ya
        estaba subido, se reutiliza
      </p>

      {run.refs.length > 0 && (
        <div className="mt-6 text-sm">
          <h3 className="font-medium">Ramas</h3>
          <ul className="mt-2 space-y-1">
            {run.refs.map((r, i) => (
              <li
                key={r.branch}
                style={i < 8 ? { animationDelay: `${i * 30}ms` } : undefined}
                className="flex flex-wrap items-baseline gap-x-2 animate-in fade-in slide-in-from-top-1 fill-mode-backwards duration-200"
              >
                <span className="font-mono">{r.branch}</span>
                <span className={cn('text-muted-foreground', (r.status === 'conflict' || r.status === 'error') && 'text-destructive')}>
                  {REF_LABEL[r.status]}
                  {r.message && ` — ${r.message}`}
                </span>
                {r.sha && (r.status === 'created' || r.status === 'updated' || r.status === 'forced') && (
                  <a
                    href={githubUrls.branch(link.owner, link.repo, r.branch)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Abrir ${r.branch} en GitHub`}
                    className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-brand"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
          {refProblems.length > 0 && (
            <p className="mt-2 text-muted-foreground">
              Baja primero para incorporarlas, o activa “Forzar actualización de ramas” y vuelve a subir para reescribirlas.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const REF_LABEL: Record<RefResult['status'], string> = {
  created: 'creada',
  updated: 'actualizada',
  forced: 'reescrita (forzada)',
  unchanged: 'sin cambios',
  conflict: 'no actualizada: diverge del remoto',
  error: 'error',
  skipped: 'omitida',
}
