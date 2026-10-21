import path from 'node:path'

import { serve } from '@hono/node-server'

import { createApp } from './app.ts'

// Entrada del modo web. En desarrollo Vite sirve el frontend y hace proxy de /api;
// en producción este proceso sirve también dist/.
const production = process.env.NODE_ENV === 'production'
const app = createApp({
  runtime: 'web',
  staticDir: production ? path.resolve(process.env.STATIC_DIR ?? 'dist') : undefined,
})

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' })
console.log(`db-tracker (web) en http://localhost:${port}`)
