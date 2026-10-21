// App Hono reducida del listener de red (0.0.0.0), activa solo mientras se comparte.
// Expone: frontend (dist o proxy a Vite en desarrollo), /api/collab/public/:code, la SPA en /unirse
// y el WebSocket /sync/:sessionId. /api/db y /api/github solo si el anfitrión activa shareRemoteApis.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import { Hono, type MiddlewareHandler } from 'hono'
import { logger } from 'hono/logger'

import { dbRoutes } from '../routes/db.ts'
import { githubRoutes } from '../routes/github.ts'
import type { CollabManager } from './manager.ts'
import { collabRoutes, syncRoute } from './routes.ts'
import { proxyToVite } from './vite-proxy.ts'

export function createLanApp(manager: CollabManager) {
  const app = new Hono()
  app.use('/api/*', logger((line) => console.log(`[lan] ${line}`)))

  app.get('/api/health', (c) => c.json({ ok: true, runtime: 'lan' }))
  app.route('/api/collab', collabRoutes(manager, 'lan'))

  // Por defecto los invitados NO usan las conexiones ni la cuenta de GitHub del anfitrión.
  const remoteApis: MiddlewareHandler = async (c, next) => {
    if (!manager.remoteApisShared) return c.json({ ok: false, error: 'No encontrado.' }, 404)
    await next()
  }
  app.use('/api/db/*', remoteApis)
  app.use('/api/github/*', remoteApis)
  app.route('/api/db', dbRoutes)
  app.route('/api/github', githubRoutes)
  app.all('/api/*', (c) => c.json({ ok: false, error: 'No encontrado.' }, 404))

  app.get('/sync/:sessionId', syncRoute(manager, 'lan'))
  app.all('/sync/*', (c) => c.body(null, 404))

  const staticDir = manager.options.staticDir
  if (staticDir) {
    const root = path.relative(process.cwd(), staticDir) || '.'
    app.use('/*', serveStatic({ root }))
    // SPA: /unirse y cualquier otra ruta del frontend devuelven index.html.
    app.get('*', async (c) => c.html(await readFile(path.join(staticDir, 'index.html'), 'utf8')))
  } else {
    app.all('*', (c) => proxyToVite(c, manager.devServerUrl))
  }

  return app
}
