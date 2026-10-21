import { ExternalLink, Loader2, Lock, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProjectStore } from '@/store/project'
import type { GithubLink } from '@/types/schema'

import { githubApi, GithubApiError, githubUrls } from './api'
import { fmtAgo } from './format'
import { PullPanel } from './pull'
import type { CreateRepoInput, GithubRepoSummary } from './types'

const linkFromRepo = (r: GithubRepoSummary): GithubLink => ({
  owner: r.owner,
  repo: r.name,
  url: r.htmlUrl,
  defaultBranch: r.defaultBranch,
})

const suggestName = (name: string) =>
  `${name}-db`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

interface Props {
  login: string
  /** Crea el repo y sube sus versiones (operación en el dock). Rechaza si no se pudo crear. */
  onCreate: (input: CreateRepoInput) => Promise<void>
}

/** Elegir repositorio cuando el proyecto no tiene uno vinculado (el vínculo activo se muestra en el panel lateral). */
export function RepoSection({ login, onCreate }: Props) {
  const github = useProjectStore((s) => s.project.github)
  const setGithub = useProjectStore((s) => s.setGithub)
  if (github) return null

  return (
    <CollapsibleSection title="Repositorio" meta="sin vincular" storageKey="github:repo" className="border-b py-4" contentClassName="pt-3">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Crea un repositorio nuevo, vincula uno que ya tengas para subir el proyecto, o baja un proyecto que ya esté en GitHub. El vínculo
        dura solo esta sesión: al cerrar la pestaña o la app se olvida.
      </p>
      <Tabs defaultValue="create" className="mt-4">
        <TabsList className="max-md:w-full max-md:group-data-horizontal/tabs:h-11">
          <TabsTrigger value="create">Crear repositorio</TabsTrigger>
          <TabsTrigger value="link">Vincular existente</TabsTrigger>
          <TabsTrigger value="pull">Bajar de un repositorio</TabsTrigger>
        </TabsList>
        <TabsContent value="create" className={TAB}>
          <CreateRepoForm login={login} onCreate={onCreate} onLinkExisting={(link) => setGithub(link)} />
        </TabsContent>
        <TabsContent value="link" className={TAB}>
          <LinkRepoList onLink={(link) => setGithub(link)} />
        </TabsContent>
        <TabsContent value="pull" className={TAB}>
          <PullPanel />
        </TabsContent>
      </Tabs>
    </CollapsibleSection>
  )
}

const TAB = 'pt-4 animate-in fade-in duration-200'

/** Bloque del panel lateral con el repositorio vinculado. */
export function LinkedRepoInfo() {
  const github = useProjectStore((s) => s.project.github)
  const setGithub = useProjectStore((s) => s.setGithub)
  if (!github) return <p className="text-sm text-muted-foreground">Ningún repositorio vinculado.</p>
  return (
    <div className="space-y-2 text-sm">
      <a href={github.url} target="_blank" rel="noreferrer" className="block truncate font-mono transition-colors hover:text-brand hover:underline">
        {github.owner}/{github.repo}
      </a>
      <p className="text-muted-foreground">
        Rama por defecto <span className="font-mono text-foreground">{github.defaultBranch}</span>
        {github.lastSyncAt && (
          <>
            <br />
            Última subida o bajada {fmtAgo(github.lastSyncAt)}
          </>
        )}
      </p>
      <div className="flex flex-col items-start">
        <Button asChild variant="link" size="sm" className="h-7 px-0">
          <a href={github.url} target="_blank" rel="noreferrer">
            Abrir en GitHub <ExternalLink />
          </a>
        </Button>
        <Button asChild variant="link" size="sm" className="h-7 px-0">
          <a href={githubUrls.network(github.owner, github.repo)} target="_blank" rel="noreferrer">
            Grafo de red <ExternalLink />
          </a>
        </Button>
        <Button variant="link" size="sm" className="h-7 px-0 text-muted-foreground" onClick={() => setGithub(undefined)}>
          Cambiar repositorio
        </Button>
      </div>
    </div>
  )
}

function CreateRepoForm({
  login,
  onCreate,
  onLinkExisting,
}: {
  login: string
  onCreate: (input: CreateRepoInput) => Promise<void>
  onLinkExisting: (link: GithubLink) => void
}) {
  const projectName = useProjectStore((s) => s.project.name)
  const hasVersions = useProjectStore((s) => s.project.versions.length > 0)
  const [name, setName] = useState(() => suggestName(projectName))
  const [description, setDescription] = useState(() => `Base de datos de ${projectName}, versionada por flujos con DB Tracker`)
  const [isPrivate, setPrivate] = useState(true)
  const [autoInit, setAutoInit] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<GithubApiError | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onCreate({ name: name.trim(), description: description.trim() || undefined, private: isPrivate, autoInit })
    } catch (err) {
      setError(err instanceof GithubApiError ? err : new GithubApiError(0, 'github_error', 'No se pudo crear el repositorio.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="repo-name">Nombre</Label>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm text-muted-foreground">{login}/</span>
            <Input id="repo-name" value={name} onChange={(e) => setName(e.target.value)} className="max-md:h-11 font-mono" aria-invalid={error?.code === 'repo_exists'} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="repo-desc">Descripción</Label>
          <Input className="max-md:h-11" id="repo-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={isPrivate} onCheckedChange={setPrivate} />
          Privado
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={autoInit} onCheckedChange={setAutoInit} />
          Inicializar con README
        </label>
      </div>
      {error && (
        <div className="text-sm text-destructive">
          {error.message}
          {error.code === 'repo_exists' && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="max-md:h-11 h-auto px-1"
              onClick={() =>
                onLinkExisting({ owner: login, repo: name.trim(), url: githubUrls.repo(login, name.trim()), defaultBranch: 'main' })
              }
            >
              Vincular {login}/{name.trim()}
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button className="max-md:h-11" type="submit" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="animate-spin" />}
          Crear repositorio con la base de datos de ejemplo
        </Button>
        <span className="text-xs text-muted-foreground">
          {hasVersions ? 'Al crearlo se suben todas las versiones.' : 'El repositorio se creará sin versiones.'}
        </span>
      </div>
    </form>
  )
}

export function LinkRepoList({
  onLink,
  actionLabel = 'Vincular',
  requirePush = true,
}: {
  onLink: (link: GithubLink) => void
  actionLabel?: string
  /** Si es true, los repos sin permiso de escritura no se pueden elegir. */
  requirePush?: boolean
}) {
  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    githubApi
      .listRepos()
      .then((r) => !cancelled && setRepos(r))
      .catch((err) => !cancelled && setError(err instanceof GithubApiError ? err.message : 'No se pudieron cargar los repositorios.'))
    return () => {
      cancelled = true
    }
  }, [nonce])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (repos ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
  }, [repos, query])

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center gap-2">
        <Input placeholder="Buscar repositorio…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-md:h-11 max-w-sm" />
        <Button className="max-md:size-11" variant="ghost" size="icon-sm" aria-label="Recargar" onClick={() => {
            setError(null)
            setRepos(null)
            setNonce((n) => n + 1)
          }}>
          <RefreshCw />
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!repos && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Cargando repositorios…
        </p>
      )}
      {repos && (
        <ul className="max-h-96 divide-y overflow-y-auto border-y">
          {filtered.length === 0 && <li className="py-3 text-sm text-muted-foreground">Sin resultados.</li>}
          {filtered.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-mono text-sm">
                  {r.private && <Lock className="size-3 text-muted-foreground" aria-label="Privado" />}
                  <span className="truncate">{r.fullName}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {[r.description, r.updatedAt && `actualizado ${fmtAgo(r.updatedAt)}`, r.empty && 'vacío'].filter(Boolean).join(' · ')}
                </div>
              </div>
              {r.canPush || !requirePush ? (
                <Button className="max-md:h-11" variant="outline" size="sm" onClick={() => onLink(linkFromRepo(r))}>
                  {actionLabel}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">solo lectura</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
