export type NormalLevel = '1FN' | '2FN' | '3FN' | 'BCNF' | 'buenas-prácticas'
export type Severity = 'alta' | 'media' | 'baja'

export type RuleId =
  | 'sin-pk'
  | 'multivaluada'
  | 'grupo-repetitivo'
  | 'dependencia-parcial'
  | 'dependencia-transitiva'
  | 'claves-superpuestas'
  | 'fk-sin-indice'
  | 'columna-duplicada'
  | 'nombres-inconsistentes'
  | 'tabla-singular-plural'
  | 'palabra-reservada'
  | 'tipo-dinero-float'
  | 'tipo-fecha-texto'
  | 'tipo-booleano-texto'
  | 'vista-rota'
  | 'vista-sin-uso'
  | 'vista-sin-refresco'

/**
 * Plan de corrección declarativo: `applyFix` lo traduce en cambios sobre el esquema.
 * Es serializable para poder describirlo, previsualizarlo y aplicarlo en un flujo nuevo.
 */
export type FixPlan =
  | { kind: 'add-pk'; tableId: string; columnName: string; type: string }
  | {
      /** Lleva columnas de una tabla a una entidad propia (nueva o existente) y las une por FK. */
      kind: 'extract-entity'
      sourceTableId: string
      columnIds: string[]
      /** Si existe, las columnas se fusionan en esa tabla. */
      targetTableId?: string
      /** Nombre de la tabla nueva cuando no hay `targetTableId`. */
      newTableName: string
      /** Columna de la tabla origen que ya apunta a la entidad (p. ej. cliente_id). */
      linkColumnId?: string
      /** Nombre de la FK a crear si no hay `linkColumnId`. */
      linkColumnName: string
      /** Prefijo a quitar al mover (cliente_nombre → nombre). */
      stripPrefix?: string
    }
  | {
      /** Convierte una columna multivaluada o un grupo repetitivo en una tabla hija 1:N. */
      kind: 'extract-multivalued'
      tableId: string
      columnIds: string[]
      newTableName: string
      valueColumnName: string
      valueType: string
    }
  | { kind: 'add-index'; tableId: string; columnIds: string[]; name: string }
  | { kind: 'change-type'; tableId: string; columnId: string; newType: string }
  | { kind: 'rename-columns'; tableId: string; renames: { columnId: string; newName: string }[] }
  | { kind: 'rename-table'; tableId: string; newName: string }
  | { kind: 'drop-columns'; tableId: string; columnIds: string[] }
  | { kind: 'drop-view'; viewId: string }

export interface Finding {
  id: string
  rule: RuleId
  level: NormalLevel
  severity: Severity
  /** Tabla afectada. En hallazgos de vistas es el id de la vista. */
  tableId: string
  /** Presente cuando el hallazgo es sobre una vista. */
  viewId?: string
  columnIds: string[]
  title: string
  /** Explicación didáctica en español. */
  explanation: string
  suggestion: string
  fix?: FixPlan
}

export const LEVELS: NormalLevel[] = ['1FN', '2FN', '3FN', 'BCNF', 'buenas-prácticas']
export const NORMAL_FORMS: Exclude<NormalLevel, 'buenas-prácticas'>[] = ['1FN', '2FN', '3FN', 'BCNF']
export const SEVERITY_ORDER: Record<Severity, number> = { alta: 0, media: 1, baja: 2 }
