// Identidad del servidor MCP (compartida por el servidor HTTP y el puente stdio, sin dependencias).
export const MCP_SERVER_NAME = 'dbtracker'
export const MCP_SERVER_VERSION = '1.0.0'

export const MCP_INSTRUCTIONS =
  'DB Tracker: gestor visual de esquemas con versiones por flujo (rama). Trabajas sobre el MISMO documento compartido que ven las personas en la app, en tiempo real. ' +
  'Empieza con session_status (o session_open si no hay sesión). Las herramientas que modifican piden `agent`: usa siempre el mismo nombre visible para un mismo agente. ' +
  'Haz cada idea en su propio flujo (create_branch), edita con edit_schema o apply_normalization_fix y confirma con commit_version. Las ramas se pueden indicar por id o nombre.'
