// Servidor de la colaboración en red. Diseño: docs/arquitectura/colaboracion-en-red.md
export { CollabManager, CollabError, PROVISIONAL_PROJECT_NAME, type CollabManagerOptions, type HostSessionInfo, type ShareOptions } from './manager.ts'
export { Room, RoomAgent, RoomError, agentColor, type AgentEditing } from './room.ts'
export { createLanApp } from './lan-app.ts'
export { collabRoutes, syncRoute } from './routes.ts'
export { createWebSocketServer } from './listen.ts'
