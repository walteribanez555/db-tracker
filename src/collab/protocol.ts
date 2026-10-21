// Contrato de la colaboración en red (cliente ↔ servidor). Lo usan src/collab/** y server/collab/**.
// Diseño completo: docs/arquitectura/colaboracion-en-red.md

/* ───────────────────────── Roles y participantes ───────────────────────── */

export type CollabRole = 'owner' | 'editor' | 'viewer'
export type ClientKind = 'desktop' | 'web' | 'mobile'

export interface Participant {
  /** id estable de la conexión (lo asigna el servidor). */
  id: string
  name: string
  /** Color hex para avatar, cursor y selección. */
  color: string
  kind: ClientKind
  role: CollabRole
  status: 'pending' | 'active'
  /** IP de origen (solo la ve el anfitrión). */
  address?: string
  joinedAt: string
}

/* ───────────────────────── Sesión (anfitrión) ───────────────────────── */

export interface SessionInfo {
  id: string
  /** Código de 6 caracteres legibles (sin 0/O/1/I), para dictarlo. */
  code: string
  projectName: string
  hostName: string
  /** Puerto del listener de red. */
  port: number
  /** Direcciones IPv4 de la red local donde escucha. */
  addresses: string[]
  /** Enlace para navegador/móvil: http://IP:PUERTO/unirse?sala=CODE#s=SECRET (solo lo recibe el anfitrión). */
  joinUrl: string
  /** SVG del QR de joinUrl (solo para el anfitrión). */
  qrSvg: string
  autoApprove: boolean
  /** false: los invitados no pueden usar /api/db ni /api/github del anfitrión (recomendado). */
  shareRemoteApis: boolean
  startedAt: string
}

/** Respuesta pública (sin secreto) para la pantalla "Unirse". */
export interface PublicSessionInfo {
  id: string
  code: string
  projectName: string
  hostName: string
  participants: number
  needsApproval: boolean
}

/** Sesión descubierta en la red por mDNS (servicio "_dbtracker._tcp"). */
export interface DiscoveredSession {
  id: string
  projectName: string
  hostName: string
  address: string
  port: number
  participants: number
}

/* ───────────────────────── API REST ───────────────────────── */
// Solo loopback (la ventana del propio equipo):
//   GET  /api/collab/status                         → { session: SessionInfo | null, participants: Participant[] }
//   POST /api/collab/share   ShareRequest           → SessionInfo        (abre el listener de red + anuncio mDNS;
//                                                    repetirlo con el mismo proyecto actualiza autoApprove/shareRemoteApis en caliente)
//   POST /api/collab/stop                           → { ok: true }       (cierra listener, avisa {t:'ended'})
//   POST /api/collab/participants/:id  ParticipantAction → { ok: true }
//   GET  /api/collab/discover                       → DiscoveredSession[] (búsqueda mDNS ~1,5 s)
// Públicos en el listener de red (y en loopback):
//   GET  /api/collab/public/:code                   → PublicSessionInfo  (404 si no existe)
//   GET  /unirse?sala=CODE                          → frontend (SPA)
//   WS   /sync/:sessionId                           → protocolo de abajo
// En el listener de red NO existen /api/db ni /api/github (salvo shareRemoteApis).

export interface ShareRequest {
  projectName: string
  hostName: string
  /** Puerto fijo opcional; por defecto 47123 o el siguiente libre. */
  port?: number
  autoApprove?: boolean
  shareRemoteApis?: boolean
}

export interface ParticipantAction {
  action: 'approve' | 'reject' | 'kick' | 'set-role'
  role?: Exclude<CollabRole, 'owner'>
}

/* ───────────────────────── WebSocket /sync/:sessionId ───────────────────────── */
// - Frames de TEXTO = control JSON (ControlMessage).
// - Frames BINARIOS = mensajes y-protocols con la codificación de y-websocket:
//     varUint(tipo) + payload, tipo 0 = sync (syncStep1/2/update), 1 = awareness.
// - El primer frame del cliente DEBE ser {t:'hello'} con el secreto (nunca en la URL, para que no acabe en logs).
//   Si la sesión NO aprueba automáticamente (autoApprove=false), el código de sala también vale como secreto:
//   el invitado entra en 'pending' y el anfitrión decide. Con autoApprove=true solo vale el secreto largo.
// - Hasta recibir {t:'welcome'} el servidor ignora los binarios. Los 'viewer' no pueden enviar updates.
// - El anfitrión también se conecta a su propia sesión por loopback con el secreto y obtiene role 'owner'.

export type ControlMessage =
  | { t: 'hello'; secret: string; name: string; color: string; kind: ClientKind; clientId: string }
  | { t: 'pending' }
  | { t: 'welcome'; participantId: string; role: CollabRole; session: PublicSessionInfo }
  | { t: 'rejected'; reason: string }
  | { t: 'kicked' }
  | { t: 'role'; role: CollabRole }
  | { t: 'participants'; list: Participant[] }
  | { t: 'ended' }
  | { t: 'error'; message: string }

export const SYNC_MESSAGE = 0
export const AWARENESS_MESSAGE = 1

/** Código de sala: 6 caracteres de este alfabeto. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const DEFAULT_SHARE_PORT = 47123
export const MDNS_SERVICE_TYPE = 'dbtracker'

/* ───────────────────────── Documento Yjs ───────────────────────── */
// Y.Doc
//  ├─ 'meta'      Y.Map  { projectId, name, dialect }
//  ├─ 'branches'  Y.Map<branchId, Y.Map<campos de Branch>>          (headVersionId incluido)
//  ├─ 'versions'  Y.Map<versionId, string>                          JSON de Version, inmutable (solo se añaden)
//  └─ 'drafts'    Y.Map<branchId, Y.Map>                            borrador compartido por rama
//        ├─ 'baseVersionId'  string | null
//        ├─ 'dialect'        string
//        ├─ 'tables'         Y.Map<id, Y.Map{ id, name, color, comment, position(json), indexes(json),
//        │                                    columns: Y.Array<Y.Map<campos de Column>> }>
//        ├─ 'views'          Y.Map<id, Y.Map{ ...campos, definition: Y.Text }>
//        ├─ 'functions'      Y.Map<id, Y.Map{ ...campos, body: Y.Text }>
//        ├─ 'relations' | 'triggers' | 'notes' | 'enums' | 'dataMigrations'   Y.Map<id, json>
// La rama actual de cada persona NO está en el documento: va en awareness (cada uno puede estar en otra rama).

export const Y_KEYS = { meta: 'meta', branches: 'branches', versions: 'versions', drafts: 'drafts' } as const

/** Estado de awareness que publica cada cliente. */
export interface AwarenessState {
  user: { id: string; name: string; color: string; kind: ClientKind; role: CollabRole }
  branchId: string
  /** Ruta actual (/editor, /triggers…). */
  route: string
  /** Cursor en coordenadas del lienzo de React Flow (null si fuera del lienzo). */
  cursor: { x: number; y: number } | null
  /** Elemento seleccionado. */
  selection: { kind: string; id: string } | null
  /** Qué edita ahora (p. ej. "Ana está editando pedidos"). */
  editing?: { kind: string; id: string; label: string } | null
}
