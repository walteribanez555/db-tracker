// Servidor de la colaboración en red. Diseño: docs/arquitectura/colaboracion-en-red.md
export { CollabManager, CollabError, type CollabManagerOptions } from './manager.ts'
export { createLanApp } from './lan-app.ts'
export { collabRoutes, syncRoute } from './routes.ts'
export { createWebSocketServer } from './listen.ts'
