import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'
import { BrowserWindow, app, shell } from 'electron'

import { createApp } from '../server/app.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL

/**
 * El proceso principal levanta la misma API que el modo web, en localhost.
 * - Desarrollo: API en 8787 (Vite hace proxy) y la ventana carga el servidor de Vite.
 * - Producción: API + dist/ en un puerto libre y la ventana carga esa URL.
 */
function startServer(): Promise<string> {
  const honoApp = createApp({
    runtime: 'desktop',
    staticDir: devServerUrl ? undefined : path.join(app.getAppPath(), 'dist'),
  })
  return new Promise((resolve) => {
    const server = serve({ fetch: honoApp.fetch, port: devServerUrl ? 8787 : 0, hostname: '127.0.0.1' }, (info: AddressInfo) =>
      resolve(`http://127.0.0.1:${info.port}`),
    )
    app.on('before-quit', () => server.close())
  })
}

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
