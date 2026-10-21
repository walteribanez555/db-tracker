// Tipos del contrato HTTP cliente <-> servidor de la feature GitHub.
// Tipos y constantes sin dependencias de DOM ni de Node: los importan src/features/github y server/lib/github.
import type { GithubBranchReport } from '@/types/report'
import type { Branch, Dialect, Project } from '@/types/schema'

export type GithubErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'not_found'
  | 'repo_exists'
  | 'repo_empty'
  | 'validation'
  | 'conflict'
  | 'device_flow_disabled'
  | 'github_error'
  | 'bad_request'

export interface GithubApiErrorBody {
  error: { code: GithubErrorCode; message: string; resetAt?: string }
}

export interface GithubUser {
  id: number
  login: string
  name: string | null
  avatarUrl: string
  htmlUrl: string
}

export type GithubTokenKind = 'classic' | 'fine-grained' | 'oauth'

export type GithubMe =
  | { connected: false; deviceFlowAvailable: boolean }
  | {
      connected: true
      deviceFlowAvailable: boolean
      user: GithubUser
      tokenKind: GithubTokenKind
      /** Scopes del token (solo tokens classic / OAuth). */
      scopes: string[] | null
      warnings: string[]
    }

export interface DeviceStartResponse {
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type DevicePollResponse =
  | { status: 'pending' | 'slow_down'; interval: number }
  | { status: 'expired' | 'denied'; message: string }
  | { status: 'complete'; me: GithubMe }

export interface GithubRepoSummary {
  id: number
  owner: string
  name: string
  fullName: string
  private: boolean
  htmlUrl: string
  defaultBranch: string
  description: string | null
  updatedAt: string | null
  canPush: boolean
  empty: boolean
}

export interface CreateRepoInput {
  name: string
  description?: string
  private: boolean
  autoInit: boolean
}

export interface RemoteBranch {
  name: string
  sha: string
}

// ---------- Sincronización ----------

export interface SyncFile {
  path: string
  content: string
}

export interface SyncVersionInput {
  id: string
  branchId: string
  parentId: string | null
  message: string
  author: string
  createdAt: string
  githubSha?: string
  files: SyncFile[]
}

export interface SyncBranchInput {
  id: string
  name: string
  forkedFromVersionId: string | null
  headVersionId: string | null
}

export interface SyncInput {
  owner: string
  repo: string
  /** Rama por defecto del repo (normalmente "main"). */
  defaultBranch: string
  /** Si es true, las refs que no avanzan en fast-forward se reescriben. */
  force: boolean
  branches: SyncBranchInput[]
  versions: SyncVersionInput[]
}

export type RefStatus = 'created' | 'updated' | 'forced' | 'unchanged' | 'conflict' | 'error' | 'skipped'

export interface RefResult {
  branch: string
  sha: string | null
  status: RefStatus
  message?: string
}

export type SyncEvent =
  | { type: 'start'; total: number; order: string[] }
  | { type: 'bootstrap'; message: string }
  | { type: 'version'; versionId: string; index: number; total: number; status: 'created' | 'skipped'; sha: string }
  | { type: 'version-error'; versionId: string; message: string }
  | { type: 'ref'; ref: RefResult }
  | { type: 'default-branch'; branch: string }
  | { type: 'done'; result: SyncResult }
  | { type: 'error'; error: GithubApiErrorBody['error'] }

export interface SyncResult {
  mapping: Record<string, string>
  created: number
  skipped: number
  refs: RefResult[]
  warnings: string[]
}

// ---------- Informe ----------

export interface GithubBranchMetrics {
  branch: string
  isDefault: boolean
  /** Horas medias entre commits consecutivos (agilidad: menor = más ágil). */
  avgHoursBetweenCommits: number | null
  /** Commits por día en el periodo activo de la rama. */
  commitsPerDay: number | null
  /** Fecha del commit desde el que se bifurcó de la rama por defecto (merge base). */
  forkedAt: string | null
  /** Horas desde el fork hasta el último commit del flujo. */
  leadTimeHours: number | null
}

export interface GithubReportResponse {
  owner: string
  repo: string
  htmlUrl: string
  networkUrl: string
  defaultBranch: string
  generatedAt: string
  branches: GithubBranchReport[]
  metrics: GithubBranchMetrics[]
  summary: {
    branches: number
    totalCommits: number
    avgHoursBetweenCommits: number | null
    avgLeadTimeHours: number | null
  }
  rateLimit: { remaining: number | null; resetAt: string | null }
}

// ---------- Metadatos del proyecto (archivo .dbtracker/project.json en cada commit) ----------

export const PROJECT_META_PATH = '.dbtracker/project.json'

export interface ProjectMetaFile {
  format: 'db-tracker/github-meta'
  formatVersion: 1
  exportedAt: string
  project: { id: string; name: string; dialect: Dialect; currentBranch: string | null }
  branches: Array<Pick<Branch, 'id' | 'name' | 'color' | 'description' | 'createdAt' | 'forkedFromVersionId'>>
}

// ---------- Bajar (pull) ----------

export interface PullBranchSummary {
  name: string
  versions: number
  firstAt: string | null
  lastAt: string | null
  /** Commits en la rama remota que no proceden de DB Tracker (se ignoran). */
  foreignCommits: number
  /** La rama no tiene versiones propias: apunta a la versión de la que se bifurcó. */
  empty: boolean
}

export interface PullResponse {
  project: Project
  summary: {
    defaultBranch: string
    versions: number
    firstAt: string | null
    lastAt: string | null
    branches: PullBranchSummary[]
    /** true si el repo trae .dbtracker/project.json (colores, descripciones, nombre). */
    hasMetadata: boolean
  }
  warnings: string[]
}

export type PullEvent =
  | { type: 'phase'; message: string }
  | { type: 'start'; total: number; items: Array<{ versionId: string; message: string; flujo: string }> }
  | { type: 'version-start'; versionId: string }
  | { type: 'version-done'; versionId: string; ok: boolean }
  | { type: 'done'; result: PullResponse }
  | { type: 'error'; error: GithubApiErrorBody['error'] }
