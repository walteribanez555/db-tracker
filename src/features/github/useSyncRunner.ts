// Ejecuta una subida (push) en streaming y mantiene el progreso por versión.
// El mismo flujo de eventos alimenta la lista de la vista y el dock de operaciones (useOperationStore).
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useProjectStore } from '@/store/project'
import type { GithubLink, Project } from '@/types/schema'

import { githubApi, GithubApiError } from './api'
import { buildSyncInput, syncOrder } from './files'
import { plural, shortSha } from './format'
import type { CreateRepoInput, GithubRepoSummary, RefResult, RemoteBranch } from './types'
import { opTracker } from './op'
import { invalidateGithubReport } from './useGithubReport'

// ---------- Estado de una subida (vista) ----------

type ItemState = 'pending' | 'created' | 'skipped' | 'error'

export interface SyncRun {
  status: 'running' | 'done' | 'error'
  order: string[]
  items: Record<string, { state: ItemState; sha?: string; message?: string }>
  refs: RefResult[]
  notes: string[]
  error: string | null
}

export interface StartOptions {
  /** Repo destino (si no se crea uno nuevo). */
  link?: GithubLink
  /** Crear el repo antes de subir (pasos "Crear repositorio" y "Commit inicial"). */
  create?: CreateRepoInput & { login: string }
  force: boolean
  /** Subir aunque haya ramas remotas con commits que no están en local. */
  ignoreAhead?: boolean
  /** Se llama si la comprobación encuentra ramas remotas por delante (la subida no empieza). */
  onAhead?: (branches: string[]) => void
  /** Se llama en cuanto el repo creado existe, para vincularlo. */
  onLinked?: (link: GithubLink, repo: GithubRepoSummary) => void
}

/** Ramas cuya cabeza en GitHub no es ninguna versión local: alguien subió desde otra sesión. */
export function remoteAheadBranches(project: Project, remote: RemoteBranch[]): string[] {
  const localShas = new Set(project.versions.map((v) => v.githubSha).filter(Boolean))
  const names = new Set(project.branches.map((b) => b.name))
  return remote.filter((r) => names.has(r.name) && !localShas.has(r.sha)).map((r) => r.name)
}

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function useSyncRunner(onFinished?: () => void) {
  const [run, setRun] = useState<SyncRun | null>(null)
  const abort = useRef<AbortController | null>(null)
  const finished = useRef(onFinished)
  useEffect(() => {
    finished.current = onFinished
  }, [onFinished])

  useEffect(() => () => abort.current?.abort(), [])

  const start = useCallback(async (opts: StartOptions) => {
    const { project, setVersionGithubSha, setGithub } = useProjectStore.getState()
    const order = syncOrder(project.versions)
    const branchesWithHead = project.branches.filter((b) => b.headVersionId ?? b.forkedFromVersionId)
    const target = opts.link ?? (opts.create ? { owner: opts.create.login, repo: opts.create.name } : null)
    if (!target) return

    // Pasos reales, en el orden en que ocurren.
    const op = opTracker(opts.create ? `Crear repositorio ${target.owner}/${target.repo}` : `Subir a ${target.owner}/${target.repo}`, [
      ...(opts.create
        ? [
            { id: 'create', label: 'Crear repositorio', detail: `${opts.create.private ? 'privado' : 'público'}`, kind: 'network' as const },
            { id: 'init', label: 'Commit inicial', detail: opts.create.autoInit ? 'README.md' : 'al subir', kind: 'commit' as const },
          ]
        : []),
      ...(order.length
        ? [
            { id: 'check', label: 'Comprobar ramas remotas', kind: 'network' as const },
            { id: 'meta', label: 'Metadatos y archivos', detail: '.dbtracker/project.json', kind: 'file' as const },
            ...order.map((v) => ({
              id: `v:${v.id}`,
              label: short(v.message || 'Versión'),
              detail: project.branches.find((b) => b.id === v.branchId)?.name,
              kind: 'commit' as const,
            })),
            ...branchesWithHead.map((b) => ({ id: `r:${b.name}`, label: `Rama ${b.name}`, kind: 'branch' as const })),
          ]
        : []),
    ])

    let link: GithubLink | undefined = opts.link

    // 1) Crear el repositorio (opcional).
    if (opts.create) {
      op.run('create')
      try {
        const repo = await githubApi.createRepo(opts.create)
        link = { owner: repo.owner, repo: repo.name, url: repo.htmlUrl, defaultBranch: repo.defaultBranch }
        op.end('create', 'done', repo.fullName)
        opts.onLinked?.(link, repo)
        if (opts.create.autoInit) {
          op.run('init')
          op.end('init', 'done', 'README.md creado por GitHub')
        }
      } catch (err) {
        const message = err instanceof GithubApiError ? err.message : 'No se pudo crear el repositorio.'
        op.end('create', 'error', message)
        op.finish('error', message)
        throw err
      }
      if (!order.length) {
        if (!opts.create.autoInit) op.end('init', 'skipped', 'sin versiones que subir')
        op.finish('done')
        return
      }
    }
    if (!link) return

    // 2) Comprobar ramas remotas.
    op.run('check')
    try {
      const remote = await githubApi.branches(link.owner, link.repo)
      const ahead = remoteAheadBranches(useProjectStore.getState().project, remote)
      if (ahead.length && !opts.ignoreAhead) {
        const message = `Hay commits en GitHub que no tienes: ${ahead.join(', ')}. Baja primero o sube de todos modos.`
        op.end('check', 'error', `por delante: ${ahead.join(', ')}`)
        op.finish('error', message)
        opts.onAhead?.(ahead)
        return
      }
      op.end(
        'check',
        'done',
        ahead.length ? `por delante: ${ahead.join(', ')} (se sube igualmente)` : plural(remote.length, 'rama remota', 'ramas remotas'),
      )
    } catch (err) {
      // No es bloqueante: el servidor rechaza igualmente lo que no sea fast-forward.
      op.end('check', 'skipped', err instanceof GithubApiError ? err.message : 'no se pudo comprobar')
    }

    // 3) Generar archivos de cada versión (incluye .dbtracker/project.json).
    op.run('meta')
    const input = buildSyncInput(useProjectStore.getState().project, link.owner, link.repo, opts.force)
    const fileCount = new Map(input.versions.map((v) => [v.id, v.files.length]))
    op.end('meta', 'done', `.dbtracker/project.json · ${plural(input.versions.reduce((a, v) => a + v.files.length, 0), 'archivo', 'archivos')}`)

    // 4) Subida en streaming.
    const items: SyncRun['items'] = Object.fromEntries(order.map((v) => [v.id, { state: 'pending' as ItemState }]))
    setRun({ status: 'running', order: order.map((v) => v.id), items, refs: [], notes: [], error: null })
    const patch = (fn: (r: SyncRun) => SyncRun) => setRun((r) => (r ? fn(r) : r))
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl

    let serverOrder: string[] = order.map((v) => v.id)
    let next = 0
    const runNextVersion = () => {
      const id = serverOrder[next]
      if (id) op.run(`v:${id}`)
      else branchesWithHead.forEach((b, i) => i === 0 && op.run(`r:${b.name}`))
    }
    const branchOf = (versionId: string) => {
      const v = project.versions.find((x) => x.id === versionId)
      return project.branches.find((b) => b.id === v?.branchId)?.name ?? ''
    }
    const refsSeen: RefResult[] = []

    let ok = false
    let failure: string | null = null
    // La petición ya está en vuelo para la primera versión (los errores de acceso al repo caen en ella).
    runNextVersion()
    try {
      await githubApi.sync(
        input,
        (ev) => {
          switch (ev.type) {
            case 'start':
              // El servidor confirma el orden (padres primero); la primera versión ya está en curso.
              serverOrder = ev.order
              break
            case 'bootstrap':
              patch((r) => ({ ...r, notes: [...r.notes, ev.message] }))
              if (opts.create && !opts.create.autoInit) op.end('init', 'done', 'README.md (repositorio vacío)')
              else {
                op.add({ id: 'init', label: 'Commit inicial', detail: 'README.md (repositorio vacío)', kind: 'commit' }, 'check')
                op.end('init', 'done', 'README.md (repositorio vacío)')
              }
              break
            case 'version': {
              // Se guarda el SHA en cuanto existe: si algo falla después, no se repite.
              setVersionGithubSha(ev.versionId, ev.sha)
              patch((r) => ({ ...r, items: { ...r.items, [ev.versionId]: { state: ev.status, sha: ev.sha } } }))
              const files = fileCount.get(ev.versionId) ?? 0
              op.end(
                `v:${ev.versionId}`,
                ev.status === 'created' ? 'done' : 'skipped',
                ev.status === 'created'
                  ? `${shortSha(ev.sha)} · ${plural(files, 'archivo', 'archivos')} · ${branchOf(ev.versionId)}`
                  : `ya existía · ${shortSha(ev.sha)}`,
              )
              next++
              runNextVersion()
              break
            }
            case 'version-error':
              patch((r) => ({ ...r, items: { ...r.items, [ev.versionId]: { state: 'error', message: ev.message } } }))
              op.end(`v:${ev.versionId}`, 'error', ev.message)
              failure = ev.message
              break
            case 'ref': {
              refsSeen.push(ev.ref)
              patch((r) => ({ ...r, refs: [...r.refs, ev.ref] }))
              const id = `r:${ev.ref.branch}`
              const r = ev.ref
              if (r.status === 'conflict') op.end(id, 'error', 'sin fast-forward: GitHub tiene commits que no tienes')
              else if (r.status === 'error') op.end(id, 'error', r.message ?? 'error')
              else if (r.status === 'skipped') op.end(id, 'skipped', r.message)
              else op.end(id, 'done', `${REF_VERB[r.status]}${r.sha ? ` · ${shortSha(r.sha)}` : ''}`)
              const idx = branchesWithHead.findIndex((b) => b.name === ev.ref.branch)
              const following = branchesWithHead[idx + 1]
              if (following) op.run(`r:${following.name}`)
              break
            }
            case 'default-branch':
              patch((r) => ({ ...r, notes: [...r.notes, `"${ev.branch}" es ahora la rama por defecto del repositorio.`] }))
              break
            case 'done': {
              ok = true
              const current = useProjectStore.getState().project.github
              setGithub({ ...(current ?? link!), lastSyncAt: new Date().toISOString() })
              patch((r) => ({ ...r, status: 'done', notes: [...r.notes, ...ev.result.warnings] }))
              const { created, skipped } = ev.result
              const conflicts = ev.result.refs.filter((x) => x.status === 'conflict' || x.status === 'error')
              if (conflicts.length) {
                op.finish('error', `${plural(conflicts.length, 'rama no se actualizó', 'ramas no se actualizaron')}: ${conflicts.map((c) => c.branch).join(', ')}. Baja primero o fuerza la subida.`)
              } else op.finish('done')
              const summary = `${plural(created, 'commit creado', 'commits creados')}, ${plural(skipped, 'ya existía', 'ya existían')}.`
              if (conflicts.length) {
                toast.warning('Subida con ramas sin actualizar', {
                  description: `${summary} Sin fast-forward: ${conflicts.map((c) => c.branch).join(', ')}.`,
                })
              } else toast.success('Subida completada', { description: summary })
              break
            }
            case 'error': {
              failure = ev.error.message
              patch((r) => ({ ...r, status: 'error', error: ev.error.message }))
              // Marca en rojo el paso que estaba en curso (versión o rama).
              const running = op.runningStep()
              if (running) op.end(running, 'error', ev.error.message)
              op.finish('error', ev.error.message)
              toast.error('La subida se detuvo', { description: ev.error.message })
              break
            }
          }
        },
        ctrl.signal,
      )
      if (!ok && !failure) {
        const message = 'La conexión se cerró antes de terminar.'
        patch((r) => (r.status === 'running' ? { ...r, status: 'error', error: message } : r))
        op.finish('error', message)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        op.finish('error', 'Cancelada')
        return
      }
      const message = err instanceof GithubApiError ? err.message : 'Error inesperado al subir.'
      patch((r) => ({ ...r, status: 'error', error: message }))
      const running = op.runningStep()
      if (running) op.end(running, 'error', message)
      op.finish('error', message)
      toast.error('No se pudo subir', { description: message })
    } finally {
      invalidateGithubReport(link.owner, link.repo)
      finished.current?.()
    }
  }, [])

  return { run, start, running: run?.status === 'running' }
}

const REF_VERB: Record<RefResult['status'], string> = {
  created: 'creada',
  updated: 'actualizada',
  forced: 'reescrita (forzada)',
  unchanged: 'sin cambios',
  conflict: 'sin fast-forward',
  error: 'error',
  skipped: 'omitida',
}
