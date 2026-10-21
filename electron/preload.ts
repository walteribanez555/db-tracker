import { contextBridge } from 'electron'

// API mínima expuesta al frontend; todo lo demás va por HTTP a la API local.
contextBridge.exposeInMainWorld('dbTracker', {
  runtime: 'desktop',
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
})
