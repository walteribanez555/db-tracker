// Contrato de informes: lo producen versions/github/io y lo consume reports.

/** Diferencias estructurales entre dos versiones. Un "salto" es cada cambio. */
export interface SchemaDiff {
  addedTables: string[]
  removedTables: string[]
  renamedTables: { from: string; to: string }[]
  modifiedTables: {
    table: string
    addedColumns: string[]
    removedColumns: string[]
    changedColumns: { column: string; changes: string[] }[]
  }[]
  addedRelations: string[]
  removedRelations: string[]
  addedViews: string[]
  removedViews: string[]
  changedViews: string[]
  addedTriggers: string[]
  removedTriggers: string[]
  changedTriggers: string[]
  /** Total de cambios (suma de todo lo anterior). */
  jumps: number
}

/** Métricas por rama/flujo. */
export interface BranchMetrics {
  branchId: string
  branchName: string
  versions: number
  /** Horas promedio entre versiones consecutivas (agilidad: menor = más ágil). */
  avgHoursBetweenVersions: number
  /** Versiones por día en el periodo activo de la rama. */
  versionsPerDay: number
  /** Total de saltos acumulados (suma de SchemaDiff.jumps). */
  totalJumps: number
  /** Mayor salto individual entre dos versiones. */
  maxJump: number
  /** Latencia media de consultas de prueba en ms (null si no se ha medido). */
  avgQueryMs: number | null
  p95QueryMs: number | null
}

export interface QueryBenchmark {
  versionId: string
  query: string
  label: string
  runs: number
  avgMs: number
  p95Ms: number
  /** 'remote' = medido en una BD real; 'estimate' = estimación heurística local. */
  source: 'remote' | 'estimate'
  measuredAt: string
}

export interface GithubBranchReport {
  branch: string
  commits: number
  firstCommitAt: string | null
  lastCommitAt: string | null
  additions: number
  deletions: number
  filesChanged: number
  /** Commits por delante/detrás de la rama por defecto. */
  aheadBy: number
  behindBy: number
}
