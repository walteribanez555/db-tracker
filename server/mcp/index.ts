// Servidor MCP de DB Tracker. Contrato: docs/arquitectura/agentes-mcp.md
export { McpService, type McpInfo, type McpAgentInfo, type McpServiceOptions } from './service.ts'
export { createMcpServer, mcpApiRoutes, mcpHandler } from './server.ts'
export { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './meta.ts'
