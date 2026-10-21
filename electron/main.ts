import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'
import { BrowserWindow, app, shell } from 'electron'

import { createApp } from '../server/app.ts'
import { CollabManager, createWebSocketServer } from '../server/collab/index.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL

let collab: CollabManager | null = null

function hostDisplayName() {
  try {
    return os.userInfo().username || os.hostname()
  } catch {
    return os.hostname()
  }
}

let serverStart: Promise<string> | null = null

/**
 * El proceso principal levanta la misma API que el modo web, en localhost.
 * - Desarrollo: API en 8787 (Vite hace proxy) y la ventana carga el servidor de Vite.
 * - Producción: API + dist/ en un puerto libre y la ventana carga esa URL.
 * Se arranca una sola vez (en macOS `activate` puede volver a crear la ventana).
 */
function startServer(): Promise<string> {
  serverStart ??= startServerOnce()
  return serverStart
}

function startServerOnce(): Promise<string> {
  const staticDir = devServerUrl ? undefined : path.join(app.getAppPath(), 'dist')
  // Colaboración en red: las salas se guardan en userData/salas; el listener de red (al compartir)
  // sirve dist/ o, en desarrollo, hace proxy a Vite.
  collab = new CollabManager({
    dataDir: app.getPath('userData'),
    hostName: hostDisplayName(),
    staticDir,
    devServerUrl,
  })
  const honoApp = createApp({ runtime: 'desktop', staticDir, collab })
  return new Promise((resolve) => {
    const server = serve(
      {
        fetch: honoApp.fetch,
        port: devServerUrl ? 8787 : 0,
        hostname: '127.0.0.1',
        websocket: { server: createWebSocketServer() },
      },
      (info: AddressInfo) => resolve(`http://127.0.0.1:${info.port}`),
    )
    app.on('will-quit', () => server.close())
  })
}

// Antes de salir se cierra la sesión compartida: {t:'ended'} a los invitados, sala guardada y anuncio mDNS retirado.
let collabStopped = false
app.on('before-quit', (event) => {
  if (collabStopped || !collab?.room) return
  event.preventDefault()
  collabStopped = true
  void collab
    .stop()
    .catch(() => undefined)
    .finally(() => app.quit())
})

async function createWindow() {
  const serverUrl = await startServer()

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'DB Tracker',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Enlaces externos (GitHub, documentación) se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = devServerUrl ?? serverUrl
    if (!url.startsWith(allowed)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  await win.loadURL(devServerUrl ?? serverUrl)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})
