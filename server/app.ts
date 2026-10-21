import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

import { dbRoutes } from './routes/db.ts'
import { githubRoutes } from './routes/github.ts'

export interface AppOptions {
  /** Carpeta con el frontend compilado (dist). Si se omite, solo se sirve la API (modo dev con Vite). */
  staticDir?: string
  runtime: 'web' | 'desktop'
}

/** App HTTP compartida por el servidor web y por el proceso principal de Electron. */
export function createApp({ staticDir, runtime }: AppOptions) {
  const app = new Hono()
  app.use('/api/*', logger())

  app.get('/api/health', (c) => c.json({ ok: true, runtime }))
  app.route('/api/db', dbRoutes)
  app.route('/api/github', githubRoutes)

  if (staticDir) {
    const root = path.relative(process.cwd(), staticDir) || '.'
    app.use('/*', serveStatic({ root }))
    // Fallback SPA: cualquier ruta no-API devuelve index.html (react-router se encarga).
    app.get('*', async (c) => {
      if (c.req.path.startsWith('/api/')) return c.notFound()
      return c.html(await readFile(path.join(staticDir, 'index.html'), 'utf8'))
    })
  }

  return app
}
