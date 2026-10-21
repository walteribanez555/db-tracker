// Gestor de la sesión de colaboración del proceso (una como máximo): crea la sala, abre el listener
// de red (0.0.0.0) con la app reducida, anuncia la sesión por mDNS y la cierra al parar.
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
  lan: RunningServer
  announcer: Announcer
  info: SessionInfo
}

export class CollabManager {
  private active: ActiveSession | null = null
  /** Serializa share/stop para que dos peticiones simultáneas no abran dos listeners. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly options: CollabManagerOptions) {}

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

  status(): { session: SessionInfo | null; participants: Participant[] } {
    if (!this.active) return { session: null, participants: [] }
    return { session: this.sessionInfo(), participants: this.active.room.participants() }
  }

  private sessionInfo(): SessionInfo {
    const { room, info } = this.active!
    return { ...info, hostName: room.hostName, autoApprove: room.autoApprove, shareRemoteApis: room.shareRemoteApis }
  }

  publicInfo(code: string): PublicSessionInfo | null {
    const room = this.active?.room
    if (!room || room.code !== code.trim().toUpperCase()) return null
    return room.publicInfo()
  }

  share(req: ShareRequest): Promise<SessionInfo> {
    return this.serial(async () => {
      const hostName = req.hostName.trim() || this.options.hostName
      if (this.active) {
        const { room } = this.active
        if (room.projectName !== req.projectName) {
          throw new CollabError(`Ya se está compartiendo «${room.projectName}». Deja de compartir antes de compartir otro proyecto.`, 409)
        }
        // Mismo proyecto: se actualizan las opciones en caliente.
        room.update({ autoApprove: req.autoApprove, shareRemoteApis: req.shareRemoteApis, hostName })
        this.announce()
        return this.sessionInfo()
      }

      const room = new Room(CODE_ALPHABET, {
        projectName: req.projectName,
        hostName,
        autoApprove: req.autoApprove ?? false,
        shareRemoteApis: req.shareRemoteApis ?? false,
        dataDir: this.options.dataDir,
        onParticipantsChange: () => this.announce(),
      })
      const restored = await room.load()

      let lan: RunningServer
      try {
        lan = await startServer({
          fetch: createLanApp(this).fetch,
          hostname: '0.0.0.0',
          port: req.port ?? DEFAULT_SHARE_PORT,
          fallback: req.port === undefined,
        })
      } catch (err) {
        await room.end()
        const code = (err as NodeJS.ErrnoException).code
        throw new CollabError(
          code === 'EADDRINUSE'
            ? `El puerto ${req.port ?? DEFAULT_SHARE_PORT} está ocupado.`
            : `No se pudo abrir el listener de red: ${(err as Error).message}`,
          code === 'EADDRINUSE' ? 409 : 500,
        )
      }
      if (!this.options.staticDir) attachDevUpgradeProxy(lan, this.devServerUrl)

      const addresses = getLanAddresses()
      const joinUrl = `http://${addresses[0] ?? '127.0.0.1'}:${lan.port}/unirse?sala=${room.code}#s=${room.secret}`
      const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })

      const info: SessionInfo = {
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
      const announcer = new Announcer({
        id: room.id,
        code: room.code,
        projectName: room.projectName,
        hostName,
        port: lan.port,
        participants: 0,
      })
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
    if (!a) return
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
      await Promise.all([a.lan.close(), a.announcer.stop()])
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
