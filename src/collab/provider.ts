// Proveedor WebSocket del documento compartido (contrato en protocol.ts):
// - Frames de texto: control JSON. El primero que se envía es {t:'hello'} con el secreto.
// - Frames binarios: varUint(tipo) + payload de y-protocols (0 = sync, 1 = awareness), solo tras {t:'welcome'}.
// - Reconexión con backoff exponencial; las ediciones hechas sin conexión se fusionan al volver (sync step 1/2).
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'

import { AWARENESS_MESSAGE, SYNC_MESSAGE, type ControlMessage } from './protocol'

export type HelloMessage = Extract<ControlMessage, { t: 'hello' }>
export type ProviderStatus = 'connecting' | 'open' | 'reconnecting' | 'offline' | 'closed'

export interface SyncProviderOptions {
  /** URL ws(s)://…/sync/:sessionId */
  url: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  hello: () => Omit<HelloMessage, 't'>
  /** false (p. ej. rol viewer): no se envían actualizaciones del documento. */
  canWrite: () => boolean
  onControl: (msg: ControlMessage) => void
  onStatus: (status: ProviderStatus) => void
  /** Primera sincronización completa con el servidor tras cada conexión. */
  onSynced: () => void
  /** El socket se cerró antes de recibir ninguna respuesta de control. */
  onConnectError?: (error: Error) => void
  /** Implementación de WebSocket (Node 22+ y navegadores la traen global). */
  WebSocketImpl?: typeof WebSocket
}

const MIN_BACKOFF = 500
const MAX_BACKOFF = 10_000
const CONNECT_TIMEOUT = 8_000
/** Mensajes de control que terminan la sesión: no se reintenta. */
const TERMINAL = new Set(['rejected', 'kicked', 'ended'])

export function syncUrl(baseUrl: string, sessionId: string): string {
  const origin = baseUrl || (typeof location !== 'undefined' ? location.origin : 'http://localhost')
  const url = new URL(`/sync/${encodeURIComponent(sessionId)}`, origin)
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  return url.toString()
}

export class SyncProvider {
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  private ws: WebSocket | null = null
  private opts: SyncProviderOptions
  private shouldConnect = true
  private attempts = 0
  private welcomed = false
  /** Hubo alguna respuesta de control en la vida del proveedor (para distinguir "no se pudo conectar"). */
  private answered = false
  private gotServerStep1 = false
  private connSynced = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  /** true tras la primera sincronización completa en cualquier conexión. */
  synced = false

  constructor(opts: SyncProviderOptions) {
    this.opts = opts
    this.doc = opts.doc
    this.awareness = opts.awareness
    this.doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline)
      window.addEventListener('offline', this.onOffline)
      window.addEventListener('beforeunload', this.onUnload)
    }
    this.connect()
  }

  get connected() {
    return this.welcomed && this.ws?.readyState === 1
  }

  /* ─────────────── Conexión ─────────────── */

  private connect = () => {
    if (!this.shouldConnect) return
    this.timer = null
    const Impl = this.opts.WebSocketImpl ?? globalThis.WebSocket
    this.opts.onStatus(this.attempts === 0 ? 'connecting' : this.isOffline() ? 'offline' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = new Impl(this.opts.url)
    } catch (e) {
      this.handleClose(e instanceof Error ? e : new Error(String(e)))
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.welcomed = false
    this.gotServerStep1 = false
    this.connSynced = false
    this.connectTimer = setTimeout(() => ws.readyState !== 1 && ws.close(), CONNECT_TIMEOUT)

    ws.onopen = () => {
      if (this.connectTimer) clearTimeout(this.connectTimer)
      ws.send(JSON.stringify({ t: 'hello', ...this.opts.hello() } satisfies HelloMessage))
    }
    ws.onmessage = (event: MessageEvent) => {
      if (ws !== this.ws) return
      if (typeof event.data === 'string') this.onText(event.data)
      else this.onBinary(new Uint8Array(event.data as ArrayBuffer))
    }
    ws.onclose = (event: CloseEvent) => {
      if (ws !== this.ws) return
      this.handleClose(new Error(event.reason || `Conexión cerrada (${event.code})`))
    }
    ws.onerror = () => {
      // onclose llega a continuación y gestiona el reintento.
    }
  }

  private handleClose(error: Error) {
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.ws = null
    const wasWelcomed = this.welcomed
    this.welcomed = false
    this.connSynced = false
    // Los estados de awareness de los demás ya no son fiables.
    const others = Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID)
    if (others.length) awarenessProtocol.removeAwarenessStates(this.awareness, others, this)
    if (!this.shouldConnect) {
      this.opts.onStatus('closed')
      return
    }
    if (!this.answered && this.attempts === 0 && !wasWelcomed) {
      // Primer intento fallido: se avisa a quien llama (joinSession) y se sigue reintentando.
      this.opts.onConnectError?.(error)
    }
    this.attempts++
    const delay = Math.min(MAX_BACKOFF, MIN_BACKOFF * 2 ** Math.min(this.attempts - 1, 6))
    const jitter = delay * (0.8 + Math.random() * 0.4)
    this.opts.onStatus(this.isOffline() ? 'offline' : 'reconnecting')
    this.timer = setTimeout(this.connect, jitter)
  }

  private isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

  private onOnline = () => {
    if (this.ws || !this.shouldConnect) return
    if (this.timer) clearTimeout(this.timer)
    this.connect()
  }
  private onOffline = () => {
    if (!this.welcomed) this.opts.onStatus('offline')
  }
  private onUnload = () => {
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'window unload')
  }

  /** Fuerza un reintento inmediato (p. ej. botón "Reintentar"). */
  reconnect() {
    if (!this.shouldConnect) return
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    if (!this.ws) this.connect()
  }

  /** Cierra la conexión sin reintentar. */
  disconnect() {
    this.shouldConnect = false
    if (this.timer) clearTimeout(this.timer)
    if (this.connectTimer) clearTimeout(this.connectTimer)
    const ws = this.ws
    if (ws) {
      if (this.welcomed) {
        // Avisa a los demás de que este cliente se va.
        this.sendBinary(this.awarenessMessage([this.doc.clientID], new Map()))
      }
      this.ws = null
      ws.close()
    }
    this.welcomed = false
    this.opts.onStatus('closed')
  }

  destroy() {
    this.disconnect()
    this.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline)
      window.removeEventListener('offline', this.onOffline)
      window.removeEventListener('beforeunload', this.onUnload)
    }
  }

  /* ─────────────── Mensajes ─────────────── */

  private onText(raw: string) {
    let msg: ControlMessage
    try {
      msg = JSON.parse(raw) as ControlMessage
    } catch {
      return
    }
    this.answered = true
    if (msg.t === 'welcome') {
      this.welcomed = true
      this.attempts = 0
      this.opts.onStatus('open')
      // Sync step 1 + estado propio de awareness.
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, SYNC_MESSAGE)
      syncProtocol.writeSyncStep1(enc, this.doc)
      this.sendBinary(encoding.toUint8Array(enc))
      if (this.awareness.getLocalState() !== null) this.sendBinary(this.awarenessMessage([this.doc.clientID]))
    }
    if (TERMINAL.has(msg.t)) {
      this.shouldConnect = false
      if (this.timer) clearTimeout(this.timer)
    }
    this.opts.onControl(msg)
    if (TERMINAL.has(msg.t)) {
      const ws = this.ws
      this.ws = null
      this.welcomed = false
      ws?.close()
      this.opts.onStatus('closed')
    }
  }

  private onBinary(data: Uint8Array) {
    if (!this.welcomed) return
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    if (type === SYNC_MESSAGE) {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, SYNC_MESSAGE)
      const syncType = syncProtocol.readSyncMessage(decoder, enc, this.doc, this)
      if (syncType === syncProtocol.messageYjsSyncStep1) this.gotServerStep1 = true
      // La respuesta (step 2) a un step 1 lleva lo que el servidor no tiene: solo si se puede escribir.
      if (encoding.length(enc) > 1 && this.opts.canWrite()) this.sendBinary(encoding.toUint8Array(enc))
      if (syncType === syncProtocol.messageYjsSyncStep2 && !this.connSynced) {
        this.connSynced = true
        // Servidor que no pide nuestro estado: se envía completo para fusionar lo editado sin conexión.
        if (!this.gotServerStep1 && this.opts.canWrite()) {
          setTimeout(() => {
            if (!this.gotServerStep1 && this.connected) this.sendUpdate(Y.encodeStateAsUpdate(this.doc))
          }, 300)
        }
        this.synced = true
        this.opts.onSynced()
      }
    } else if (type === AWARENESS_MESSAGE) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this)
    }
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.connected || !this.opts.canWrite()) return
    this.sendUpdate(update)
  }

  private sendUpdate(update: Uint8Array) {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, SYNC_MESSAGE)
    syncProtocol.writeUpdate(enc, update)
    this.sendBinary(encoding.toUint8Array(enc))
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || !this.connected) return
    const mine = this.doc.clientID
    if (added.includes(mine) || updated.includes(mine) || removed.includes(mine)) this.sendBinary(this.awarenessMessage([mine]))
  }

  private awarenessMessage(clients: number[], states?: Map<number, Record<string, unknown>>): Uint8Array {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, AWARENESS_MESSAGE)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients, states ?? this.awareness.getStates()))
    return encoding.toUint8Array(enc)
  }

  private sendBinary(data: Uint8Array) {
    const ws = this.ws
    if (ws && ws.readyState === 1) ws.send(data as Uint8Array<ArrayBuffer>)
  }
}
