import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

import { collabRoutes, syncRoute, type CollabManager } from './collab/index.ts'
import { dbRoutes } from './routes/db.ts'
import { githubRoutes } from './routes/github.ts'

export interface AppOptions {
  /** Carpeta con el frontend compilado (dist). Si se omite, solo se sirve la API (modo dev con Vite). */
  staticDir?: string
  runtime: 'web' | 'desktop'
  /** Gestor de colaboración en red. Si se omite, no se montan /api/collab ni /sync. */
  collab?: CollabManager
}

/**
 * App HTTP compartida por el servidor web y por el proceso principal de Electron.
 * Es la app del listener LOCAL (127.0.0.1): aquí /api/collab/* "solo loopback" está disponible y
 * el anfitrión se conecta a /sync con rol owner. El listener de red usa createLanApp (server/collab).
 * Para el WebSocket, el servidor debe arrancarse con `websocket: { server: createWebSocketServer() }`.
 */
export function createApp({ staticDir, runtime, collab }: AppOptions) {
  const app = new Hono()
  app.use('/api/*', logger())

  app.get('/api/health', (c) => c.json({ ok: true, runtime }))
  app.route('/api/db', dbRoutes)
  app.route('/api/github', githubRoutes)
  if (collab) {
    app.route('/api/collab', collabRoutes(collab, 'local'))
    app.get('/sync/:sessionId', syncRoute(collab, 'local'))
  }

  if (staticDir) {
    const root = path.relative(process.cwd(), staticDir) || '.'
    app.use('/*', serveStatic({ root }))
    // Fallback SPA: cualquier ruta no-API devuelve index.html (react-router se encarga).
    app.get('*', async (c) => {
      if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/sync/')) return c.notFound()
      return c.html(await readFile(path.join(staticDir, 'index.html'), 'utf8'))
    })
  }

  return app
}
