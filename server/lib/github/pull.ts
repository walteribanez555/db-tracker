// "Bajar": reconstruye un Project de DB Tracker a partir de la historia del repositorio.
// Solo se consideran los commits con las líneas DB-Tracker-Version / DB-Tracker-Flujo.
import { randomBytes } from 'node:crypto'

import type { Octokit } from '@octokit/rest'

import type { Branch, Dialect, Project, Schema, Version } from '../../../src/types/schema.ts'
import type { ProjectMetaFile, PullBranchSummary, PullEvent, PullResponse } from '../../../src/features/github/types.ts'
import { GhError, errStatus, toGhError } from './errors.ts'

const META_PATH = '.dbtracker/project.json'
const MAX_COMMITS_PER_BRANCH = 1000
const BRANCH_COLORS = ['#18181b', '#2563eb', '#ea580c', '#7c3aed', '#059669', '#db2777', '#0891b2']
const DIALECTS: Dialect[] = ['postgresql', 'mysql', 'sqlite', 'sqlserver']

interface RawCommit {
  sha: string
  message: string
  authorName: string
  date: string
  parents: string[]
}

interface Tracked extends RawCommit {
  versionId: string
  flujo: string
  cleanMessage: string
}

const rid = (prefix: string) => `${prefix}${randomBytes(6).toString('base64url')}`

export function parseTrailers(message: string): { versionId: string; flujo: string; clean: string } | null {
  const v = /^DB-Tracker-Version:\s*(\S+)\s*$/m.exec(message)
  if (!v) return null
  const f = /^DB-Tracker-Flujo:\s*(.+?)\s*$/m.exec(message)
  const clean = message
    .replace(/^DB-Tracker-(Version|Flujo):.*$/gm, '')
    .trim()
  return { versionId: v[1], flujo: f?.[1] ?? 'main', clean: clean || 'Versión sin mensaje' }
}

function normalizeSchema(raw: unknown, fallbackDialect: Dialect): Schema {
  // schema.json puede ser el esquema suelto o el documento { format: 'db-tracker/schema', schema }.
  const doc = raw as { format?: string; schema?: unknown } | null
  const body = doc && typeof doc === 'object' && doc.format === 'db-tracker/schema' && doc.schema ? doc.schema : raw
  const s = (body && typeof body === 'object' ? body : {}) as Partial<Schema>
  const arr = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x : [])
  return {
    dialect: DIALECTS.includes(s.dialect as Dialect) ? (s.dialect as Dialect) : fallbackDialect,
    tables: arr(s.tables),
    views: arr(s.views),
    relations: arr(s.relations),
    enums: arr(s.enums),
    functions: arr(s.functions),
    triggers: arr(s.triggers),
    notes: arr(s.notes),
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

async function readFile(octokit: Octokit, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref })
    if (Array.isArray(data) || data.type !== 'file') return null
    if ('content' in data && data.content && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf8')
    }
    // Archivos > 1 MB: la API de contenidos no los incluye; se leen como blob.
    const blob = await octokit.git.getBlob({ owner, repo, file_sha: data.sha })
    return Buffer.from(blob.data.content, 'base64').toString('utf8')
  } catch (err) {
    if (errStatus(err) === 404) return null
    throw err
  }
}

const parseJson = <T,>(text: string | null): T | null => {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export async function pullProject(
  octokit: Octokit,
  owner: string,
  repo: string,
  onEvent: (ev: PullEvent) => void | Promise<void> = () => {},
): Promise<PullResponse> {
  try {
    const warnings: string[] = []
    const { data: info } = await octokit.repos.get({ owner, repo })
    const defaultBranch = info.default_branch
    const remoteBranches = await octokit.paginate(octokit.repos.listBranches, { owner, repo, per_page: 100 })
    if (!remoteBranches.length) throw new GhError(409, 'repo_empty', 'El repositorio está vacío: no hay nada que bajar.')

    await onEvent({ type: 'phase', message: `Leyendo la historia de ${remoteBranches.length} rama(s)…` })
    // 1) Historia de cada rama (los commits compartidos se deduplican).
    const commits = new Map<string, RawCommit>()
    const branchCommits = new Map<string, string[]>()
    await mapLimit(remoteBranches, 4, async (b) => {
      let count = 0
      const list = await octokit.paginate(
        octokit.repos.listCommits,
        { owner, repo, sha: b.commit.sha, per_page: 100 },
        (res, done) => {
          count += res.data.length
          if (count >= MAX_COMMITS_PER_BRANCH) done()
          return res.data
        },
      )
      if (count >= MAX_COMMITS_PER_BRANCH) warnings.push(`La rama "${b.name}" tiene más de ${MAX_COMMITS_PER_BRANCH} commits: se leyeron solo los más recientes.`)
      branchCommits.set(
        b.name,
        list.map((c) => c.sha),
      )
      for (const c of list) {
        if (commits.has(c.sha)) continue
        commits.set(c.sha, {
          sha: c.sha,
          message: c.commit.message,
          authorName: c.commit.author?.name ?? c.author?.login ?? 'desconocido',
          date: c.commit.author?.date ?? c.commit.committer?.date ?? new Date().toISOString(),
          parents: c.parents.map((p) => p.sha),
        })
      }
    })

    // 2) Commits de DB Tracker.
    const tracked = new Map<string, Tracked>()
    const byVersionId = new Map<string, Tracked>()
    for (const c of commits.values()) {
      const t = parseTrailers(c.message)
      if (!t) continue
      const entry: Tracked = { ...c, versionId: t.versionId, flujo: t.flujo, cleanMessage: t.clean }
      const dup = byVersionId.get(t.versionId)
      if (dup) {
        // La misma versión publicada dos veces (p. ej. tras forzar): se queda la más reciente.
        warnings.push(`La versión ${t.versionId} aparece en dos commits; se usa el más reciente.`)
        if (Date.parse(dup.date) >= Date.parse(c.date)) continue
        tracked.delete(dup.sha)
      }
      tracked.set(c.sha, entry)
      byVersionId.set(t.versionId, entry)
    }
    if (!tracked.size) {
      throw new GhError(
        422,
        'validation',
        'El repositorio no contiene versiones de DB Tracker (commits con la línea "DB-Tracker-Version"). Súbelo primero desde DB Tracker.',
      )
    }

    // 3) Metadatos: el project.json más reciente entre las cabezas de las ramas.
    const metas = await mapLimit(remoteBranches, 4, (b) =>
      readFile(octokit, owner, repo, META_PATH, b.commit.sha).then((t) => parseJson<ProjectMetaFile>(t)),
    )
    const validMetas = metas.filter((m): m is ProjectMetaFile => m?.format === 'db-tracker/github-meta')
    validMetas.sort((a, b) => Date.parse(b.exportedAt) - Date.parse(a.exportedAt))
    const meta = validMetas[0] ?? null
    const branchMeta = new Map<string, ProjectMetaFile['branches'][number]>()
    for (const m of [...validMetas].reverse()) for (const b of m.branches) branchMeta.set(b.name, b)
    const dialect: Dialect = meta && DIALECTS.includes(meta.project.dialect) ? meta.project.dialect : 'postgresql'

    // 4) schema.json de cada versión (en orden cronológico, con progreso por versión).
    const trackedList = [...tracked.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    await onEvent({
      type: 'start',
      total: trackedList.length,
      items: trackedList.map((t) => ({ versionId: t.versionId, message: t.cleanMessage, flujo: t.flujo })),
    })
    const schemas = await mapLimit(trackedList, 4, async (t) => {
      await onEvent({ type: 'version-start', versionId: t.versionId })
      const raw = parseJson<unknown>(await readFile(octokit, owner, repo, 'schema.json', t.sha))
      if (!raw) warnings.push(`El commit ${t.sha.slice(0, 7)} no tiene un schema.json válido: se carga vacío.`)
      await onEvent({ type: 'version-done', versionId: t.versionId, ok: !!raw })
      return normalizeSchema(raw, dialect)
    })

    // 5) Ramas: una por flujo (trailers) y por cada rama remota que apunte a commits de DB Tracker.
    const branchNames = new Set<string>([...trackedList.map((t) => t.flujo)])
    for (const b of remoteBranches) {
      if ((branchCommits.get(b.name) ?? []).some((sha) => tracked.has(sha))) branchNames.add(b.name)
    }
    const ordered = [...branchNames].sort((a, b) =>
      a === defaultBranch ? -1 : b === defaultBranch ? 1 : (branchMeta.get(a)?.createdAt ?? a).localeCompare(branchMeta.get(b)?.createdAt ?? b),
    )
    const branchIdByName = new Map(ordered.map((name) => [name, branchMeta.get(name)?.id ?? rid('br_')]))

    // 6) Versiones.
    // El padre es el ancestro de DB Tracker más cercano (salta commits ajenos, p. ej. el README inicial).
    const trackedAncestor = (sha: string | undefined): Tracked | undefined => {
      for (let i = 0; sha && i < 10_000; i++) {
        const t = tracked.get(sha)
        if (t) return t
        sha = commits.get(sha)?.parents[0]
      }
      return undefined
    }
    const versions: Version[] = trackedList.map((t, i) => {
      const parent = trackedAncestor(t.parents[0])
      return {
        id: t.versionId,
        branchId: branchIdByName.get(t.flujo)!,
        parentId: parent?.versionId ?? null,
        message: t.cleanMessage,
        author: t.authorName,
        createdAt: t.date,
        schema: schemas[i],
        githubSha: t.sha,
      }
    })
    versions.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const versionBySha = new Map(versions.map((v) => [v.githubSha!, v]))

    const summaries: PullBranchSummary[] = []
    const branches: Branch[] = ordered.map((name, idx) => {
      const id = branchIdByName.get(name)!
      const own = versions.filter((v) => v.branchId === id)
      const ownIds = new Set(own.map((v) => v.id))
      const history = branchCommits.get(name)
      // Cabeza: el commit de DB Tracker más reciente del flujo en la rama remota (o el último del flujo).
      let head: Version | undefined
      let foreign = 0
      let forkFromRef: Version | undefined
      if (history) {
        for (const sha of history) {
          const v = versionBySha.get(sha)
          if (!v) {
            foreign++
            continue
          }
          if (ownIds.has(v.id)) {
            head = v
            break
          }
          // La rama apunta a una versión de otro flujo: rama vacía bifurcada desde ahí.
          if (!own.length) forkFromRef = v
          break
        }
      }
      head ??= own[own.length - 1]
      const first = own.find((v) => !v.parentId || !ownIds.has(v.parentId))
      const forkedFromVersionId = first ? first.parentId : (forkFromRef?.id ?? branchMeta.get(name)?.forkedFromVersionId ?? null)
      if (foreign) warnings.push(`La rama "${name}" tiene ${foreign} commit(s) que no son de DB Tracker; se ignoran.`)
      const m = branchMeta.get(name)
      summaries.push({
        name,
        versions: own.length,
        firstAt: own[0]?.createdAt ?? null,
        lastAt: own[own.length - 1]?.createdAt ?? null,
        foreignCommits: foreign,
        empty: !own.length,
      })
      return {
        id,
        name,
        color: m?.color ?? BRANCH_COLORS[idx % BRANCH_COLORS.length],
        description: m?.description ?? (name === defaultBranch ? 'Rama principal' : ''),
        forkedFromVersionId,
        headVersionId: head?.id ?? null,
        createdAt: m?.createdAt ?? own[0]?.createdAt ?? new Date().toISOString(),
      }
    })

    const currentName = meta?.project.currentBranch && branchIdByName.has(meta.project.currentBranch) ? meta.project.currentBranch : null
    const currentBranchId = branchIdByName.get(currentName ?? defaultBranch) ?? branches[0].id
    const project: Project = {
      id: meta?.project.id ?? rid('prj_'),
      name: meta?.project.name ?? repo.replace(/-db$/, ''),
      dialect,
      branches,
      versions,
      currentBranchId,
      github: { owner, repo, url: info.html_url, defaultBranch, lastSyncAt: new Date().toISOString() },
      connections: [],
    }
    if (!meta) warnings.push('El repositorio no tiene .dbtracker/project.json: se usan colores y descripciones por defecto.')

    return {
      project,
      summary: {
        defaultBranch,
        versions: versions.length,
        firstAt: versions[0]?.createdAt ?? null,
        lastAt: versions[versions.length - 1]?.createdAt ?? null,
        branches: summaries,
        hasMetadata: !!meta,
      },
      warnings: [...new Set(warnings)],
    }
  } catch (err) {
    throw toGhError(err)
  }
}
