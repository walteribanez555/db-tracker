import os from 'node:os'
import path from 'node:path'

import { serve } from '@hono/node-server'

import { createApp } from './app.ts'
import { CollabManager, createWebSocketServer } from './collab/index.ts'

// Entrada del modo web. En desarrollo Vite sirve el frontend y hace proxy de /api y /sync;
// en producción este proceso sirve también dist/.
const production = process.env.NODE_ENV === 'production'
const staticDir = production ? path.resolve(process.env.STATIC_DIR ?? 'dist') : undefined

const collab = new CollabManager({
  dataDir: path.resolve(process.env.DBTRACKER_DATA_DIR ?? '.dbtracker-data'),
  hostName: os.userInfo().username || os.hostname(),
  staticDir,
  devServerUrl: process.env.VITE_DEV_SERVER_URL,
})
const app = createApp({ runtime: 'web', staticDir, collab })

const port = Number(process.env.PORT ?? 8787)
const server = serve({
  fetch: app.fetch,
  port,
  hostname: process.env.HOST ?? '127.0.0.1',
  websocket: { server: createWebSocketServer() },
})
console.log(`db-tracker (web) en http://localhost:${port}`)

// Al salir se avisa a los invitados ({t:'ended'}), se guarda la sala y se retira el anuncio mDNS.
let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  await collab.stop().catch(() => undefined)
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
