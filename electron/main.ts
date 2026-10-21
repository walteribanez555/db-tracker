import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, app, ipcMain, nativeTheme, shell } from 'electron'

import { createApp } from '../server/app.ts'
import { CollabManager } from '../server/collab/index.ts'
import { startServer as listen } from '../server/collab/listen.ts'
import { McpService } from '../server/mcp/index.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL

let collab: CollabManager | null = null
let mcp: McpService | null = null

/** Puerto preferido de la API local: estable para que los clientes MCP no tengan que reconfigurarse. */
const PREFERRED_PORT = 8787

function hostDisplayName() {
  try {
    return os.userInfo().username || os.hostname()
  } catch {
    return os.hostname()
  }
}

let serverStart: Promise<string> | null = null

/**
 * El proceso principal levanta la misma API que el modo web, en 127.0.0.1.
 * - Puerto: 8787 o, si está ocupado, el siguiente libre. La URL efectiva (y la del MCP) se publica en
 *   `<userData>/server.json` y en `~/.dbtracker/server.json` para los clientes MCP y el puente stdio.
 * - Desarrollo: la ventana carga el servidor de Vite (que hace proxy de /api y /sync a 8787).
 * - Producción: la API sirve también dist/ y la ventana carga esa URL.
 * Se arranca una sola vez (en macOS `activate` puede volver a crear la ventana).
 */
function startServer(): Promise<string> {
  serverStart ??= startServerOnce()
  return serverStart
}

async function startServerOnce(): Promise<string> {
  const staticDir = devServerUrl ? undefined : path.join(app.getAppPath(), 'dist')
  // Colaboración en red: las salas se guardan en userData/salas; el listener de red (al compartir)
  // sirve dist/ o, en desarrollo, hace proxy a Vite.
  const dataDir = app.getPath('userData')
  collab = new CollabManager({
    dataDir,
    hostName: hostDisplayName(),
    staticDir,
    devServerUrl,
  })
  // En desarrollo la app es el repositorio (dist-mcp/stdio.mjs); empaquetada, el puente no va dentro del asar.
  mcp = new McpService({ dataDir, collab, runtime: 'desktop', repoDir: app.isPackaged ? undefined : app.getAppPath() })
  const honoApp = createApp({ runtime: 'desktop', staticDir, collab, mcp })
  const running = await listen({ fetch: honoApp.fetch, hostname: '127.0.0.1', port: PREFERRED_PORT, fallback: true })
  const url = `http://127.0.0.1:${running.port}`
  mcp.setUrl(url)
  if (running.port !== PREFERRED_PORT) {
    console.warn(`[desktop] El puerto ${PREFERRED_PORT} está ocupado; la API local usa ${running.port}.${devServerUrl ? ' Ojo: Vite hace proxy a 8787.' : ''}`)
  }
  console.log(`[desktop] API local en ${url} · MCP en ${mcp.mcpUrl}`)
  app.on('will-quit', () => {
    mcp?.cleanup()
    void running.close()
  })
  return url
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

/** Fondo de la ventana nativa por tema (igual que --background en src/index.css). */
const WINDOW_BG = { light: '#ffffff', dark: '#0e1621' } as const

// La app avisa de su tema: la barra de título nativa y el fondo de la ventana cambian a la vez que la página,
// así el revelado circular no deja ver un fondo o una barra del tema anterior.
ipcMain.on('dbtracker:theme', (event, theme: unknown, background: unknown) => {
  if (theme !== 'light' && theme !== 'dark' && theme !== 'system') return
  nativeTheme.themeSource = theme
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  const color = typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background) ? background : dark ? WINDOW_BG.dark : WINDOW_BG.light
  BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(color)
})

async function createWindow() {
  const serverUrl = await startServer()

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'DB Tracker',
    // Fondo inicial según el sistema; la página lo ajusta al tema elegido en cuanto carga (dbtracker:theme).
    backgroundColor: nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light,
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
