// Utilidades de red del anfitrión: IPs de la LAN, detección de loopback y slugs de archivo.
import os from 'node:os'

import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

/** Interfaces virtuales que casi nunca son la red local "real" (Docker, VPN, máquinas virtuales). */
const VIRTUAL_IFACE = /^(docker|br-|veth|vmnet|vboxnet|virbr|utun|tun|tap|bridge|awdl|llw|zt|tailscale|wg)/i

function isPrivateIPv4(ip: string) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
}

/**
 * IPv4 no internas del equipo, de más a menos probable como "dirección de la LAN":
 * primero privadas en interfaces físicas, después el resto. Se excluyen las de enlace local (169.254.x.x).
 */
export function getLanAddresses(): string[] {
  const found: { ip: string; score: number }[] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      if (info.address.startsWith('169.254.')) continue
      let score = 0
      if (VIRTUAL_IFACE.test(name)) score += 2
      if (!isPrivateIPv4(info.address)) score += 1
      found.push({ ip: info.address, score })
    }
  }
  found.sort((a, b) => a.score - b.score)
  return [...new Set(found.map((f) => f.ip))]
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLoopbackAddress(address: string | undefined) {
  return !!address && (LOOPBACK_ADDRESSES.has(address) || address.startsWith('127.'))
}

function hostnameOf(value: string) {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname
  } catch {
    return ''
  }
}

/**
 * Comprobación de defensa en profundidad para las rutas "solo loopback" del listener local:
 * - el socket TCP viene de 127.0.0.1/::1 (no falsificable, a diferencia de X-Forwarded-For);
 * - la cabecera Host es localhost/127.0.0.1 (evita DNS rebinding);
 * - si hay Origin, también es local (evita que una web cualquiera abierta en el navegador del
 *   anfitrión dispare acciones contra la API local).
 * La decisión principal es por listener: el listener de red nunca monta estas rutas como locales.
 */
export function isTrustedLocalRequest(c: Context) {
  let remote: string | undefined
  try {
    remote = getConnInfo(c).remote.address
  } catch {
    return false
  }
  if (!isLoopbackAddress(remote)) return false
  const host = c.req.header('host')
  if (host && !LOOPBACK_HOSTS.has(hostnameOf(host))) return false
  const origin = c.req.header('origin')
  if (origin && origin !== 'null' && !LOOPBACK_HOSTS.has(hostnameOf(origin))) return false
  if (origin === 'null') return false
  return true
}

/** Nombre de archivo seguro a partir del nombre del proyecto. */
export function slugify(value: string) {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'proyecto'
}
