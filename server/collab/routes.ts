// Rutas REST de /api/collab y WebSocket /sync/:sessionId (contrato en src/collab/protocol.ts).
// Se montan en las dos apps: la local (127.0.0.1) y la de red (0.0.0.0, solo mientras se comparte).
// Las rutas "solo loopback" se deciden por LISTENER: en la app de red siempre responden 403.
import { upgradeWebSocket } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import type { WebSocket } from 'ws'
import { z } from 'zod'

import type { CollabManager } from './manager.ts'
import { CollabError } from './manager.ts'
import { isTrustedLocalRequest } from './network.ts'
import type { SocketHandle } from './room.ts'

export type ListenerKind = 'local' | 'lan'

const shareSchema = z.object({
  projectName: z.string().trim().min(1, 'Falta el nombre del proyecto.').max(120),
  hostName: z.string().trim().max(60).optional().default(''),
  port: z.number().int().min(1024).max(65535).optional(),
  autoApprove: z.boolean().optional(),
  shareRemoteApis: z.boolean().optional(),
})

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'kick', 'set-role']),
  role: z.enum(['editor', 'viewer']).optional(),
})

async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => {
    throw new CollabError('El cuerpo de la petición no es JSON válido.', 400)
  })
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new CollabError(`Datos no válidos (${issue.path.join('.') || 'cuerpo'}): ${issue.message}`, 400)
  }
  return parsed.data
}

export function collabRoutes(manager: CollabManager, listener: ListenerKind) {
  const r = new Hono()

  r.onError((err, c) => {
    if (err instanceof CollabError) return c.json({ ok: false, error: err.message }, err.status)
    console.error(`[collab] ${c.req.method} ${c.req.path}: ${(err as Error).message}`)
    return c.json({ ok: false, error: 'Error interno de la colaboración.' }, 500)
  })

  const localOnly: MiddlewareHandler = async (c, next) => {
    if (listener !== 'local' || !isTrustedLocalRequest(c)) {
      return c.json({ ok: false, error: 'Solo disponible desde el propio equipo del anfitrión.' }, 403)
    }
    await next()
  }

  r.get('/status', localOnly, (c) => c.json(manager.status()))

  r.post('/share', localOnly, async (c) => {
    const body = await parseBody(c, shareSchema)
    return c.json(await manager.share(body))
  })

  r.post('/stop', localOnly, async (c) => {
    await manager.stop()
    return c.json({ ok: true as const })
  })

  r.post('/participants/:id', localOnly, async (c) => {
    const body = await parseBody(c, actionSchema)
    if (body.action === 'set-role' && !body.role) throw new CollabError('Falta el rol (editor o viewer).', 400)
    manager.act(c.req.param('id'), body)
    return c.json({ ok: true as const })
  })

  r.get('/discover', localOnly, async (c) => c.json(await manager.discover()))

  // Pública: la consultan navegadores y escritorios invitados desde otro origen (CORS abierto, sin secreto).
  r.use('/public/*', cors({ origin: '*', allowMethods: ['GET'] }))
  r.get('/public/:code', (c) => {
    const info = manager.publicInfo(c.req.param('code'))
    if (!info) return c.json({ ok: false, error: 'No hay ninguna sesión con ese código.' }, 404)
    return c.json(info)
  })

  return r
}

const PING_INTERVAL_MS = 30_000

/** Manejador de WS /sync/:sessionId. En 'local' + loopback el secreto da rol owner. */
export function syncRoute(manager: CollabManager, listener: ListenerKind) {
  return upgradeWebSocket((c) => {
    const sessionId = c.req.param('sessionId') ?? ''
    let address = ''
    try {
      address = getConnInfo(c).remote.address ?? ''
    } catch {
      /* sin información de conexión */
    }
    const trustedLocal = listener === 'local' && isTrustedLocalRequest(c)
    let handle: SocketHandle | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null

    return {
      onOpen(_event, ws) {
        const raw = ws.raw as WebSocket | undefined
        handle = manager.attachSocket(
          sessionId,
          {
            send: (data) => ws.send(data as string | Uint8Array<ArrayBuffer>),
            close: (code, reason) => ws.close(code, reason),
            get isOpen() {
              return ws.readyState === 1
            },
          },
          { listener, address, trustedLocal },
        )
        // Keepalive: se cierran las conexiones que no responden al ping (Wi-Fi caída, portátil dormido).
        if (handle && raw) {
          let alive = true
          raw.on('pong', () => {
            alive = true
          })
          pingTimer = setInterval(() => {
            if (!alive) {
              raw.terminate()
              return
            }
            alive = false
            try {
              raw.ping()
            } catch {
              raw.terminate()
            }
          }, PING_INTERVAL_MS)
        }
      },
      onMessage(event) {
        handle?.message(event.data as string | ArrayBuffer)
      },
      onClose() {
        if (pingTimer) clearInterval(pingTimer)
        handle?.close()
        handle = null
      },
      onError() {
        if (pingTimer) clearInterval(pingTimer)
        handle?.close()
        handle = null
      },
    }
  })
}
