// Copia del proyecto local mientras un invitado ve el proyecto compartido ('adopt-remote').
// - Se guarda en localStorage aparte (BACKUP_KEY) al adoptar el documento remoto.
// - Mientras dura la sesión, el store persiste en otra clave (COLLAB_PERSIST_KEY): la clave normal del proyecto
//   local no se toca, así que una recarga a mitad de sesión vuelve al proyecto propio.
// - El vínculo de GitHub vive en sessionStorage y nunca se comparte.
import { useProjectStore } from '@/store/project'
import type { GithubLink, Project, Schema } from '@/types/schema'

export const BACKUP_KEY = 'db-tracker:project-backup'
export const PROJECT_PERSIST_KEY = 'db-tracker:project'
export const COLLAB_PERSIST_KEY = 'db-tracker:project-collab'
const GITHUB_SESSION_KEY = 'db-tracker:github-link'

interface Backup {
  savedAt: string
  project: Project
  draft: Schema
  baseVersionId: string | null
}

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const readSessionGithub = (): GithubLink | undefined => {
  try {
    const raw = sessionStorage.getItem(GITHUB_SESSION_KEY)
    return raw ? (JSON.parse(raw) as GithubLink) : undefined
  } catch {
    return undefined
  }
}

export const hasProjectBackup = (): boolean => storage()?.getItem(BACKUP_KEY) != null

/** Guarda el proyecto local actual (sin GitHub) en BACKUP_KEY. */
export function backupLocalProject(): void {
  const { project, draft, baseVersionId } = useProjectStore.getState()
  const backup: Backup = { savedAt: new Date().toISOString(), project: { ...project, github: undefined }, draft, baseVersionId }
  try {
    storage()?.setItem(BACKUP_KEY, JSON.stringify(backup))
  } catch {
    // sin espacio o sin localStorage: queda la clave normal del proyecto, que no se toca durante la sesión
  }
}

/** Restaura la copia local en el store (y borra la copia). Devuelve false si no había. */
export function restoreProjectBackup(): boolean {
  const raw = storage()?.getItem(BACKUP_KEY)
  if (!raw) return false
  try {
    const b = JSON.parse(raw) as Backup
    useProjectStore.setState({
      project: { ...b.project, github: readSessionGithub() },
      draft: b.draft,
      baseVersionId: b.baseVersionId,
      selection: null,
    })
  } catch {
    return false
  }
  discardProjectBackup()
  return true
}

export function discardProjectBackup(): void {
  try {
    storage()?.removeItem(BACKUP_KEY)
  } catch {
    // nada
  }
}

/** Durante la sesión de invitado el store persiste en otra clave (o vuelve a la normal). */
export function setPersistKey(key: string): void {
  const persist = (useProjectStore as unknown as { persist?: { setOptions: (o: { name: string }) => void; getOptions: () => { name?: string } } }).persist
  if (!persist || persist.getOptions().name === key) return
  persist.setOptions({ name: key })
}

export function clearCollabPersist(): void {
  try {
    storage()?.removeItem(COLLAB_PERSIST_KEY)
  } catch {
    // nada
  }
}
