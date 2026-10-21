import { contextBridge, ipcRenderer } from 'electron'

// API mínima expuesta al frontend; todo lo demás va por HTTP a la API local.
contextBridge.exposeInMainWorld('dbTracker', {
  runtime: 'desktop',
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  /** Sincroniza el tema de la ventana nativa (barra de título, fondo) con el de la app. */
  setTheme: (theme: 'light' | 'dark' | 'system', background?: string) => ipcRenderer.send('dbtracker:theme', theme, background),
})
