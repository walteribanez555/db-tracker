// Gestor de la sesión de colaboración del proceso (una como máximo): crea la sala, abre el listener
// de red (0.0.0.0) con la app reducida, anuncia la sesión por mDNS y la cierra al parar.
// Con network 'local' (agentes MCP) no hay listener de red ni anuncio: solo el listener local del proceso.
import QRCode from 'qrcode'

import {
  CODE_ALPHABET,
  DEFAULT_SHARE_PORT,
  type DiscoveredSession,
  type Participant,
  type ParticipantAction,
  type PublicSessionInfo,
  type SessionInfo,
  type ShareRequest,
} from '../../src/collab/protocol.ts'
import { createLanApp } from './lan-app.ts'
import { startServer, type RunningServer } from './listen.ts'
import { Announcer, discoverSessions } from './mdns.ts'
import { getLanAddresses } from './network.ts'
import { CLOSE, Room, RoomError, type ConnectionMeta, type SocketHandle, type SocketLike } from './room.ts'
import { attachDevUpgradeProxy } from './vite-proxy.ts'

export interface CollabManagerOptions {
  /** Carpeta de datos: userData en Electron, `.dbtracker-data/` en web. Las salas van en `<dataDir>/salas`. */
  dataDir: string
  /** Nombre del anfitrión por defecto (si ShareRequest.hostName viene vacío). */
  hostName: string
  /** Frontend compilado (dist). Si falta, el listener de red hace proxy a Vite (`devServerUrl`). */
  staticDir?: string
  /** Servidor de Vite en desarrollo (por defecto http://localhost:5173). */
  devServerUrl?: string
}

export class CollabError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

interface ActiveSession {
  room: Room
  /** null en sesiones 'local'. */
  lan: RunningServer | null
  announcer: Announcer | null
  info: SessionInfo
}

/** Nombre provisional de la sala que abre un agente sin conocer el proyecto (se sustituye al sembrar). */
export const PROVISIONAL_PROJECT_NAME = 'Proyecto de DB Tracker'

/** SessionInfo + ajustes de agentes (campos extra, opcionales para los clientes). */
export type HostSessionInfo = SessionInfo & {
  /** Los agentes MCP entran sin aprobación manual. */
  autoApproveAgents: boolean
  /** true si la sala la abrió un agente sin conocer el nombre del proyecto (la app la renombra al unirse). */
  provisional?: boolean
}

export interface ShareOptions extends ShareRequest {
  /** El nombre del proyecto es provisional (lo abre un agente MCP). */
  provisionalName?: boolean
}

export class CollabManager {
  private active: ActiveSession | null = null
  /** Serializa share/stop para que dos peticiones simultáneas no abran dos listeners. */
  private queue: Promise<unknown> = Promise.resolve()
  /** URL del listener local (http://127.0.0.1:PUERTO); la fija quien arranca el servidor. */
  private localUrl = ''

  constructor(readonly options: CollabManagerOptions) {}

  /** URL del listener local: se usa en el joinUrl de las sesiones 'local'. */
  setLocalUrl(url: string) {
    this.localUrl = url.replace(/\/+$/, '')
  }

  get room(): Room | null {
    return this.active?.room ?? null
  }

  /** true si los invitados pueden usar /api/db y /api/github del anfitrión (lo consulta el listener de red). */
  get remoteApisShared() {
    return this.active?.room.shareRemoteApis ?? false
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  status(): { session: HostSessionInfo | null; participants: Participant[] } {
    if (!this.active) return { session: null, participants: [] }
    return { session: this.sessionInfo(), participants: this.active.room.participants() }
  }

  private sessionInfo(): HostSessionInfo {
    const { room, info } = this.active!
    return {
      ...info,
      projectName: room.projectName,
      hostName: room.hostName,
      autoApprove: room.autoApprove,
      shareRemoteApis: room.shareRemoteApis,
      autoApproveAgents: room.autoApproveAgents,
      ...(room.provisionalName ? { provisional: true } : {}),
    }
  }

  /** Enlace de unión por el listener local (sesiones 'local'): la app lo usa para unirse como anfitriona. */
  private localJoinUrl(room: Room) {
    return `${this.localUrl || 'http://127.0.0.1'}/unirse?sala=${room.code}#s=${room.secret}`
  }

  /** Abre el listener de red + mDNS de una sala. */
  private async openLan(room: Room, port: number | undefined) {
    let lan: RunningServer
    try {
      lan = await startServer({
        fetch: createLanApp(this).fetch,
        hostname: '0.0.0.0',
        port: port ?? DEFAULT_SHARE_PORT,
        fallback: port === undefined,
      })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      throw new CollabError(
        code === 'EADDRINUSE'
          ? `El puerto ${port ?? DEFAULT_SHARE_PORT} está ocupado.`
          : `No se pudo abrir el listener de red: ${(err as Error).message}`,
        code === 'EADDRINUSE' ? 409 : 500,
      )
    }
    if (!this.options.staticDir) attachDevUpgradeProxy(lan, this.devServerUrl)
    const addresses = getLanAddresses()
    const joinUrl = `http://${addresses[0] ?? '127.0.0.1'}:${lan.port}/unirse?sala=${room.code}#s=${room.secret}`
    const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    const announcer = new Announcer({
      id: room.id,
      code: room.code,
      projectName: room.projectName,
      hostName: room.hostName,
      port: lan.port,
      participants: room.activeCount(),
    })
    return { lan, announcer, addresses, joinUrl, qrSvg }
  }

  publicInfo(code: string): PublicSessionInfo | null {
    const room = this.active?.room
    if (!room || room.code !== code.trim().toUpperCase()) return null
    return room.publicInfo()
  }

  share(req: ShareOptions): Promise<HostSessionInfo> {
    return this.serial(async () => {
      const hostName = req.hostName.trim() || this.options.hostName
      const network = req.network ?? 'lan'
      if (this.active) {
        const a = this.active
        const { room } = a
        if (room.projectName !== req.projectName) {
          // Sala abierta por un agente con nombre provisional: adopta el nombre real del proyecto de la app.
          if (room.provisionalName && !req.provisionalName) room.rename(req.projectName)
          else if (!req.provisionalName) {
            throw new CollabError(`Ya se está compartiendo «${room.projectName}». Deja de compartir antes de compartir otro proyecto.`, 409)
          }
        }
        // Mismo proyecto: se actualizan las opciones en caliente.
        room.update({
          autoApprove: req.autoApprove,
          autoApproveAgents: req.autoApproveAgents,
          shareRemoteApis: req.shareRemoteApis,
          hostName: req.hostName.trim() ? hostName : undefined,
        })
        // Sin `network` explícito no se cambia el modo (un /share repetido nunca abre la red por sorpresa).
        if (req.network === 'lan' && !a.lan) {
          // local → lan: se abre el listener de red sin cerrar la sala (agentes y anfitrión siguen conectados).
          const opened = await this.openLan(room, req.port)
          a.lan = opened.lan
          a.announcer = opened.announcer
          a.info = { ...a.info, network: 'lan', port: opened.lan.port, addresses: opened.addresses, joinUrl: opened.joinUrl, qrSvg: opened.qrSvg }
          console.log(`[collab] «${room.projectName}» ahora también se comparte en la red local (puerto ${opened.lan.port}).`)
        } else if (req.network === 'local' && a.lan) {
          // lan → local: se cierra el listener de red (los invitados de la red salen) y se retira el anuncio.
          const { lan, announcer } = a
          a.lan = null
          a.announcer = null
          a.info = { ...a.info, network: 'local', port: 0, addresses: [], joinUrl: this.localJoinUrl(room), qrSvg: '' }
          await Promise.all([lan.close(), announcer?.stop()])
          console.log(`[collab] «${room.projectName}» ya no se comparte en la red (sigue la sesión local).`)
        }
        this.announce()
        return this.sessionInfo()
      }

      const room = new Room(CODE_ALPHABET, {
        projectName: req.projectName,
        provisionalName: req.provisionalName,
        hostName,
        autoApprove: req.autoApprove ?? false,
        autoApproveAgents: req.autoApproveAgents ?? network === 'local',
        shareRemoteApis: req.shareRemoteApis ?? false,
        dataDir: this.options.dataDir,
        onParticipantsChange: () => this.announce(),
      })
      // Una sala provisional no recupera nada de disco: el proyecto llega de la app al sembrar.
      const restored = req.provisionalName ? false : await room.load()

      if (network === 'local') {
        const info: SessionInfo = {
          network: 'local',
          id: room.id,
          code: room.code,
          projectName: room.projectName,
          hostName,
          port: 0,
          addresses: [],
          joinUrl: this.localJoinUrl(room),
          qrSvg: '',
          autoApprove: room.autoApprove,
          shareRemoteApis: room.shareRemoteApis,
          startedAt: room.startedAt,
        }
        this.active = { room, lan: null, announcer: null, info }
        console.log(`[collab] Sesión local para agentes «${room.projectName}» (sin red${restored ? ', documento recuperado de disco' : ''}).`)
        return this.sessionInfo()
      }

      let opened: Awaited<ReturnType<CollabManager['openLan']>>
      try {
        opened = await this.openLan(room, req.port)
      } catch (err) {
        await room.end()
        throw err
      }
      const { lan, announcer, addresses, joinUrl, qrSvg } = opened
      const info: SessionInfo = {
        network: 'lan',
        id: room.id,
        code: room.code,
        projectName: room.projectName,
        hostName,
        port: lan.port,
        addresses,
        joinUrl,
        qrSvg,
        autoApprove: room.autoApprove,
        shareRemoteApis: room.shareRemoteApis,
        startedAt: room.startedAt,
      }
      this.active = { room, lan, announcer, info }
      console.log(
        `[collab] Compartiendo «${room.projectName}» en ${addresses.map((a) => `${a}:${lan.port}`).join(', ') || `0.0.0.0:${lan.port}`}` +
          ` (código ${room.code}${restored ? ', documento recuperado de disco' : ''})`,
      )
      return this.sessionInfo()
    })
  }

  private announce() {
    const a = this.active
    if (!a?.announcer || !a.lan) return
    a.announcer.update({
      id: a.room.id,
      code: a.room.code,
      projectName: a.room.projectName,
      hostName: a.room.hostName,
      port: a.lan.port,
      participants: a.room.activeCount(),
    })
  }

  get devServerUrl() {
    return this.options.devServerUrl ?? 'http://localhost:5173'
  }

  /** Cierra la sesión: {t:'ended'} a todos, guarda el documento, cierra el listener y retira el anuncio. */
  stop(): Promise<void> {
    return this.serial(async () => {
      const a = this.active
      if (!a) return
      this.active = null
      await a.room.end()
      await Promise.all([a.lan?.close(), a.announcer?.stop()])
      console.log('[collab] Se ha dejado de compartir.')
    })
  }

  act(participantId: string, action: ParticipantAction) {
    const room = this.active?.room
    if (!room) throw new CollabError('No hay ninguna sesión activa.', 404)
    try {
      room.act(participantId, action)
    } catch (err) {
      if (err instanceof RoomError) throw new CollabError(err.message, err.status)
      throw err
    }
  }

  discover(): Promise<DiscoveredSession[]> {
    return discoverSessions(this.active?.room.id ?? null)
  }

  /** Conecta un WebSocket a /sync/:sessionId. Si la sesión no existe, se rechaza. */
  attachSocket(sessionId: string, socket: SocketLike, meta: ConnectionMeta): SocketHandle | null {
    const room = this.active?.room
    if (!room || room.id !== sessionId) {
      if (socket.isOpen) socket.send(JSON.stringify({ t: 'rejected', reason: 'La sesión no existe o ya ha terminado.' }))
      socket.close(CLOSE.policy)
      return null
    }
    return room.attach(socket, meta)
  }
}
