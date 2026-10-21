// Anuncio y descubrimiento mDNS/Bonjour de sesiones (servicio "_dbtracker._tcp").
// Si la red no permite multicast, los errores se registran y la app sigue funcionando (unión por enlace/QR).
import Bonjour, { type Service } from 'bonjour-service'

import { MDNS_SERVICE_TYPE, type DiscoveredSession } from '../../src/collab/protocol.ts'

export interface AnnounceInfo {
  id: string
  code: string
  projectName: string
  hostName: string
  port: number
  participants: number
}

function txtOf(info: AnnounceInfo) {
  return {
    id: info.id,
    project: info.projectName.slice(0, 120),
    host: info.hostName.slice(0, 60),
    participants: String(info.participants),
  }
}

function onError(err: unknown) {
  console.warn(`[collab] mDNS no disponible: ${(err as Error)?.message ?? err}`)
}

/** Anuncio de la sesión propia. Se republica (con debounce) cuando cambia el número de participantes. */
export class Announcer {
  private bonjour: Bonjour | null = null
  private service: Service | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private last: AnnounceInfo

  constructor(info: AnnounceInfo) {
    this.last = info
    try {
      this.bonjour = new Bonjour({}, onError)
      this.publish(true)
    } catch (err) {
      onError(err)
      this.bonjour = null
    }
  }

  private publish(probe: boolean) {
    if (!this.bonjour) return
    try {
      this.service = this.bonjour.publish({
        // El código hace único el nombre en la red; el resto viaja en txt.
        name: `DB Tracker ${this.last.code}`,
        type: MDNS_SERVICE_TYPE,
        protocol: 'tcp',
        port: this.last.port,
        txt: txtOf(this.last),
        disableIPv6: true,
        probe,
      })
      this.service.on('error', onError)
    } catch (err) {
      onError(err)
    }
  }

  update(info: AnnounceInfo) {
    if (info.participants === this.last.participants && info.hostName === this.last.hostName) return
    this.last = info
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const old = this.service
      this.service = null
      if (!old) return this.publish(false)
      old.stop?.(() => this.publish(false))
    }, 2000)
  }

  /** Retira el anuncio (paquete "goodbye" con TTL 0) y libera el socket multicast. */
  stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const bonjour = this.bonjour
    this.bonjour = null
    this.service = null
    if (!bonjour) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        try {
          bonjour.destroy()
        } catch {
          /* ya destruido */
        }
        resolve()
      }
      const fallback = setTimeout(done, 1000)
      try {
        bonjour.unpublishAll(() => {
          clearTimeout(fallback)
          done()
        })
      } catch {
        clearTimeout(fallback)
        done()
      }
    })
  }
}

function pickAddress(service: Service): string | null {
  const v4 = (service.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
  if (v4) return v4
  return service.referer?.address ?? null
}

/** Busca sesiones en la red durante `timeoutMs` (por defecto 1,5 s). */
export function discoverSessions(excludeId: string | null, timeoutMs = 1500): Promise<DiscoveredSession[]> {
  return new Promise((resolve) => {
    let bonjour: Bonjour
    try {
      bonjour = new Bonjour({}, onError)
    } catch (err) {
      onError(err)
      resolve([])
      return
    }
    const found = new Map<string, DiscoveredSession>()
    const collect = (service: Service) => {
      const txt = (service.txt ?? {}) as Record<string, unknown>
      const id = typeof txt.id === 'string' ? txt.id : ''
      const address = pickAddress(service)
      if (!id || id === excludeId || !address) return
      found.set(id, {
        id,
        projectName: typeof txt.project === 'string' ? txt.project : service.name,
        hostName: typeof txt.host === 'string' ? txt.host : service.host,
        address,
        port: service.port,
        participants: Number(txt.participants) || 0,
      })
    }
    const browser = bonjour.find({ type: MDNS_SERVICE_TYPE, protocol: 'tcp' }, collect)
    browser.on('txt-update', (service) => collect(service))
    setTimeout(() => {
      try {
        browser.stop()
        bonjour.destroy()
      } catch {
        /* ignorar */
      }
      resolve([...found.values()])
    }, timeoutMs)
  })
}
