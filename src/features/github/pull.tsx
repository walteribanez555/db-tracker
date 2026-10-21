// "Bajar": lee un repositorio subido con DB Tracker y reemplaza el proyecto local.
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { exportProject } from '@/lib/exporters'
import { useProjectStore } from '@/store/project'

import { githubApi, GithubApiError } from './api'
import { fmtDate, plural } from './format'
import { opTracker, type OpTracker } from './op'
import { LinkRepoList } from './repo'
import { ProgressBar, ProgressList, type RowState } from './progress-list'
import type { PullResponse } from './types'
import { invalidateGithubReport } from './useGithubReport'

const parseTarget = (text: string): { owner: string; repo: string } | null => {
  const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(text.trim())
  return m ? { owner: m[1], repo: m[2] } : null
}

/** Descarga una copia del proyecto actual (ramas, versiones y borrador) con el formato de Importar / Exportar. */
function downloadProjectBackup() {
  const { project, draft } = useProjectStore.getState()
  const file = exportProject({ ...project, github: undefined }, draft)
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = file.filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const range = (from: string | null, to: string | null) =>
  !from ? 'sin fechas' : from === to ? fmtDate(from) : `del ${fmtDate(from)} al ${fmtDate(to)}`

export function PullPanel({ initial, onDone }: { initial?: { owner: string; repo: string }; onDone?: () => void }) {
  const [text, setText] = useState(initial ? `${initial.owner}/${initial.repo}` : '')
  const [pickList, setPickList] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PullResponse | null>(null)
  const [progress, setProgress] = useState<PullProgress | null>(null)
  const opRef = useRef<OpTracker | null>(null)

  // Si se abandona la vista previa sin cargar, la operación se cierra con el último paso omitido.
  const closePendingOp = () => {
    const op = opRef.current
    if (op?.isOpen()) {
      op.end('load', 'skipped', 'no se cargó')
      op.finish('done')
    }
    opRef.current = null
  }
  useEffect(() => closePendingOp, [])

  const read = async (target = parseTarget(text)) => {
    if (!target) {
      setError('Escribe el repositorio como propietario/nombre (por ejemplo, walter/tienda-db).')
      return
    }
    setText(`${target.owner}/${target.repo}`)
    setPickList(false)
    setBusy(true)
    setError(null)
    setPreview(null)
    setProgress({ phase: 'Conectando con GitHub…', order: [], items: {}, states: {} })
    const patch = (fn: (p: PullProgress) => PullProgress) => setProgress((p) => (p ? fn(p) : p))

    // Operación en el dock: leer ramas → una lectura por versión → reconstruir → cargar.
    closePendingOp()
    const op = opTracker(`Bajar ${target.owner}/${target.repo}`, [
      { id: 'branches', label: 'Leer ramas', kind: 'network' },
      { id: 'rebuild', label: 'Reconstruir proyecto', kind: 'check' },
      { id: 'load', label: 'Cargar en DB Tracker', detail: 'espera tu confirmación', kind: 'branch' },
    ])
    opRef.current = op
    op.run('branches')
    let versionsLeft = 0
    try {
      let failed: string | null = null
      await githubApi.pullStream(target.owner, target.repo, (ev) => {
        switch (ev.type) {
          case 'phase':
            patch((p) => ({ ...p, phase: ev.message }))
            op.run('branches', ev.message.replace(/^Leyendo la historia de /, '').replace(/…$/, ''))
            break
          case 'start': {
            op.end('branches', 'done', `${plural(ev.total, 'versión', 'versiones')} de DB Tracker`)
            let after = 'branches'
            for (const i of ev.items) {
              op.add({ id: `v:${i.versionId}`, label: i.message.length > 48 ? `${i.message.slice(0, 47)}…` : i.message, detail: i.flujo, kind: 'file' }, after)
              after = `v:${i.versionId}`
            }
            versionsLeft = ev.total
            if (!ev.total) op.run('rebuild')
            patch((p) => ({
              ...p,
              phase: `Leyendo ${plural(ev.total, 'versión', 'versiones')}…`,
              order: ev.items.map((i) => i.versionId),
              items: Object.fromEntries(ev.items.map((i) => [i.versionId, i])),
              states: Object.fromEntries(ev.items.map((i) => [i.versionId, 'pending' as RowState])),
            }))
            break
          }
          case 'version-start':
            patch((p) => ({ ...p, states: { ...p.states, [ev.versionId]: 'current' } }))
            op.run(`v:${ev.versionId}`)
            break
          case 'version-done': {
            patch((p) => ({ ...p, states: { ...p.states, [ev.versionId]: ev.ok ? 'done' : 'error' } }))
            // Un schema.json ilegible no detiene la bajada: la versión se carga vacía.
            op.end(`v:${ev.versionId}`, ev.ok ? 'done' : 'error', ev.ok ? 'schema.json' : 'schema.json no válido: se carga vacía')
            versionsLeft--
            if (versionsLeft === 0) op.run('rebuild')
            break
          }
          case 'done': {
            setPreview(ev.result)
            patch((p) => ({ ...p, phase: null }))
            const { summary } = ev.result
            op.end(
              'rebuild',
              'done',
              `${plural(summary.branches.length, 'rama', 'ramas')} · ${plural(summary.versions, 'versión', 'versiones')}`,
            )
            op.run('load', 'espera tu confirmación')
            break
          }
          case 'error':
            failed = ev.error.message
            break
        }
      })
      if (failed) throw new GithubApiError(0, 'github_error', failed)
    } catch (err) {
      const message = err instanceof GithubApiError ? err.message : 'No se pudo leer el repositorio.'
      setError(message)
      op.end(op.runningStep() ?? 'branches', 'error', message)
      op.finish('error', message)
      opRef.current = null
    } finally {
      setBusy(false)
    }
  }

  // Si se abre desde un repo ya vinculado, se lee directamente.
  useEffect(() => {
    if (initial) void read(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="max-w-3xl space-y-4 text-sm">
      {!initial && (
        <div className="space-y-2">
          <Label htmlFor="pull-target">Repositorio</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="pull-target"
              className="max-w-xs font-mono"
              placeholder="propietario/repositorio"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void read()}
            />
            <Button onClick={() => void read()} disabled={busy || !text.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Leer repositorio
            </Button>
            <Button variant="ghost" onClick={() => setPickList((v) => !v)}>
              {pickList ? 'Ocultar mis repositorios' : 'Elegir de mis repositorios'}
            </Button>
          </div>
          {pickList && (
            <LinkRepoList actionLabel="Elegir" requirePush={false} onLink={(l) => void read({ owner: l.owner, repo: l.repo })} />
          )}
        </div>
      )}

      {progress && (busy || error) && <PullProgressView progress={progress} />}
      {error && <p className="text-destructive animate-in fade-in duration-200">{error}</p>}
      {preview && (
        <PullPreview
          preview={preview}
          onLoaded={(detail) => {
            const op = opRef.current
            op?.end('load', 'done', detail)
            op?.finish('done')
            opRef.current = null
            onDone?.()
          }}
        />
      )}
    </div>
  )
}

interface PullProgress {
  phase: string | null
  order: string[]
  items: Record<string, { versionId: string; message: string; flujo: string }>
  states: Record<string, RowState>
}

function PullProgressView({ progress }: { progress: PullProgress }) {
  const done = progress.order.filter((id) => progress.states[id] === 'done' || progress.states[id] === 'error').length
  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      {progress.phase && (
        <p key={progress.phase} className="flex items-center gap-2 text-muted-foreground animate-in fade-in duration-200">
          <Loader2 className="size-3.5 animate-spin text-brand" /> {progress.phase}
        </p>
      )}
      {progress.order.length > 0 && (
        <>
          <ProgressBar done={done} total={progress.order.length} label="Bajando versiones" />
          <ProgressList
            rows={progress.order.map((id) => ({
              id,
              state: progress.states[id] ?? 'pending',
              label: progress.items[id]?.message ?? id,
              meta: progress.items[id]?.flujo,
            }))}
          />
        </>
      )}
    </div>
  )
}

function PullPreview({ preview, onLoaded }: { preview: PullResponse; onLoaded: (detail: string) => void }) {
  const local = useProjectStore((s) => s.project)
  const isDirty = useProjectStore((s) => s.isDirty)
  const loadProject = useProjectStore((s) => s.loadProject)
  const setGithub = useProjectStore((s) => s.setGithub)
  const [exported, setExported] = useState(false)

  const { summary, project } = preview
  const link = project.github!
  const dirty = isDirty()
  const localOnly = useMemo(() => {
    const remoteIds = new Set(project.versions.map((v) => v.id))
    return local.versions.filter((v) => !remoteIds.has(v.id)).length
  }, [local.versions, project.versions])
  const risky = dirty || localOnly > 0

  const load = () => {
    loadProject(project)
    // setGithub lo deja en sessionStorage: el vínculo sobrevive a una recarga, no a cerrar la pestaña.
    setGithub(link)
    invalidateGithubReport(link.owner, link.repo)
    toast.success(`Proyecto bajado de ${link.owner}/${link.repo}`, {
      description: `${plural(summary.versions, 'versión', 'versiones')} en ${plural(summary.branches.length, 'rama', 'ramas')}.`,
    })
    onLoaded(`proyecto «${project.name}» · ${link.owner}/${link.repo}`)
  }

  return (
    <div className="space-y-4 border-t pt-4 animate-in fade-in slide-in-from-top-1 duration-300 ease-out">
      <div>
        <p className="font-medium">
          {link.owner}/{link.repo}: proyecto «{project.name}»
        </p>
        <p className="text-muted-foreground">
          {plural(summary.branches.length, 'rama', 'ramas')} · {plural(summary.versions, 'versión', 'versiones')} ·{' '}
          {range(summary.firstAt, summary.lastAt)}
        </p>
      </div>
      <ul className="space-y-1">
        {summary.branches.map((b) => (
          <li key={b.name}>
            <span className="font-mono">{b.name}</span>
            <span className="text-muted-foreground">
              {' — '}
              {b.empty ? 'sin versiones propias (rama bifurcada)' : `${plural(b.versions, 'versión', 'versiones')}, ${range(b.firstAt, b.lastAt)}`}
              {b.foreignCommits > 0 && ` · ${plural(b.foreignCommits, 'commit ajeno, se ignora', 'commits ajenos, se ignoran')}`}
            </span>
          </li>
        ))}
      </ul>
      {preview.warnings.length > 0 && (
        <div className="space-y-0.5 text-amber-700 dark:text-amber-400">
          {preview.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {risky ? (
        <div className="space-y-3">
          <p>
            Bajar reemplaza el proyecto local «{local.name}». Se perderán
            {dirty && ' los cambios sin confirmar del borrador'}
            {dirty && localOnly > 0 && ' y'}
            {localOnly > 0 && ` ${plural(localOnly, 'versión que no está', 'versiones que no están')} en el repositorio`}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                downloadProjectBackup()
                setExported(true)
              }}
            >
              Exportar JSON del proyecto actual
            </Button>
            <Button variant={exported ? 'default' : 'destructive'} onClick={load}>
              Reemplazar y cargar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={load}>Cargar en DB Tracker</Button>
          <span className="text-muted-foreground">Reemplaza el proyecto local «{local.name}».</span>
        </div>
      )}
    </div>
  )
}
