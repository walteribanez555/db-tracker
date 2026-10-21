// Arranque de servidores HTTP + WebSocket (@hono/node-server 2.x) con cierre limpio.
import type { Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

import { createAdaptorServer, type ServerType } from '@hono/node-server'
import { WebSocketServer } from 'ws'

type FetchFn = Parameters<typeof createAdaptorServer>[0]['fetch']

/** Límite de tamaño por mensaje WebSocket (un documento grande cabe de sobra). */
const MAX_WS_PAYLOAD = 64 * 1024 * 1024

/** Servidor WS sin servidor propio, para pasarlo a `serve({ websocket: { server } })`. */
export function createWebSocketServer() {
  return new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD })
}

export interface RunningServer {
  server: Server
  wss: WebSocketServer
  port: number
  /** Sockets "crudos" ajenos al servidor (p. ej. proxy del HMR de Vite) para cerrarlos al parar. */
  rawSockets: Set<Socket>
  close(): Promise<void>
}

function listenOnce(server: ServerType, port: number, hostname: string) {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, hostname)
  })
}

/**
 * Escucha en `hostname:port`. Con `fallback`, si el puerto está ocupado prueba los siguientes
 * (hasta `attempts`).
 */
export async function startServer(opts: {
  fetch: FetchFn
  hostname: string
  port: number
  fallback?: boolean
  attempts?: number
}): Promise<RunningServer> {
  const attempts = opts.fallback ? (opts.attempts ?? 20) : 1
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    const wss = createWebSocketServer()
    const server = createAdaptorServer({ fetch: opts.fetch, websocket: { server: wss } }) as Server
    try {
      const port = await listenOnce(server, opts.port + i, opts.hostname)
      const rawSockets = new Set<Socket>()
      return {
        server,
        wss,
        port,
        rawSockets,
        close: () => closeServer(server, wss, rawSockets),
      }
    } catch (err) {
      lastError = err
      wss.close()
      server.close()
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') break
    }
  }
  throw lastError
}

export function closeServer(server: Server, wss?: WebSocketServer, rawSockets?: Set<Socket>): Promise<void> {
  return new Promise((resolve) => {
    if (wss) for (const client of wss.clients) client.terminate()
    if (rawSockets) for (const socket of rawSockets) socket.destroy()
    const timer = setTimeout(resolve, 2000)
    server.close(() => {
      clearTimeout(timer)
      resolve()
    })
    server.closeAllConnections()
  })
}
