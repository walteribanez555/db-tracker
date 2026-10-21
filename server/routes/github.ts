import type { Octokit } from '@octokit/rest'
import { Hono, type Context } from 'hono'
import { stream } from 'hono/streaming'
import { z } from 'zod'

import { deviceFlowClientId, makeOctokit, pollDeviceToken, requestDeviceCode, tokenKindOf, whoAmI } from '../lib/github/client.ts'
import { GhError, toGhError } from '../lib/github/errors.ts'
import { pullProject } from '../lib/github/pull.ts'
import { buildReport } from '../lib/github/report.ts'
import { destroySession, ensureSession, getSession, rotateSession, type GhSession } from '../lib/github/session.ts'
import { runSync } from '../lib/github/sync.ts'
import type {
  DevicePollResponse,
  DeviceStartResponse,
  GithubMe,
  GithubRepoSummary,
  PullEvent,
  RemoteBranch,
  SyncEvent,
  SyncInput,
} from '../../src/features/github/types.ts'

// Rutas montadas en /api/github. Cuenta, repos, ramas por flujo e informes.
export const githubRoutes = new Hono()

githubRoutes.onError((err, c) => {
  const e = err instanceof GhError ? err : toGhError(err)
  // Nunca se registra el cuerpo de la petición (puede contener el token).
  if (e.status >= 500) console.error(`[github] ${c.req.method} ${c.req.path}: ${e.code} ${e.message}`)
  return c.json(e.toBody(), e.status as 400)
})

// ---------- Helpers ----------

function requireAuth(c: Context): { session: GhSession & { token: string }; octokit: Octokit } {
  const session = getSession(c)
  if (!session?.token) {
    throw new GhError(401, 'unauthorized', 'No has conectado tu cuenta de GitHub.')
  }
  return { session: session as GhSession & { token: string }, octokit: makeOctokit(session.token) }
}

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => {
    throw new GhError(400, 'bad_request', 'El cuerpo de la petición no es JSON válido.')
  })
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new GhError(400, 'bad_request', `Datos no válidos (${issue.path.join('.') || 'cuerpo'}): ${issue.message}`)
  }
  return parsed.data
}

const meOf = (s: GhSession | undefined): GithubMe => {
  const deviceFlowAvailable = !!deviceFlowClientId()
  if (!s?.token || !s.user) return { connected: false, deviceFlowAvailable }
  return {
    connected: true,
    deviceFlowAvailable,
    user: s.user,
    tokenKind: s.tokenKind ?? 'classic',
    scopes: s.scopes ?? null,
    warnings: (s.scopes && !s.scopes.includes('repo') ? ['El token solo permite repositorios públicos.'] : []),
  }
}

const ownerRepoQuery = z.object({
  owner: z.string().min(1).max(100).regex(/^[\w.-]+$/),
  repo: z.string().min(1).max(100).regex(/^[\w.-]+$/),
})

function parseOwnerRepo(c: Context) {
  const parsed = ownerRepoQuery.safeParse({ owner: c.req.query('owner'), repo: c.req.query('repo') })
  if (!parsed.success) throw new GhError(400, 'bad_request', 'Faltan los parámetros "owner" y "repo".')
  return parsed.data
}

// ---------- Autenticación ----------

githubRoutes.get('/me', async (c) => {
  const s = getSession(c)
  if (s?.token) {
    // Revalida el token: detecta tokens revocados y refresca el perfil.
    try {
      const who = await whoAmI(s.token)
      s.user = who.user
      s.scopes = who.scopes
    } catch (err) {
      const e = toGhError(err)
      if (e.code === 'unauthorized' || e.code === 'forbidden') {
        destroySession(c)
        return c.json(meOf(undefined))
      }
      throw e
    }
  }
  return c.json(meOf(s))
})

githubRoutes.post('/token', async (c) => {
  const { token } = await parseBody(
    c,
    z.object({ token: z.string().trim().min(20, 'El token parece demasiado corto.').max(255).regex(/^[\w-]+$/, 'El token tiene caracteres no válidos.') }),
  )
  const who = await whoAmI(token)
  const s = rotateSession(c, ensureSession(c))
  s.token = token
  s.tokenKind = tokenKindOf(token)
  s.scopes = who.scopes
  s.user = who.user
  s.device = undefined
  const me = meOf(s)
  if (me.connected) me.warnings = who.warnings
  return c.json(me)
})

githubRoutes.post('/logout', (c) => {
  destroySession(c)
  return c.json({ ok: true })
})

githubRoutes.post('/device/start', async (c) => {
  const clientId = deviceFlowClientId()
  if (!clientId) {
    throw new GhError(
      400,
      'device_flow_disabled',
      'El inicio de sesión con dispositivo no está configurado: define GITHUB_CLIENT_ID (OAuth App con Device Flow activado).',
    )
  }
  const data = await requestDeviceCode(clientId)
  const s = ensureSession(c)
  s.device = { deviceCode: data.device_code, interval: data.interval, expiresAt: Date.now() + data.expires_in * 1000 }
  const body: DeviceStartResponse = {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
  return c.json(body)
})

githubRoutes.post('/device/poll', async (c) => {
  const clientId = deviceFlowClientId()
  const s = getSession(c)
  if (!clientId || !s?.device) {
    throw new GhError(400, 'bad_request', 'No hay un inicio de sesión con dispositivo en curso.')
  }
  if (Date.now() > s.device.expiresAt) {
    s.device = undefined
    return c.json<DevicePollResponse>({ status: 'expired', message: 'El código caducó. Genera uno nuevo.' })
  }
  const r = await pollDeviceToken(clientId, s.device.deviceCode)
  switch (r.kind) {
    case 'pending':
      return c.json<DevicePollResponse>({ status: 'pending', interval: s.device.interval })
    case 'slow_down':
      s.device.interval = r.interval
      return c.json<DevicePollResponse>({ status: 'slow_down', interval: r.interval })
    case 'expired':
      s.device = undefined
      return c.json<DevicePollResponse>({ status: 'expired', message: 'El código caducó. Genera uno nuevo.' })
    case 'denied':
      s.device = undefined
      return c.json<DevicePollResponse>({ status: 'denied', message: 'Se canceló la autorización en GitHub.' })
    case 'token': {
      const who = await whoAmI(r.token)
      const next = rotateSession(c, s)
      next.token = r.token
      next.tokenKind = 'oauth'
      next.scopes = who.scopes
      next.user = who.user
      next.device = undefined
      return c.json<DevicePollResponse>({ status: 'complete', me: meOf(next) })
    }
  }
})

// ---------- Repositorios ----------

githubRoutes.get('/repos', async (c) => {
  const { octokit } = requireAuth(c)
  try {
    let count = 0
    const repos = await octokit.paginate(
      octokit.repos.listForAuthenticatedUser,
      { per_page: 100, sort: 'updated', affiliation: 'owner,collaborator,organization_member' },
      (res, done) => {
        count += res.data.length
        if (count >= 300) done()
        return res.data
      },
    )
    const out: GithubRepoSummary[] = repos.map((r) => ({
      id: r.id,
      owner: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch ?? 'main',
      description: r.description ?? null,
      updatedAt: r.updated_at ?? null,
      canPush: r.permissions?.push ?? false,
      empty: r.size === 0,
    }))
    return c.json(out)
  } catch (err) {
    throw toGhError(err)
  }
})

githubRoutes.post('/repos', async (c) => {
  const { octokit } = requireAuth(c)
  const input = await parseBody(
    c,
    z.object({
      name: z
        .string()
        .trim()
        .min(1, 'Indica un nombre.')
        .max(100)
        .regex(/^[\w.-]+$/, 'Usa solo letras, números, "-", "_" y "."'),
      description: z.string().max(350).optional(),
      private: z.boolean().default(true),
      autoInit: z.boolean().default(true),
    }),
  )
  try {
    const { data: r } = await octokit.repos.createForAuthenticatedUser({
      name: input.name,
      description: input.description,
      private: input.private,
      auto_init: input.autoInit,
    })
    const out: GithubRepoSummary = {
      id: r.id,
      owner: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      htmlUrl: r.html_url,
      defaultBranch: r.default_branch ?? 'main',
      description: r.description ?? null,
      updatedAt: r.updated_at ?? null,
      canPush: true,
      empty: !input.autoInit,
    }
    return c.json(out, 201)
  } catch (err) {
    throw toGhError(err)
  }
})

githubRoutes.get('/branches', async (c) => {
  const { octokit } = requireAuth(c)
  const { owner, repo } = parseOwnerRepo(c)
  try {
    const branches = await octokit.paginate(octokit.repos.listBranches, { owner, repo, per_page: 100 })
    return c.json<RemoteBranch[]>(branches.map((b) => ({ name: b.name, sha: b.commit.sha })))
  } catch (err) {
    const e = toGhError(err)
    if (e.code === 'repo_empty') return c.json<RemoteBranch[]>([])
    throw e
  }
})

// ---------- Sincronización ----------

const refName = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (n) =>
      !/(^[/.])|([/.]$)|\.\.|\/\/|@\{|\.lock(\/|$)|[\s~^:?*[\\]/.test(n) &&
      ![...n].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) &&
      n !== '@',
    'Nombre de rama no válido para Git.',
  )

const filePath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => /^[\w.\-/]+$/.test(p) && !p.startsWith('/') && !p.split('/').some((seg) => seg === '' || seg === '..' || seg === '.git'), 'Ruta de archivo no válida.')

const syncSchema = z.object({
  owner: ownerRepoQuery.shape.owner,
  repo: ownerRepoQuery.shape.repo,
  defaultBranch: refName.default('main'),
  force: z.boolean().default(false),
  branches: z
    .array(
      z.object({
        id: z.string().min(1),
        name: refName,
        forkedFromVersionId: z.string().nullable(),
        headVersionId: z.string().nullable(),
      }),
    )
    .min(1)
    .max(200),
  versions: z
    .array(
      z.object({
        id: z.string().min(1),
        branchId: z.string().min(1),
        parentId: z.string().nullable(),
        message: z.string().max(5000),
        author: z.string().max(200),
        createdAt: z.string(),
        githubSha: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .optional()
          .or(z.literal('').transform(() => undefined)),
        files: z.array(z.object({ path: filePath, content: z.string().max(5_000_000) })).max(200),
      }),
    )
    .max(2000),
})

githubRoutes.post('/sync', async (c) => {
  const { session, octokit } = requireAuth(c)
  const input = (await parseBody(c, syncSchema)) as SyncInput
  const me = session.user!
  const wantsStream = (c.req.header('accept') ?? '').includes('application/x-ndjson')

  if (!wantsStream) {
    // Modo JSON clásico: espera a terminar y devuelve el resultado completo.
    let result: Extract<SyncEvent, { type: 'done' }>['result'] | undefined
    for await (const ev of runSync(octokit, input, me)) if (ev.type === 'done') result = ev.result
    return c.json(result)
  }

  // Modo streaming (NDJSON): un evento por línea para mostrar progreso por versión.
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  return stream(c, async (s) => {
    try {
      for await (const ev of runSync(octokit, input, me)) {
        await s.write(JSON.stringify(ev) + '\n')
      }
    } catch (err) {
      const e = toGhError(err)
      await s.write(JSON.stringify({ type: 'error', error: e.toBody().error } satisfies SyncEvent) + '\n')
    }
  })
})

// ---------- Informe ----------

githubRoutes.get('/report', async (c) => {
  const { octokit } = requireAuth(c)
  const { owner, repo } = parseOwnerRepo(c)
  return c.json(await buildReport(octokit, owner, repo))
})

// ---------- Bajar (pull) ----------

githubRoutes.get('/pull', async (c) => {
  const { octokit } = requireAuth(c)
  const { owner, repo } = parseOwnerRepo(c)
  if (!(c.req.header('accept') ?? '').includes('application/x-ndjson')) {
    return c.json(await pullProject(octokit, owner, repo))
  }
  // Streaming (NDJSON): progreso por versión mientras se leen los schema.json.
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
  c.header('Cache-Control', 'no-store')
  return stream(c, async (s) => {
    const write = (ev: PullEvent) => s.write(JSON.stringify(ev) + '\n').then(() => undefined)
    try {
      const result = await pullProject(octokit, owner, repo, write)
      await write({ type: 'done', result })
    } catch (err) {
      await write({ type: 'error', error: toGhError(err).toBody().error })
    }
  })
})
