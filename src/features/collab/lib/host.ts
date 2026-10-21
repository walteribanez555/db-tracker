// Acciones del anfitrión: empezar y dejar de compartir, y reengancharse a una sesión activa tras recargar.
import { getSharedBenchmarks, joinSession, leaveSession, useCollabStore, type SessionInfo } from '@/collab'
import { useBenchmarkStore } from '@/features/reports/store'
import { isDesktop } from '@/lib/platform'
import { useProjectStore } from '@/store/project'

import { collabApi, secretFromHash } from '../api'
import { useCollabPrefs } from './identity'
import { useJoinContext } from './join'

export const hostDisplayName = () => useCollabPrefs.getState().name.trim() || 'Anfitrión'

let joining = 0
/** true mientras esta ventana se está uniendo como anfitriona (evita uniones duplicadas desde el sondeo). */
export const isJoiningAsHost = () => joining > 0
async function hostLock<T>(fn: () => Promise<T>): Promise<T> {
  joining++
  try {
    return await fn()
  } finally {
    joining--
  }
}

/** Conecta la ventana del anfitrión a su propia sesión por loopback (role owner). */
export async function joinAsHost(session: SessionInfo): Promise<void> {
  const secret = secretFromHash(session.joinUrl)
  if (!secret) throw new Error('El servidor no devolvió el secreto de la sesión en el enlace.')
  useJoinContext.getState().set(null)
  await hostLock(() => joinHost(session, secret))
}

function joinHost(session: SessionInfo, secret: string) {
  return joinSession({
    baseUrl: '',
    sessionId: session.id,
    secret,
    name: hostDisplayName(),
    color: useCollabPrefs.getState().color,
    kind: isDesktop ? 'desktop' : 'web',
    mode: 'seed-from-local',
  })
}

export async function startSharing(opts: { approveEach: boolean; localApisOnly: boolean }): Promise<SessionInfo> {
  const session = await collabApi.share({
    projectName: useProjectStore.getState().project.name,
    hostName: hostDisplayName(),
    autoApprove: !opts.approveEach,
    shareRemoteApis: !opts.localApisOnly,
  })
  await joinAsHost(session)
  return session
}

/**
 * Al quedarse con el proyecto compartido, los benchmarks del documento (agentes MCP) pasan a ser locales,
 * para que Informes los siga mostrando. Se llama antes de leaveSession (que los olvida).
 */
export function keepSharedBenchmarks(): void {
  const shared = getSharedBenchmarks()
  if (!shared.length) return
  // Sin los campos propios del documento (id, agente, rama): el store local deduplica por versión + consulta + fecha.
  useBenchmarkStore.getState().addBenchmarks(shared.map(({ id: _id, agent: _agent, branchId: _branch, ...b }) => b))
}

/** Sale de la sesión conservando lo editado como proyecto local y cierra el listener de red. */
export async function stopSharing(): Promise<void> {
  if (useCollabStore.getState().status !== 'idle') {
    keepSharedBenchmarks()
    await leaveSession({ keepCopy: true }).catch(() => undefined)
  }
  await collabApi.stop()
}

/** SessionInfo con el ajuste de agentes (el servidor lo devuelve si lo soporta). */
export type HostSessionInfo = SessionInfo & { autoApproveAgents?: boolean }

/** Esta ventana ya está unida como anfitriona a esa sesión (no hace falta volver a unirse). */
export const joinedTo = (sessionId: string) => {
  const st = useCollabStore.getState()
  return st.isHost && st.session?.id === sessionId && st.status !== 'idle' && st.status !== 'ended'
}

/**
 * "Permitir agentes": reutiliza la sesión abierta (p. ej. la de red) o abre una LOCAL (sin listener de red ni mDNS)
 * y une esta ventana como anfitriona, que siembra el documento con el proyecto local.
 */
export function enableAgents(opts: { approveEach: boolean }): Promise<HostSessionInfo> {
  return hostLock(() => openForAgents(opts))
}

async function openForAgents(opts: { approveEach: boolean }): Promise<HostSessionInfo> {
  const current = (await collabApi.status()).session as HostSessionInfo | null
  const session: HostSessionInfo = current
    ? await claimLocalSession(current)
    : await collabApi.share({
      network: 'local',
      projectName: useProjectStore.getState().project.name,
      hostName: hostDisplayName(),
      autoApproveAgents: !opts.approveEach,
    })
  if (!joinedTo(session.id)) await joinAsHost(session)
  return session
}

/**
 * Sesión local abierta por un agente (session_open) con nombre provisional: se le da el nombre real del proyecto
 * repitiendo POST /share en modo 'local' (el servidor la renombra). Si es otro proyecto (409) se deja como está:
 * al unirse, la ventana lo adopta como un invitado sin mezclar nada.
 */
export async function claimLocalSession(session: HostSessionInfo): Promise<HostSessionInfo> {
  const projectName = useProjectStore.getState().project.name
  if (session.network !== 'local' || session.projectName === projectName) return session
  return collabApi.share({ network: 'local', projectName, hostName: hostDisplayName() }).catch(() => session)
}

/** Cambia en caliente "Aprobar cada agente nuevo" repitiendo POST /share con los mismos ajustes. */
export function setAgentApproval(session: HostSessionInfo, approveEach: boolean): Promise<HostSessionInfo> {
  return collabApi.share({
    network: session.network ?? 'lan',
    projectName: session.projectName,
    hostName: session.hostName,
    port: session.network === 'local' ? undefined : session.port,
    autoApprove: session.autoApprove,
    shareRemoteApis: session.shareRemoteApis,
    autoApproveAgents: !approveEach,
  })
}
