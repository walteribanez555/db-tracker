// Replica la historia de versiones de DB Tracker en Git usando la Git Data API
// (blobs -> trees -> commits -> refs). Una rama por flujo, un commit por versión.
import { createHash } from 'node:crypto'

import type { Octokit } from '@octokit/rest'

import type {
  GithubUser,
  RefResult,
  SyncEvent,
  SyncInput,
  SyncResult,
  SyncVersionInput,
} from '../../../src/features/github/types.ts'
import { encodeRefPath } from './client.ts'
import { GhError, errStatus, toGhError } from './errors.ts'

interface CommitRef {
  sha: string
  treeSha: string
}

/** Orden topológico: padres antes que hijos; entre nodos listos, el más antiguo primero. */
export function topoOrder(versions: SyncVersionInput[]): { order: SyncVersionInput[]; orphans: string[] } {
  const ids = new Set(versions.map((v) => v.id))
  const children = new Map<string, SyncVersionInput[]>()
  const ready: SyncVersionInput[] = []
  const orphans: string[] = []
  for (const v of versions) {
    if (v.parentId && ids.has(v.parentId)) {
      const list = children.get(v.parentId) ?? []
      list.push(v)
      children.set(v.parentId, list)
    } else {
      if (v.parentId) orphans.push(v.id)
      ready.push(v)
    }
  }
  const time = (v: SyncVersionInput) => Date.parse(v.createdAt) || 0
  const order: SyncVersionInput[] = []
  while (ready.length) {
    ready.sort((a, b) => time(a) - time(b))
    const next = ready.shift()!
    order.push(next)
    ready.push(...(children.get(next.id) ?? []))
  }
  if (order.length !== versions.length) {
    throw new GhError(400, 'bad_request', 'La historia de versiones contiene un ciclo (parentId inconsistente).')
  }
  return { order, orphans }
}

/** SHA-1 de blob tal como lo calcula Git (sirve para deduplicar blobs dentro de una sincronización). */
const gitBlobSha = (content: string) => {
  const buf = Buffer.from(content, 'utf8')
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

/** GitHub quiere ISO 8601 sin milisegundos. */
const gitDate = (iso: string) => {
  const d = new Date(iso)
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'autor'

export async function* runSync(octokit: Octokit, input: SyncInput, me: GithubUser): AsyncGenerator<SyncEvent> {
  const { owner, repo } = input
  const warnings: string[] = []

  let repoDefault: string
  try {
    const { data } = await octokit.repos.get({ owner, repo })
    if (data.permissions && !data.permissions.push) {
      throw new GhError(403, 'forbidden', `Tu cuenta no tiene permiso de escritura en ${owner}/${repo}.`)
    }
    repoDefault = data.default_branch
  } catch (err) {
    throw toGhError(err)
  }

  const { order, orphans } = topoOrder(input.versions)
  if (orphans.length) warnings.push(`${orphans.length} versión(es) apuntan a un padre inexistente; se publican como raíz.`)
  yield { type: 'start', total: order.length, order: order.map((v) => v.id) }

  const meEmail = `${me.id}+${me.login}@users.noreply.github.com`
  const meName = me.name || me.login
  const identity = (author: string) => {
    const a = author.trim()
    const isMe = !a || a === 'local' || a.toLowerCase() === me.login.toLowerCase() || a === me.name
    return isMe ? { name: meName, email: meEmail } : { name: a, email: `${slug(a)}@users.noreply.db-tracker.local` }
  }

  // ---- Commit base para versiones raíz: cabeza de la rama por defecto (o commit de arranque si el repo está vacío).
  let rootBase: CommitRef | null | undefined
  const getRootBase = async function* (): AsyncGenerator<SyncEvent, CommitRef> {
    if (rootBase) return rootBase
    try {
      const ref = await octokit.request(`GET /repos/{owner}/{repo}/git/ref/heads/${encodeRefPath(repoDefault)}`, {
        owner,
        repo,
      })
      const sha = (ref.data as { object: { sha: string } }).object.sha
      const commit = await octokit.git.getCommit({ owner, repo, commit_sha: sha })
      rootBase = { sha, treeSha: commit.data.tree.sha }
      return rootBase
    } catch (err) {
      const status = errStatus(err)
      if (status !== 404 && status !== 409) throw toGhError(err)
    }
    // Repositorio vacío: la Git Data API no funciona hasta que exista un primer commit.
    try {
      const res = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: 'README.md',
        branch: input.defaultBranch,
        message: 'Inicializa el repositorio (DB Tracker)',
        content: Buffer.from(`# ${repo}\n\nRepositorio gestionado con DB Tracker.\n`, 'utf8').toString('base64'),
        committer: { name: meName, email: meEmail },
        author: { name: meName, email: meEmail },
      })
      const c = res.data.commit
      if (!c.sha || !c.tree?.sha) throw new GhError(502, 'github_error', 'No se pudo inicializar el repositorio vacío.')
      repoDefault = input.defaultBranch
      rootBase = { sha: c.sha, treeSha: c.tree.sha }
      yield { type: 'bootstrap', message: `Repositorio vacío: se creó un commit inicial en "${input.defaultBranch}".` }
      return rootBase
    } catch (err) {
      throw toGhError(err)
    }
  }

  const commits = new Map<string, CommitRef>()
  const blobCache = new Map<string, string>()
  let created = 0
  let skipped = 0

  const createBlob = async (content: string) => {
    const key = gitBlobSha(content)
    const cached = blobCache.get(key)
    if (cached) return cached
    const { data } = await octokit.git.createBlob({ owner, repo, content, encoding: 'utf-8' })
    blobCache.set(key, data.sha)
    return data.sha
  }

  for (let i = 0; i < order.length; i++) {
    const v = order[i]
    try {
      // Idempotencia: si ya tiene SHA y el commit existe en el repo, se reutiliza.
      if (v.githubSha) {
        try {
          const { data } = await octokit.git.getCommit({ owner, repo, commit_sha: v.githubSha })
          commits.set(v.id, { sha: data.sha, treeSha: data.tree.sha })
          skipped++
          yield { type: 'version', versionId: v.id, index: i, total: order.length, status: 'skipped', sha: data.sha }
          continue
        } catch (err) {
          const s = errStatus(err)
          if (s !== 404 && s !== 422) throw err
          // No existe en este repo: se vuelve a crear.
        }
      }

      const parent = v.parentId ? commits.get(v.parentId) : undefined
      const base = parent ?? (yield* getRootBase())

      const entries = await Promise.all(
        v.files.map(async (f) => ({
          path: f.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: await createBlob(f.content),
        })),
      )
      const tree = await octokit.git.createTree({ owner, repo, base_tree: base.treeSha, tree: entries })

      const date = gitDate(v.createdAt)
      const branchName = input.branches.find((b) => b.id === v.branchId)?.name ?? 'desconocida'
      const message = `${v.message.trim() || 'Versión sin mensaje'}\n\nDB-Tracker-Version: ${v.id}\nDB-Tracker-Flujo: ${branchName}\n`
      const commit = await octokit.git.createCommit({
        owner,
        repo,
        message,
        tree: tree.data.sha,
        parents: [base.sha],
        author: { ...identity(v.author), date },
        committer: { name: meName, email: meEmail, date },
      })
      commits.set(v.id, { sha: commit.data.sha, treeSha: tree.data.sha })
      created++
      yield { type: 'version', versionId: v.id, index: i, total: order.length, status: 'created', sha: commit.data.sha }
    } catch (err) {
      const e = toGhError(err)
      yield { type: 'version-error', versionId: v.id, message: e.message }
      throw e
    }
  }

  // ---- Refs: una rama por flujo apuntando a su versión cabeza.
  const refs: RefResult[] = []
  const refExists = new Set<string>()
  for (const b of input.branches) {
    const versionId = b.headVersionId ?? b.forkedFromVersionId
    const target = versionId ? commits.get(versionId)?.sha : undefined
    if (!target) {
      const r: RefResult = { branch: b.name, sha: null, status: 'skipped', message: 'El flujo no tiene versiones.' }
      refs.push(r)
      yield { type: 'ref', ref: r }
      continue
    }
    const r = await upsertRef(octokit, owner, repo, b.name, target, input.force)
    if (r.status !== 'error' && r.status !== 'skipped') refExists.add(b.name)
    refs.push(r)
    yield { type: 'ref', ref: r }
  }

  // ---- Rama por defecto del repositorio.
  if (repoDefault !== input.defaultBranch && refExists.has(input.defaultBranch)) {
    try {
      await octokit.repos.update({ owner, repo, default_branch: input.defaultBranch })
      yield { type: 'default-branch', branch: input.defaultBranch }
    } catch (err) {
      warnings.push(`No se pudo fijar "${input.defaultBranch}" como rama por defecto: ${toGhError(err).message}`)
    }
  }

  const conflicts = refs.filter((r) => r.status === 'conflict')
  if (conflicts.length) {
    warnings.push(
      `${conflicts.length} rama(s) divergen del remoto y no se actualizaron. Baja primero o activa "Forzar actualización de ramas" para reescribirlas.`,
    )
  }

  const mapping: Record<string, string> = {}
  for (const [id, c] of commits) mapping[id] = c.sha
  const result: SyncResult = { mapping, created, skipped, refs, warnings }
  yield { type: 'done', result }
}

async function upsertRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
  force: boolean,
): Promise<RefResult> {
  const path = `/repos/{owner}/{repo}/git/refs/heads/${encodeRefPath(branch)}`
  let current: string | null = null
  try {
    const res = await octokit.request(`GET /repos/{owner}/{repo}/git/ref/heads/${encodeRefPath(branch)}`, { owner, repo })
    current = (res.data as { object: { sha: string } }).object.sha
  } catch (err) {
    if (errStatus(err) !== 404) return { branch, sha: null, status: 'error', message: toGhError(err).message }
  }
  try {
    if (current === null) {
      await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha })
      return { branch, sha, status: 'created' }
    }
    if (current === sha) return { branch, sha, status: 'unchanged' }
    try {
      await octokit.request(`PATCH ${path}`, { owner, repo, sha, force: false })
      return { branch, sha, status: 'updated' }
    } catch (err) {
      if (errStatus(err) !== 422) throw err
      if (!force) {
        return {
          branch,
          sha: current,
          status: 'conflict',
          message: 'La rama remota tiene commits que no están en DB Tracker (no es fast-forward).',
        }
      }
      await octokit.request(`PATCH ${path}`, { owner, repo, sha, force: true })
      return { branch, sha, status: 'forced' }
    }
  } catch (err) {
    const e = toGhError(err)
    const msg =
      e.code === 'validation' ? `Nombre de rama no válido o en conflicto con otra ref ("${branch}"): ${e.message}` : e.message
    return { branch, sha: current, status: 'error', message: msg }
  }
}
