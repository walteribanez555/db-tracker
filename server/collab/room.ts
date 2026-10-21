// Sala de colaboración: un Y.Doc por sesión, relay de y-protocols (sync + awareness), control de
// acceso (hello/secret, aprobación, roles) y persistencia en disco.
// El relay sigue el estilo de y-websocket/bin/utils: el servidor guarda el documento y difunde los
// updates; frames BINARIOS = varUint(tipo) + payload, frames de TEXTO = control JSON (ControlMessage).
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'

import {
  AWARENESS_MESSAGE,
  SYNC_MESSAGE,
  type ClientKind,
  type CollabRole,
  type ControlMessage,
  type Participant,
  type ParticipantAction,
  type PublicSessionInfo,
} from '../../src/collab/protocol.ts'
import { slugify } from './network.ts'

/** Transporte mínimo que la sala necesita de un WebSocket (lo adapta server/collab/routes.ts). */
export interface SocketLike {
  send(data: string | Uint8Array): void
  close(code?: number, reason?: string): void
  readonly isOpen: boolean
}

export interface ConnectionMeta {
  /** Listener por el que llegó la conexión. Solo 'local' + loopback puede ser owner. */
  listener: 'local' | 'lan'
  /** true si llegó por el listener local, desde loopback y con Origin/Host locales. */
  trustedLocal: boolean
  address: string
}

/** Lo que el adaptador del WebSocket llama al recibir mensajes o al cerrarse. */
export interface SocketHandle {
  message(data: string | ArrayBuffer | Uint8Array): void
  close(): void
}

/** Códigos de cierre del WebSocket (el motivo real viaja antes en un frame de control). */
export const CLOSE = {
  normal: 1000,
  ended: 1001,
  policy: 1008,
  error: 1011,
} as const

const HELLO_TIMEOUT_MS = 10_000
const PERSIST_DELAY_MS = 5_000
const MAX_PENDING = 30
const MAX_FAILURES_PER_MINUTE = 20
const DEFAULT_ROLE: Exclude<CollabRole, 'owner'> = 'editor'
const FALLBACK_COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626']

interface Conn {
  socket: SocketLike
  meta: ConnectionMeta
  phase: 'hello' | 'pending' | 'active' | 'closed'
  participant: Participant | null
  clientId: string | null
  /** clientIDs de Yjs cuyo awareness controla esta conexión (para limpiarlos al desconectar). */
  awarenessIds: Set<number>
  helloTimer: ReturnType<typeof setTimeout> | null
  /** Entró con el código de sala en lugar del secreto largo: siempre requiere aprobación. */
  byCode: boolean
}

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
  }
}

export interface RoomOptions {
  projectName: string
  hostName: string
  autoApprove: boolean
  shareRemoteApis: boolean
  dataDir: string
  /** Se llama cada vez que cambia la lista de participantes (para el anuncio mDNS). */
  onParticipantsChange?: () => void
}

function randomCode(alphabet: string, length = 6) {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function str(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export class Room {
  readonly id = randomUUID()
  readonly code: string
  readonly secret = randomBytes(32).toString('base64url')
  readonly startedAt = new Date().toISOString()
  readonly projectName: string
  hostName: string
  autoApprove: boolean
  shareRemoteApis: boolean

  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)

  private readonly conns = new Set<Conn>()
  /** clientId → rol de invitados ya aprobados (reconexión sin volver a pedir permiso). */
  private readonly approved = new Map<string, Exclude<CollabRole, 'owner'>>()
  /** clientId expulsados: no pueden volver a entrar en esta sesión. */
  private readonly blocked = new Set<string>()
  private readonly failures = new Map<string, { count: number; resetAt: number }>()
  private readonly file: string
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private ended = false
  private colorIndex = 0

  constructor(
    alphabet: string,
    private readonly options: RoomOptions,
  ) {
    this.code = randomCode(alphabet)
    this.projectName = options.projectName
    this.hostName = options.hostName
    this.autoApprove = options.autoApprove
    this.shareRemoteApis = options.shareRemoteApis
    this.file = path.join(options.dataDir, 'salas', `${slugify(options.projectName)}.ydoc`)

    // El servidor no publica presencia propia.
    this.awareness.setLocalState(null)

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, SYNC_MESSAGE)
      syncProtocol.writeUpdate(encoder, update)
      const message = encoding.toUint8Array(encoder)
      for (const conn of this.conns) if (conn.phase === 'active' && conn !== origin) this.sendBinary(conn, message)
      this.schedulePersist()
    })

    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = [...added, ...updated, ...removed]
        if (origin && typeof origin === 'object' && this.conns.has(origin as Conn)) {
          const conn = origin as Conn
          for (const id of added) conn.awarenessIds.add(id)
          for (const id of removed) conn.awarenessIds.delete(id)
        }
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, AWARENESS_MESSAGE)
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
        const message = encoding.toUint8Array(encoder)
        for (const conn of this.conns) if (conn.phase === 'active') this.sendBinary(conn, message)
      },
    )
  }

  /* ───────────────────────── Persistencia ───────────────────────── */

  /** Recarga la copia en disco del mismo proyecto (si existe). */
  async load() {
    let data: Buffer
    try {
      data = await readFile(this.file)
    } catch {
      return false
    }
    try {
      Y.applyUpdate(this.doc, new Uint8Array(data), 'disk')
      this.dirty = false
      return true
    } catch (err) {
      console.warn(`[collab] No se pudo leer ${this.file}: ${(err as Error).message}`)
      return false
    }
  }

  private schedulePersist() {
    this.dirty = true
    if (this.persistTimer || this.ended) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persist()
    }, PERSIST_DELAY_MS)
  }

  async persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.dirty) return
    this.dirty = false
    try {
      await mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, Y.encodeStateAsUpdate(this.doc))
      await rename(tmp, this.file)
    } catch (err) {
      this.dirty = true
      console.error(`[collab] No se pudo guardar la sala: ${(err as Error).message}`)
    }
  }

  /* ───────────────────────── Información ───────────────────────── */

  get persistPath() {
    return this.file
  }

  activeCount() {
    let n = 0
    for (const conn of this.conns) if (conn.phase === 'active') n++
    return n
  }

  publicInfo(): PublicSessionInfo {
    return {
      id: this.id,
      code: this.code,
      projectName: this.projectName,
      hostName: this.hostName,
      participants: this.activeCount(),
      needsApproval: !this.autoApprove,
    }
  }

  /** Lista completa (pendientes incluidos, con IP) para el anfitrión. */
  participants(): Participant[] {
    const list: Participant[] = []
    for (const conn of this.conns) {
      if (conn.participant && (conn.phase === 'active' || conn.phase === 'pending')) list.push({ ...conn.participant })
    }
    return list
  }

  /* ───────────────────────── Conexiones ───────────────────────── */

  attach(socket: SocketLike, meta: ConnectionMeta): SocketHandle {
    const conn: Conn = {
      socket,
      meta,
      phase: 'hello',
      participant: null,
      clientId: null,
      awarenessIds: new Set(),
      helloTimer: null,
      byCode: false,
    }
    this.conns.add(conn)
    conn.helloTimer = setTimeout(() => {
      if (conn.phase === 'hello') this.refuse(conn, 'No se recibió el saludo a tiempo.')
    }, HELLO_TIMEOUT_MS)

    return {
      message: (data) => {
        try {
          if (typeof data === 'string') this.onText(conn, data)
          else this.onBinary(conn, data instanceof Uint8Array ? data : new Uint8Array(data))
        } catch (err) {
          console.warn(`[collab] Mensaje no válido de ${meta.address}: ${(err as Error).message}`)
          this.sendControl(conn, { t: 'error', message: 'Mensaje no válido.' })
          this.drop(conn, CLOSE.error)
        }
      },
      close: () => this.detach(conn),
    }
  }

  private onText(conn: Conn, text: string) {
    let msg: { t?: unknown } & Record<string, unknown>
    try {
      msg = JSON.parse(text)
    } catch {
      this.sendControl(conn, { t: 'error', message: 'El mensaje de control no es JSON válido.' })
      return
    }
    if (conn.phase === 'hello') {
      if (msg?.t !== 'hello') {
        this.refuse(conn, 'El primer mensaje debe ser el saludo (hello).')
        return
      }
      this.onHello(conn, msg)
      return
    }
    // No hay más mensajes de control cliente → servidor en el contrato; se ignoran.
  }

  private onHello(conn: Conn, msg: Record<string, unknown>) {
    if (conn.helloTimer) clearTimeout(conn.helloTimer)
    conn.helloTimer = null

    if (this.tooManyFailures(conn.meta.address)) {
      this.refuse(conn, 'Demasiados intentos fallidos. Espera un minuto e inténtalo de nuevo.')
      return
    }
    const secret = typeof msg.secret === 'string' ? msg.secret : ''
    const auth = this.authenticate(secret)
    if (auth === 'code-not-allowed') {
      this.refuse(conn, 'Esta sesión requiere el enlace o el QR')
      return
    }
    if (!auth) {
      this.registerFailure(conn.meta.address)
      this.refuse(conn, 'El código o el enlace de la sesión no es válido.')
      return
    }
    // Con el código de sala (sin secreto largo) siempre se pasa por la aprobación del anfitrión.
    const byCode = auth === 'code'
    conn.byCode = byCode

    const clientId = str(msg.clientId, 128) || randomUUID()
    if (this.blocked.has(clientId) && !conn.meta.trustedLocal) {
      this.refuse(conn, 'El anfitrión te ha expulsado de esta sesión.')
      return
    }

    const kind: ClientKind = msg.kind === 'desktop' || msg.kind === 'mobile' ? msg.kind : 'web'
    const color =
      typeof msg.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(msg.color)
        ? msg.color
        : FALLBACK_COLORS[this.colorIndex++ % FALLBACK_COLORS.length]
    // owner: listener local + loopback + secreto largo (el código nunca da owner).
    const owner = conn.meta.trustedLocal && !byCode
    const remembered = this.approved.get(clientId)
    const role: CollabRole = owner ? 'owner' : (remembered ?? DEFAULT_ROLE)

    conn.clientId = clientId
    conn.participant = {
      id: `p_${randomBytes(6).toString('base64url')}`,
      name: str(msg.name, 60) || (owner ? this.hostName : 'Invitado'),
      color,
      kind,
      role,
      status: 'pending',
      address: conn.meta.address,
      joinedAt: new Date().toISOString(),
    }

    if (owner || (!byCode && (remembered || this.autoApprove))) {
      this.activate(conn)
      return
    }

    let pending = 0
    for (const c of this.conns) if (c.phase === 'pending') pending++
    if (pending >= MAX_PENDING) {
      this.refuse(conn, 'Hay demasiadas solicitudes pendientes. Inténtalo más tarde.')
      return
    }
    conn.phase = 'pending'
    this.sendControl(conn, { t: 'pending' })
    this.participantsChanged()
  }

  /**
   * 'secret' si coincide el secreto largo; 'code' si coincide el código de sala (sin distinguir
   * mayúsculas e ignorando guiones/espacios) y la sesión NO aprueba automáticamente.
   */
  private authenticate(secret: string): 'secret' | 'code' | 'code-not-allowed' | null {
    if (!secret) return null
    if (safeEqual(secret, this.secret)) return 'secret'
    const normalized = secret.replace(/[\s-]+/g, '').toUpperCase()
    if (normalized.length === this.code.length && safeEqual(normalized, this.code)) {
      return this.autoApprove ? 'code-not-allowed' : 'code'
    }
    return null
  }

  /** Límite de intentos fallidos por IP: el código tiene poca entropía y no se debe poder adivinar a fuerza bruta. */
  private tooManyFailures(address: string) {
    const entry = this.failures.get(address)
    if (!entry) return false
    if (Date.now() > entry.resetAt) {
      this.failures.delete(address)
      return false
    }
    return entry.count >= MAX_FAILURES_PER_MINUTE
  }

  private registerFailure(address: string) {
    const now = Date.now()
    const entry = this.failures.get(address)
    if (!entry || now > entry.resetAt) this.failures.set(address, { count: 1, resetAt: now + 60_000 })
    else entry.count++
  }

  private activate(conn: Conn) {
    if (!conn.participant) return
    conn.phase = 'active'
    conn.participant.status = 'active'
    if (conn.participant.role !== 'owner' && conn.clientId) this.approved.set(conn.clientId, conn.participant.role)

    this.sendControl(conn, {
      t: 'welcome',
      participantId: conn.participant.id,
      role: conn.participant.role,
      session: this.publicInfo(),
    })

    // Paso 1 de la sincronización: el servidor envía su vector de estado; el cliente responde con
    // el paso 2 (lo que falta en el servidor) y su propio paso 1.
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, SYNC_MESSAGE)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    this.sendBinary(conn, encoding.toUint8Array(encoder))

    const states = this.awareness.getStates()
    if (states.size > 0) {
      const aw = encoding.createEncoder()
      encoding.writeVarUint(aw, AWARENESS_MESSAGE)
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]))
      this.sendBinary(conn, encoding.toUint8Array(aw))
    }
    this.participantsChanged()
  }

  private onBinary(conn: Conn, data: Uint8Array) {
    // Hasta el welcome se ignoran los binarios.
    if (conn.phase !== 'active' || !conn.participant) return
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    switch (type) {
      case SYNC_MESSAGE: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, SYNC_MESSAGE)
        const syncType = decoding.readVarUint(decoder)
        if (syncType === syncProtocol.messageYjsSyncStep1) {
          syncProtocol.readSyncStep1(decoder, encoder, this.doc)
        } else if (syncType === syncProtocol.messageYjsSyncStep2 || syncType === syncProtocol.messageYjsUpdate) {
          // Los lectores no pueden modificar el documento: se descartan sus cambios.
          if (conn.participant.role === 'viewer') return
          syncProtocol.readUpdate(decoder, this.doc, conn)
        } else {
          throw new Error(`Tipo de mensaje sync desconocido: ${syncType}`)
        }
        if (encoding.length(encoder) > 1) this.sendBinary(conn, encoding.toUint8Array(encoder))
        break
      }
      case AWARENESS_MESSAGE:
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn)
        break
      default:
        // Tipos desconocidos (p. ej. auth/queryAwareness de y-websocket): se ignoran.
        break
    }
  }

  private detach(conn: Conn) {
    if (!this.conns.has(conn)) return
    const wasVisible = conn.phase === 'active' || conn.phase === 'pending'
    conn.phase = 'closed'
    if (conn.helloTimer) clearTimeout(conn.helloTimer)
    this.conns.delete(conn)
    if (conn.awarenessIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.awarenessIds], null)
    }
    if (wasVisible) this.participantsChanged()
  }

  /** Envía {t:'rejected'} y cierra. */
  private refuse(conn: Conn, reason: string) {
    this.sendControl(conn, { t: 'rejected', reason })
    this.drop(conn, CLOSE.policy)
  }

  private drop(conn: Conn, code: number) {
    try {
      conn.socket.close(code)
    } catch {
      /* ya cerrado */
    }
    this.detach(conn)
  }

  private sendControl(conn: Conn, msg: ControlMessage) {
    if (conn.socket.isOpen) conn.socket.send(JSON.stringify(msg))
  }

  private sendBinary(conn: Conn, data: Uint8Array) {
    if (!conn.socket.isOpen) {
      this.detach(conn)
      return
    }
    conn.socket.send(data)
  }

  /** Difunde {t:'participants'}: el anfitrión ve pendientes e IPs; los invitados, solo activos sin IP. */
  private participantsChanged() {
    const full = this.participants()
    const visible = full.filter((p) => p.status === 'active').map(({ address: _address, ...rest }) => rest)
    for (const conn of this.conns) {
      if (conn.phase !== 'active' || !conn.participant) continue
      const list = conn.participant.role === 'owner' ? full : visible
      this.sendControl(conn, { t: 'participants', list })
    }
    this.options.onParticipantsChange?.()
  }

  /* ───────────────────────── Acciones del anfitrión ───────────────────────── */

  private findConn(participantId: string) {
    for (const conn of this.conns) if (conn.participant?.id === participantId && conn.phase !== 'closed') return conn
    return null
  }

  act(participantId: string, action: ParticipantAction) {
    const conn = this.findConn(participantId)
    if (!conn || !conn.participant || conn.phase === 'hello') throw new RoomError('El participante no existe o ya se ha desconectado.', 404)
    if (conn.participant.role === 'owner') throw new RoomError('No se puede cambiar ni expulsar al anfitrión.', 400)

    switch (action.action) {
      case 'approve':
        if (action.role) conn.participant.role = action.role
        if (conn.phase === 'pending') this.activate(conn)
        return
      case 'reject':
        if (conn.phase !== 'pending') throw new RoomError('Solo se pueden rechazar solicitudes pendientes. Usa «Expulsar».', 409)
        this.refuse(conn, 'El anfitrión ha rechazado tu solicitud.')
        return
      case 'kick':
        if (conn.clientId) {
          this.blocked.add(conn.clientId)
          this.approved.delete(conn.clientId)
        }
        this.sendControl(conn, { t: 'kicked' })
        this.drop(conn, CLOSE.policy)
        return
      case 'set-role': {
        const role = action.role
        if (role !== 'editor' && role !== 'viewer') throw new RoomError('Rol no válido.', 400)
        conn.participant.role = role
        if (conn.phase === 'active') {
          if (conn.clientId) this.approved.set(conn.clientId, role)
          this.sendControl(conn, { t: 'role', role })
        }
        this.participantsChanged()
        return
      }
    }
  }

  /** Cambia las opciones de la sesión en caliente (re-POST de /share). */
  update(opts: { autoApprove?: boolean; shareRemoteApis?: boolean; hostName?: string }) {
    if (opts.hostName) this.hostName = opts.hostName
    if (opts.shareRemoteApis !== undefined) this.shareRemoteApis = opts.shareRemoteApis
    if (opts.autoApprove !== undefined && opts.autoApprove !== this.autoApprove) {
      this.autoApprove = opts.autoApprove
      // Al activar la aprobación automática se aceptan las solicitudes que estaban esperando.
      // Los que entraron con el código siguen pendientes: con autoApprove el código no autoriza nada.
      if (this.autoApprove) for (const conn of [...this.conns]) if (conn.phase === 'pending' && !conn.byCode) this.activate(conn)
    }
  }

  /** Termina la sesión: avisa {t:'ended'}, cierra todos los sockets y guarda el documento. */
  async end() {
    if (this.ended) return
    this.ended = true
    for (const conn of [...this.conns]) {
      this.sendControl(conn, { t: 'ended' })
      this.drop(conn, CLOSE.ended)
    }
    await this.persist()
    this.awareness.destroy()
    this.doc.destroy()
  }
}
