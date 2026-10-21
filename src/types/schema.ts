// Modelo de dominio compartido. Contrato entre features: cambia solo con acuerdo.

export type Dialect = 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver'

export type ReferentialAction = 'NO ACTION' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT'

export type Cardinality = '1:1' | '1:N' | 'N:M'

export interface Position {
  x: number
  y: number
}

export interface Column {
  id: string
  name: string
  /** Tipo SQL libre: 'uuid', 'varchar(255)', 'numeric(10,2)' o el nombre de un enum. */
  type: string
  pk: boolean
  nullable: boolean
  unique: boolean
  autoIncrement: boolean
  default?: string
  comment?: string
}

export interface Index {
  id: string
  name: string
  columnIds: string[]
  unique: boolean
}

export interface Table {
  id: string
  name: string
  /** Color hex del encabezado del nodo. */
  color: string
  comment?: string
  columns: Column[]
  indexes: Index[]
  position: Position
}

export interface Relation {
  id: string
  name?: string
  /** Lado "uno" (referenciado, normalmente la PK). */
  sourceTableId: string
  sourceColumnId: string
  /** Lado "muchos" (la columna FK). */
  targetTableId: string
  targetColumnId: string
  cardinality: Cardinality
  onDelete: ReferentialAction
  onUpdate: ReferentialAction
}

export interface EnumType {
  id: string
  name: string
  values: string[]
}

export type TriggerTiming = 'BEFORE' | 'AFTER' | 'INSTEAD OF'
export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'

export interface DbFunction {
  id: string
  name: string
  language: 'plpgsql' | 'sql'
  args: string
  returns: string
  body: string
  comment?: string
  position: Position
}

export interface Trigger {
  id: string
  name: string
  tableId: string
  functionId: string
  timing: TriggerTiming
  events: TriggerEvent[]
  level: 'ROW' | 'STATEMENT'
  /** Condición WHEN opcional, p. ej. "OLD.estado IS DISTINCT FROM NEW.estado". */
  condition?: string
  /** false si el trigger existe pero está desactivado (ALTER TABLE … DISABLE TRIGGER). Por defecto activo. */
  enabled?: boolean
  position: Position
}

/** Vista SQL (normal o materializada). Se dibuja en el diagrama conectada a sus tablas de origen. */
export interface View {
  id: string
  name: string
  /** SELECT completo que define la vista. */
  definition: string
  materialized: boolean
  /** Tablas (o vistas) de las que lee; se deduce del SQL o se edita a mano. */
  sourceIds: string[]
  /** Columnas expuestas (nombre y tipo inferido o declarado) para mostrarlas en el nodo. */
  columns: { name: string; type?: string }[]
  color: string
  comment?: string
  position: Position
}

export interface Note {
  id: string
  text: string
  color: string
  position: Position
}

/**
 * Paso de datos que una migración debe ejecutar para no perder información,
 * p. ej. copiar una lista separada por comas a filas de una tabla nueva antes de borrar la columna.
 * Lo registra quien transforma el esquema (normalización); lo usa generateMigration.
 */
export interface DataMigrationHint {
  id: string
  description: string
  /** SQL (PostgreSQL) que copia los datos. Se ejecuta tras crear tablas/columnas y antes de los DROP. */
  sql: string
  /** Columnas origen "tabla.columna" que la migración elimina después de copiar. */
  sourceColumns: string[]
  /** Tablas que deben existir antes de ejecutar el SQL. */
  requiresTables: string[]
}

export interface Schema {
  dialect: Dialect
  tables: Table[]
  views: View[]
  relations: Relation[]
  enums: EnumType[]
  functions: DbFunction[]
  triggers: Trigger[]
  notes: Note[]
  /** Pasos de datos acumulados; generateMigration incluye los que estén en `to` y no en `from`. */
  dataMigrations?: DataMigrationHint[]
}

/** Una versión es una instantánea inmutable del esquema (equivale a un commit). */
export interface Version {
  id: string
  branchId: string
  parentId: string | null
  message: string
  author: string
  /** ISO 8601 */
  createdAt: string
  schema: Schema
  /** SHA del commit en GitHub cuando ya se sincronizó. */
  githubSha?: string
}

/** Una rama representa un flujo (p. ej. "flujo/3fn", "flujo/triggers-auditoria"). */
export interface Branch {
  id: string
  name: string
  color: string
  /** Descripción del flujo que explora esta rama. */
  description: string
  /** Versión desde la que nació (null para main). */
  forkedFromVersionId: string | null
  headVersionId: string | null
  createdAt: string
}

export interface GithubLink {
  owner: string
  repo: string
  url: string
  defaultBranch: string
  lastSyncAt?: string
}

export interface RemoteConnection {
  id: string
  name: string
  dialect: Extract<Dialect, 'postgresql' | 'mysql'>
  host: string
  port: number
  database: string
  user: string
  ssl: boolean
  /** La contraseña nunca se persiste en el cliente. */
}

export interface Project {
  id: string
  name: string
  dialect: Dialect
  branches: Branch[]
  versions: Version[]
  currentBranchId: string
  github?: GithubLink
  connections: RemoteConnection[]
}
