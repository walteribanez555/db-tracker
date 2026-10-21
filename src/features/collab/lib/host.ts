// Acciones del anfitrión: empezar y dejar de compartir, y reengancharse a una sesión activa tras recargar.
import { joinSession, leaveSession, useCollabStore, type SessionInfo } from '@/collab'
import { isDesktop } from '@/lib/platform'
import { useProjectStore } from '@/store/project'

import { collabApi, secretFromHash } from '../api'
import { useCollabPrefs } from './identity'
import { useJoinContext } from './join'

export const hostDisplayName = () => useCollabPrefs.getState().name.trim() || 'Anfitrión'

/** Conecta la ventana del anfitrión a su propia sesión por loopback (role owner). */
export async function joinAsHost(session: SessionInfo): Promise<void> {
  const secret = secretFromHash(session.joinUrl)
  if (!secret) throw new Error('El servidor no devolvió el secreto de la sesión en el enlace.')
  useJoinContext.getState().set(null)
  await joinSession({
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

/** Sale de la sesión conservando lo editado como proyecto local y cierra el listener de red. */
export async function stopSharing(): Promise<void> {
  if (useCollabStore.getState().status !== 'idle') await leaveSession({ keepCopy: true }).catch(() => undefined)
  await collabApi.stop()
}
