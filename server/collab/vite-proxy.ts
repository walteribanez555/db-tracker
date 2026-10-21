// Solo desarrollo: el listener de red reenvía a Vite (http://localhost:5173) lo que no es API ni /sync,
// para poder abrir la app desde otro dispositivo sin compilar. El HMR por red se intenta reenviar
// (WebSocket crudo hacia Vite), pero puede no funcionar según la versión/configuración de Vite;
// en ese caso basta con recargar la página.
import net from 'node:net'

import type { Context } from 'hono'

import type { RunningServer } from './listen.ts'

/** Rutas que NUNCA se reenvían a Vite: Vite las mandaría al listener local (127.0.0.1) por su proxy. */
function isReservedPath(rawPath: string) {
  let decoded = rawPath
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return true
  }
  const normalized = decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return [rawPath, normalized].some((p) => p.startsWith('/api') || p.startsWith('/sync'))
}

const SKIP_REQUEST_HEADERS = new Set(['host', 'origin', 'referer', 'connection', 'upgrade', 'accept-encoding', 'cookie'])
const SKIP_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']

export async function proxyToVite(c: Context, devServerUrl: string) {
  if (c.req.header('upgrade')) return c.body(null, 404)
  const method = c.req.method
  if (method !== 'GET' && method !== 'HEAD') return c.text('Método no permitido.', 405)
  const url = new URL(c.req.url)
  if (isReservedPath(url.pathname)) return c.json({ ok: false, error: 'No encontrado.' }, 404)

  const headers = new Headers()
  for (const [key, value] of c.req.raw.headers) if (!SKIP_REQUEST_HEADERS.has(key)) headers.set(key, value)
  headers.set('accept-encoding', 'identity')
  try {
    const res = await fetch(new URL(url.pathname + url.search, devServerUrl), { method, headers, redirect: 'manual' })
    const out = new Headers(res.headers)
    for (const h of SKIP_RESPONSE_HEADERS) out.delete(h)
    return new Response(method === 'HEAD' ? null : res.body, { status: res.status, headers: out })
  } catch {
    return c.text('No se pudo contactar con Vite. ¿Está arrancado `npm run dev`?', 502)
  }
}

/**
 * Reenvía a Vite las peticiones de upgrade que no son /sync/:id (el WebSocket del HMR).
 * /sync/:id lo atiende @hono/node-server; cualquier otra ruta /api o /sync se corta.
 */
export function attachDevUpgradeProxy(lan: RunningServer, devServerUrl: string) {
  const target = new URL(devServerUrl)
  lan.server.on('upgrade', (req, socket: net.Socket, head: Buffer) => {
    const rawUrl = req.url ?? '/'
    const pathname = rawUrl.split('?')[0]
    if (/^\/sync\/[^/]+$/.test(pathname)) return
    if (isReservedPath(pathname)) {
      socket.destroy()
      return
    }
    const upstream = net.connect({ host: target.hostname, port: Number(target.port || 80) })
    lan.rawSockets.add(socket)
    lan.rawSockets.add(upstream)
    const cleanup = () => {
      socket.destroy()
      upstream.destroy()
      lan.rawSockets.delete(socket)
      lan.rawSockets.delete(upstream)
    }
    socket.on('error', cleanup)
    socket.on('close', cleanup)
    upstream.on('error', cleanup)
    upstream.on('close', cleanup)
    upstream.on('connect', () => {
      const lines = [`${req.method} ${rawUrl} HTTP/${req.httpVersion}`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i]
        const lower = name.toLowerCase()
        if (lower === 'host' || lower === 'origin') continue
        lines.push(`${name}: ${req.rawHeaders[i + 1]}`)
      }
      lines.push(`Host: ${target.host}`)
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
  })
}
