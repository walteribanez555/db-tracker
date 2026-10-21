// Importador DBML (y SQL vía @dbml/core como alternativa) → Schema.
// @dbml/core es pesado: se carga bajo demanda con import() dinámico.
import { uid } from '@/lib/id'
import type { Column, Dialect, EnumType, Relation, Schema, Table } from '@/types/schema'

import { IMPORT_TABLE_COLORS, gridLayout } from './layout'
import { inferCardinality, toAction, type ParseOptions } from './normalize'

export interface DbmlImportResult {
  schema: Schema
  warnings: string[]
}

export type DbmlSourceFormat = 'dbml' | 'postgres' | 'mysql' | 'mssql'

interface DbmlField {
  name: string
  type: { type_name: string; schemaName?: string | null }
  pk?: boolean
  unique?: boolean
  not_null?: boolean
  increment?: boolean
  note?: string | null
  dbdefault?: { value: unknown; type: 'number' | 'string' | 'boolean' | 'expression' }
}
interface DbmlTable {
  name: string
  note?: string | null
  headerColor?: string
  fields: DbmlField[]
  indexes: { name?: string | null; unique?: boolean; pk?: boolean; columns: { type: string; value: string }[] }[]
}
interface DbmlEndpoint {
  schemaName?: string | null
  tableName: string
  fieldNames: string[]
  relation: '1' | '*'
}
interface DbmlRef {
  name?: string | null
  onDelete?: string
  onUpdate?: string
  endpoints: [DbmlEndpoint, DbmlEndpoint]
}
interface DbmlSchemaJson {
  name: string
  tables: DbmlTable[]
  enums: { name: string; values: { name: string }[] }[]
  refs: DbmlRef[]
}

/** Error de @dbml/core → mensajes legibles con línea/columna. */
export function formatDbmlError(e: unknown): string {
  const diags = (e as { diags?: { message: string; location?: { start?: { line: number; column: number } } }[] })?.diags
  if (Array.isArray(diags) && diags.length) {
    return diags
      .slice(0, 5)
      .map((d) => (d.location?.start ? `Línea ${d.location.start.line}:${d.location.start.column} · ` : '') + d.message)
      .join('\n')
  }
  return e instanceof Error ? e.message : String(e)
}

function dbmlDefault(d: DbmlField['dbdefault']): string | undefined {
  if (!d || d.value === null || d.value === undefined) return undefined
  if (d.type === 'string') return `'${String(d.value).replace(/'/g, "''")}'`
  return String(d.value)
}

/** Convierte el JSON normalizado de @dbml/core en nuestro Schema. */
export function dbmlJsonToSchema(
  json: { schemas: DbmlSchemaJson[] },
  dialect: Dialect = 'postgresql',
  opts: ParseOptions = {},
): DbmlImportResult {
  const warnings: string[] = []
  const tables: Table[] = []
  const enums: EnumType[] = []
  const relations: Relation[] = []
  const multi = json.schemas.filter((s) => s.tables.length).length > 1
  const qualify = (schema: string | null | undefined, name: string) =>
    multi && schema && schema !== 'public' ? `${schema}.${name}` : name

  for (const sch of json.schemas) {
    for (const e of sch.enums ?? []) enums.push({ id: uid('enum_'), name: qualify(sch.name, e.name), values: e.values.map((v) => v.name) })
  }
  for (const sch of json.schemas) {
    for (const t of sch.tables ?? []) {
      const columns: Column[] = t.fields.map((f) => ({
        id: uid('col_'),
        name: f.name,
        type: f.type.type_name,
        pk: !!f.pk,
        nullable: !f.pk && !f.not_null,
        unique: !!f.unique,
        autoIncrement: !!f.increment,
        ...(dbmlDefault(f.dbdefault) !== undefined ? { default: dbmlDefault(f.dbdefault) } : {}),
        ...(f.note ? { comment: f.note } : {}),
      }))
      // serial → integer autoincremental
      for (const c of columns) {
        const m = /^(small|big)?serial$/i.exec(c.type)
        if (m) {
          c.type = m[1] ? `${m[1].toLowerCase()}int` : 'integer'
          c.autoIncrement = true
        }
      }
      const table: Table = {
        id: uid('tbl_'),
        name: qualify(sch.name, t.name),
        color: t.headerColor && /^#[0-9a-f]{3,8}$/i.test(t.headerColor) ? t.headerColor : IMPORT_TABLE_COLORS[tables.length % IMPORT_TABLE_COLORS.length],
        ...(t.note ? { comment: t.note } : {}),
        columns,
        indexes: [],
        position: { x: 0, y: 0 },
      }
      for (const idx of t.indexes ?? []) {
        const exprs = idx.columns.filter((c) => c.type !== 'column')
        if (exprs.length) warnings.push(`Índice por expresión ignorado en ${t.name}.`)
        const ids = idx.columns
          .filter((c) => c.type === 'column')
          .map((c) => columns.find((x) => x.name === c.value)?.id)
          .filter((x): x is string => !!x)
        if (!ids.length) continue
        if (idx.pk) {
          for (const id of ids) {
            const c = columns.find((x) => x.id === id)!
            c.pk = true
            c.nullable = false
          }
          continue
        }
        if (idx.unique && ids.length === 1 && !idx.name) {
          columns.find((x) => x.id === ids[0])!.unique = true
          continue
        }
        table.indexes.push({ id: uid('idx_'), name: idx.name ?? '', columnIds: ids, unique: !!idx.unique })
      }
      tables.push(table)
    }
  }

  const findTable = (schema: string | null | undefined, name: string) =>
    tables.find((t) => t.name === qualify(schema ?? 'public', name)) ?? tables.find((t) => t.name === name)

  for (const sch of json.schemas) {
    for (const ref of sch.refs ?? []) {
      const [a, b] = ref.endpoints
      // El lado "1" es el referenciado (source); el lado "*" lleva la FK (target).
      // En 1:1 el primer extremo lleva la FK (convención de nuestro exportador: `fk - pk`).
      let src = a
      let tgt = b
      let cardinality: Relation['cardinality'] = '1:N'
      if (a.relation === '1' && b.relation === '*') [src, tgt] = [a, b]
      else if (a.relation === '*' && b.relation === '1') [src, tgt] = [b, a]
      else if (a.relation === '1' && b.relation === '1') {
        ;[src, tgt] = [b, a]
        cardinality = '1:1'
      } else cardinality = 'N:M'
      const st = findTable(src.schemaName, src.tableName)
      const tt = findTable(tgt.schemaName, tgt.tableName)
      if (!st || !tt) {
        warnings.push(`Referencia a tabla desconocida: ${src.tableName} / ${tgt.tableName}`)
        continue
      }
      src.fieldNames.forEach((sf, i) => {
        const sc = st.columns.find((c) => c.name === sf)
        const tc = tt.columns.find((c) => c.name === (tgt.fieldNames[i] ?? tgt.fieldNames[0]))
        if (!sc || !tc) return
        relations.push({
          id: uid('rel_'),
          ...(ref.name ? { name: ref.name } : {}),
          sourceTableId: st.id,
          sourceColumnId: sc.id,
          targetTableId: tt.id,
          targetColumnId: tc.id,
          cardinality: cardinality === '1:N' ? inferCardinality(tc, tt.columns.filter((c) => c.pk).length) : cardinality,
          onDelete: toAction(ref.onDelete),
          onUpdate: toAction(ref.onUpdate),
        })
      })
    }
  }

  const schema: Schema = { dialect, tables, views: [], relations, enums, functions: [], triggers: [], notes: [] }
  if (opts.layout !== false) gridLayout(schema)
  return { schema, warnings }
}

const FORMAT_DIALECT: Record<DbmlSourceFormat, Dialect> = {
  dbml: 'postgresql',
  postgres: 'postgresql',
  mysql: 'mysql',
  mssql: 'sqlserver',
}

/** Parsea con @dbml/core. Lanza Error con mensaje legible si hay errores de sintaxis. */
export async function importWithDbmlCore(
  text: string,
  format: DbmlSourceFormat = 'dbml',
  dialect?: Dialect,
  opts: ParseOptions = {},
): Promise<DbmlImportResult> {
  const { Parser, ModelExporter } = await import('@dbml/core')
  let json: { schemas: DbmlSchemaJson[] }
  try {
    const db = Parser.parse(text, format === 'dbml' ? 'dbmlv2' : format)
    json = JSON.parse(ModelExporter.export(db, 'json', false)) as { schemas: DbmlSchemaJson[] }
  } catch (e) {
    throw new Error(formatDbmlError(e))
  }
  let d = dialect ?? FORMAT_DIALECT[format]
  if (format === 'dbml' && !dialect) {
    const m = /database_type\s*:\s*['"]([^'"]+)['"]/i.exec(text)
    const t = m?.[1].toLowerCase() ?? ''
    if (t.includes('mysql')) d = 'mysql'
    else if (t.includes('sqlite')) d = 'sqlite'
    else if (t.includes('server') || t.includes('mssql')) d = 'sqlserver'
  }
  return dbmlJsonToSchema(json, d, opts)
}

export const importDBML = (text: string, dialect?: Dialect, opts: ParseOptions = {}) => importWithDbmlCore(text, 'dbml', dialect, opts)
