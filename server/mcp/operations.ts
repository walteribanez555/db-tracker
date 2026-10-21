// Operaciones de `edit_schema`: se describen por NOMBRE (tabla, columna, vista…), se validan y se aplican
// sobre una copia del borrador. El lote es atómico: si alguna falla, no se escribe nada.
import { z } from 'zod'

import { fkTypeFor } from '../../src/features/normalization/lib/fixes.ts'
import { freeSpot } from '../../src/features/triggers/lib/templates.ts'
import { uid } from '../../src/lib/id.ts'
import { inferViewColumns, resolveViewSources, VIEW_COLOR } from '../../src/lib/importers/views.ts'
import type { Column, Index, Position, Relation, Schema, Table, Trigger, View } from '../../src/types/schema.ts'

/** Copia de TABLE_COLORS de src/store/project.ts. */
const TABLE_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#f43f5e', '#06b6d4', '#64748b']
const NOTE_COLOR = '#fef08a'

/* ───────────────────────── Esquemas zod ───────────────────────── */

const ident = z.string().trim().min(1, 'nombre vacío').max(63, 'máximo 63 caracteres')
const ref = z.string().trim().min(1).max(200)
const hex = z.string().regex(/^#[0-9a-f]{3,8}$/i, 'color hex (#rrggbb)')
const position = z.object({ x: z.number(), y: z.number() })
const action = z.enum(['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT'])

const columnInput = z.object({
  name: ident,
  type: z.string().trim().min(1).max(120).describe("Tipo SQL: 'uuid', 'varchar(255)', 'numeric(10,2)', 'timestamptz' o el nombre de un enum"),
  pk: z.boolean().optional(),
  nullable: z.boolean().optional().describe('Por defecto true (false si es pk)'),
  unique: z.boolean().optional(),
  autoIncrement: z.boolean().optional(),
  default: z.string().max(500).optional().describe("Expresión SQL, p. ej. now() o 'pendiente'"),
  comment: z.string().max(1000).optional(),
})

const columnPatch = z.object({
  name: ident.optional(),
  type: z.string().trim().min(1).max(120).optional(),
  pk: z.boolean().optional(),
  nullable: z.boolean().optional(),
  unique: z.boolean().optional(),
  autoIncrement: z.boolean().optional(),
  default: z.string().max(500).nullable().optional().describe('null quita el valor por defecto'),
  comment: z.string().max(1000).nullable().optional(),
})

const endpoint = z.object({ table: ref, column: ref })

export const operationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add_table'),
    table: z.object({
      name: ident,
      color: hex.optional(),
      comment: z.string().max(1000).optional(),
      columns: z.array(columnInput).max(200).optional().describe('Si se omite, se crea una columna id como clave primaria'),
      position: position.optional(),
      near: ref.optional().describe('Tabla junto a la que colocarla en el lienzo'),
    }),
  }),
  z.object({
    op: z.literal('update_table'),
    table: ref,
    set: z.object({ name: ident.optional(), color: hex.optional(), comment: z.string().max(1000).nullable().optional(), position: position.optional() }),
  }),
  z.object({ op: z.literal('remove_table'), table: ref }),
  z.object({
    op: z.literal('add_column'),
    table: ref,
    column: columnInput,
    after: ref.optional().describe('Columna tras la que insertarla (por defecto, al final)'),
  }),
  z.object({ op: z.literal('update_column'), table: ref, column: ref, set: columnPatch }),
  z.object({ op: z.literal('remove_column'), table: ref, column: ref }),
  z.object({
    op: z.literal('move_column'),
    table: ref,
    column: ref,
    to: z.number().int().min(0).optional().describe('Posición 0-based'),
    after: ref.optional().describe('Columna tras la que colocarla'),
  }),
  z.object({
    op: z.literal('add_index'),
    table: ref,
    index: z.object({ name: ident.optional(), columns: z.array(ref).min(1).max(32), unique: z.boolean().optional() }),
  }),
  z.object({ op: z.literal('remove_index'), table: ref, index: ref }),
  z.object({
    op: z.literal('add_relation'),
    relation: z.object({
      name: z.string().trim().max(63).optional(),
      source: endpoint.describe('Lado «uno» (columna referenciada, normalmente la PK)'),
      target: endpoint.describe('Lado «muchos» (la columna FK)'),
      cardinality: z.enum(['1:1', '1:N', 'N:M']).optional(),
      onDelete: action.optional(),
      onUpdate: action.optional(),
      createColumn: z.boolean().optional().describe('Crea la columna FK en target si no existe (tipo compatible con la PK)'),
    }),
  }),
  z.object({
    op: z.literal('update_relation'),
    relation: ref.describe('Nombre, id o «tabla.columna» de la FK'),
    set: z.object({ name: z.string().trim().max(63).optional(), cardinality: z.enum(['1:1', '1:N', 'N:M']).optional(), onDelete: action.optional(), onUpdate: action.optional() }),
  }),
  z.object({ op: z.literal('remove_relation'), relation: ref.describe('Nombre, id o «tabla.columna» de la FK') }),
  z.object({
    op: z.literal('upsert_enum'),
    enum: z.object({ name: ident, values: z.array(z.string().min(1).max(200)).min(1).max(500), rename: ident.optional() }),
  }),
  z.object({ op: z.literal('remove_enum'), enum: ref }),
  z.object({
    op: z.literal('upsert_view'),
    view: z.object({
      name: ident,
      definition: z.string().min(1).max(100_000).describe('SELECT completo'),
      materialized: z.boolean().optional(),
      comment: z.string().max(1000).nullable().optional(),
      color: hex.optional(),
      sources: z.array(ref).optional().describe('Tablas/vistas de origen; si se omite, se deducen del SQL'),
      columns: z.array(z.object({ name: z.string().min(1), type: z.string().optional() })).optional(),
      rename: ident.optional(),
    }),
  }),
  z.object({ op: z.literal('remove_view'), view: ref }),
  z.object({
    op: z.literal('upsert_function'),
    function: z.object({
      name: ident,
      language: z.enum(['plpgsql', 'sql']).optional(),
      args: z.string().max(2000).optional(),
      returns: z.string().max(200).optional().describe('Por defecto trigger'),
      body: z.string().max(100_000),
      comment: z.string().max(1000).nullable().optional(),
      rename: ident.optional(),
    }),
  }),
  z.object({ op: z.literal('remove_function'), function: ref }),
  z.object({
    op: z.literal('upsert_trigger'),
    trigger: z.object({
      name: ident,
      table: ref,
      function: ref,
      timing: z.enum(['BEFORE', 'AFTER', 'INSTEAD OF']),
      events: z.array(z.enum(['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])).min(1),
      level: z.enum(['ROW', 'STATEMENT']).optional(),
      condition: z.string().max(2000).nullable().optional(),
      enabled: z.boolean().optional(),
    }),
  }),
  z.object({ op: z.literal('remove_trigger'), trigger: ref, table: ref.optional() }),
  z.object({
    op: z.literal('add_note'),
    note: z.object({ text: z.string().min(1).max(5000), color: hex.optional(), near: ref.optional().describe('Tabla junto a la que colocarla') }),
  }),
])

export type Operation = z.infer<typeof operationSchema>

/* ───────────────────────── Aplicación ───────────────────────── */

class OpError extends Error {}

const lower = (s: string) => s.trim().toLowerCase()
const byName = <T extends { id: string; name: string }>(list: T[], key: string) =>
  list.find((x) => x.id === key) ?? list.find((x) => x.name === key) ?? list.find((x) => lower(x.name) === lower(key))

export interface ApplyResult {
  schema: Schema
  /** Una línea legible por cambio aplicado. */
  changes: string[]
  /** Errores por operación («#2 add_column: …»). Si hay alguno, no se escribe nada. */
  errors: string[]
  /** Primer elemento tocado (para `editing` en awareness). */
  focus: { kind: string; id: string; label: string } | null
}

export function applyOperations(input: Schema, ops: Operation[]): ApplyResult {
  const s = structuredClone(input)
  const changes: string[] = []
  const errors: string[] = []
  let focus: ApplyResult['focus'] = null
  /** Tablas nuevas sin posición explícita (se colocan al final) y su «vecina». */
  const toPlace: { table: Table; near?: string }[] = []
  const notesToPlace: { id: string; near?: string }[] = []

  const table = (key: string) => {
    const t = byName(s.tables, key)
    if (!t) throw new OpError(`no existe la tabla «${key}»`)
    return t
  }
  const column = (t: Table, key: string) => {
    const c = byName(t.columns, key)
    if (!c) throw new OpError(`la tabla «${t.name}» no tiene la columna «${key}»`)
    return c
  }
  const relationOf = (key: string): Relation => {
    const k = key.trim()
    const label = (r: Relation, side: 'source' | 'target') => {
      const t = s.tables.find((x) => x.id === (side === 'source' ? r.sourceTableId : r.targetTableId))
      const c = t?.columns.find((x) => x.id === (side === 'source' ? r.sourceColumnId : r.targetColumnId))
      return `${t?.name ?? '?'}.${c?.name ?? '?'}`.toLowerCase()
    }
    const matches = s.relations.filter(
      (r) =>
        r.id === k ||
        (r.name && lower(r.name) === lower(k)) ||
        label(r, 'target') === lower(k) ||
        `${label(r, 'source')}->${label(r, 'target')}` === lower(k).replace(/\s+/g, ''),
    )
    if (!matches.length) throw new OpError(`no existe la relación «${key}» (usa su nombre o «tabla.columna_fk»)`)
    if (matches.length > 1) throw new OpError(`«${key}» identifica varias relaciones; usa «origen.col->destino.col»`)
    return matches[0]
  }
  const relOrView = (key: string) => byName(s.tables, key) ?? byName(s.views, key)
  const ensureUniqueTable = (name: string, self?: string) => {
    const clash = [...s.tables, ...s.views].find((x) => x.id !== self && lower(x.name) === lower(name))
    if (clash) throw new OpError(`ya existe una tabla o vista llamada «${clash.name}»`)
  }
  const ensureUniqueColumn = (t: Table, name: string, self?: string) => {
    const clash = t.columns.find((c) => c.id !== self && lower(c.name) === lower(name))
    if (clash) throw new OpError(`la tabla «${t.name}» ya tiene la columna «${clash.name}»`)
  }
  const touch = (kind: string, id: string, label: string) => {
    focus ??= { kind, id, label }
  }
  const newColumn = (c: z.infer<typeof columnInput>): Column => ({
    id: uid('col_'),
    name: c.name,
    type: c.type,
    pk: c.pk ?? false,
    nullable: c.nullable ?? !c.pk,
    unique: c.unique ?? false,
    autoIncrement: c.autoIncrement ?? false,
    ...(c.default !== undefined ? { default: c.default } : {}),
    ...(c.comment ? { comment: c.comment } : {}),
  })
  const defaultPk = (): Column =>
    s.dialect === 'postgresql'
      ? { id: uid('col_'), name: 'id', type: 'uuid', pk: true, nullable: false, unique: false, autoIncrement: false, default: 'gen_random_uuid()' }
      : { id: uid('col_'), name: 'id', type: 'integer', pk: true, nullable: false, unique: false, autoIncrement: true }

  ops.forEach((op, i) => {
    try {
      switch (op.op) {
        case 'add_table': {
          const d = op.table
          ensureUniqueTable(d.name)
          const cols = d.columns?.length ? d.columns.map(newColumn) : [defaultPk()]
          const names = new Set<string>()
          for (const c of cols) {
            if (names.has(lower(c.name))) throw new OpError(`columna «${c.name}» repetida`)
            names.add(lower(c.name))
          }
          if (d.near) table(d.near)
          const t: Table = {
            id: uid('tbl_'),
            name: d.name,
            color: d.color ?? TABLE_COLORS[s.tables.length % TABLE_COLORS.length],
            ...(d.comment ? { comment: d.comment } : {}),
            columns: cols,
            indexes: [],
            position: d.position ?? { x: 0, y: 0 },
          }
          s.tables.push(t)
          if (!d.position) toPlace.push({ table: t, near: d.near })
          changes.push(`+ tabla ${t.name} (${cols.map((c) => c.name).join(', ')})`)
          touch('table', t.id, t.name)
          break
        }
        case 'update_table': {
          const t = table(op.table)
          const parts: string[] = []
          if (op.set.name !== undefined && op.set.name !== t.name) {
            ensureUniqueTable(op.set.name, t.id)
            parts.push(`renombrada a ${op.set.name}`)
            t.name = op.set.name
          }
          if (op.set.color !== undefined) t.color = op.set.color
          if (op.set.comment !== undefined) {
            if (op.set.comment === null || op.set.comment === '') delete t.comment
            else t.comment = op.set.comment
            parts.push('comentario')
          }
          if (op.set.position) t.position = op.set.position
          changes.push(`~ tabla ${op.table}${parts.length ? `: ${parts.join(', ')}` : ''}`)
          touch('table', t.id, t.name)
          break
        }
        case 'remove_table': {
          const t = table(op.table)
          const rels = s.relations.filter((r) => r.sourceTableId === t.id || r.targetTableId === t.id).length
          const trgs = s.triggers.filter((x) => x.tableId === t.id).length
          s.tables = s.tables.filter((x) => x.id !== t.id)
          s.relations = s.relations.filter((r) => r.sourceTableId !== t.id && r.targetTableId !== t.id)
          s.triggers = s.triggers.filter((x) => x.tableId !== t.id)
          s.views.forEach((v) => (v.sourceIds = v.sourceIds.filter((id) => id !== t.id)))
          changes.push(`- tabla ${t.name}${rels || trgs ? ` (y ${rels} relaciones, ${trgs} triggers)` : ''}`)
          break
        }
        case 'add_column': {
          const t = table(op.table)
          ensureUniqueColumn(t, op.column.name)
          const c = newColumn(op.column)
          if (op.after) {
            const idx = t.columns.indexOf(column(t, op.after))
            t.columns.splice(idx + 1, 0, c)
          } else t.columns.push(c)
          changes.push(`+ ${t.name}.${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.nullable ? '' : ' NOT NULL'}${c.default !== undefined ? ` DEFAULT ${c.default}` : ''}`)
          touch('table', t.id, t.name)
          break
        }
        case 'update_column': {
          const t = table(op.table)
          const c = column(t, op.column)
          const before = c.name
          const set = op.set
          if (set.name !== undefined && set.name !== c.name) {
            ensureUniqueColumn(t, set.name, c.id)
            c.name = set.name
          }
          if (set.type !== undefined) c.type = set.type
          if (set.pk !== undefined) c.pk = set.pk
          if (set.nullable !== undefined) c.nullable = set.nullable
          if (set.unique !== undefined) c.unique = set.unique
          if (set.autoIncrement !== undefined) c.autoIncrement = set.autoIncrement
          if (set.default !== undefined) {
            if (set.default === null) delete c.default
            else c.default = set.default
          }
          if (set.comment !== undefined) {
            if (set.comment === null || set.comment === '') delete c.comment
            else c.comment = set.comment
          }
          if (c.pk && c.nullable) c.nullable = false
          const fields = Object.keys(set).filter((k) => set[k as keyof typeof set] !== undefined)
          changes.push(`~ ${t.name}.${before}: ${fields.join(', ')}`)
          touch('table', t.id, t.name)
          break
        }
        case 'remove_column': {
          const t = table(op.table)
          const c = column(t, op.column)
          if (t.columns.length === 1) throw new OpError(`«${c.name}» es la única columna de «${t.name}»; elimina la tabla`)
          const rels = s.relations.filter((r) => r.sourceColumnId === c.id || r.targetColumnId === c.id).length
          t.columns = t.columns.filter((x) => x.id !== c.id)
          t.indexes = t.indexes
            .map((ix) => ({ ...ix, columnIds: ix.columnIds.filter((id) => id !== c.id) }))
            .filter((ix) => ix.columnIds.length > 0)
          s.relations = s.relations.filter((r) => r.sourceColumnId !== c.id && r.targetColumnId !== c.id)
          changes.push(`- ${t.name}.${c.name}${rels ? ` (y ${rels} relaciones)` : ''}`)
          touch('table', t.id, t.name)
          break
        }
        case 'move_column': {
          const t = table(op.table)
          const c = column(t, op.column)
          if (op.to === undefined && op.after === undefined) throw new OpError('indica «to» (posición) o «after» (columna)')
          const rest = t.columns.filter((x) => x.id !== c.id)
          let at = op.to ?? 0
          if (op.after !== undefined) {
            const after = column(t, op.after)
            if (after.id === c.id) throw new OpError('«after» no puede ser la misma columna')
            at = rest.indexOf(after) + 1
          }
          at = Math.min(at, rest.length)
          rest.splice(at, 0, c)
          t.columns = rest
          changes.push(`~ ${t.name}.${c.name} movida a la posición ${at}`)
          touch('table', t.id, t.name)
          break
        }
        case 'add_index': {
          const t = table(op.table)
          const cols = op.index.columns.map((k) => column(t, k))
          const name = op.index.name ?? `${t.name}_${cols.map((c) => c.name).join('_')}_${op.index.unique ? 'key' : 'idx'}`.slice(0, 63)
          if (t.indexes.some((ix) => lower(ix.name) === lower(name))) throw new OpError(`ya existe el índice «${name}» en «${t.name}»`)
          const ix: Index = { id: uid('idx_'), name, columnIds: cols.map((c) => c.id), unique: op.index.unique ?? false }
          t.indexes.push(ix)
          changes.push(`+ índice ${name} en ${t.name}(${cols.map((c) => c.name).join(', ')})`)
          touch('table', t.id, t.name)
          break
        }
        case 'remove_index': {
          const t = table(op.table)
          const ix = byName(t.indexes, op.index)
          if (!ix) throw new OpError(`la tabla «${t.name}» no tiene el índice «${op.index}»`)
          t.indexes = t.indexes.filter((x) => x.id !== ix.id)
          changes.push(`- índice ${ix.name} de ${t.name}`)
          touch('table', t.id, t.name)
          break
        }
        case 'add_relation': {
          const d = op.relation
          const st = table(d.source.table)
          const sc = column(st, d.source.column)
          const tt = table(d.target.table)
          let tc = byName(tt.columns, d.target.column)
          if (!tc) {
            if (!d.createColumn) throw new OpError(`la tabla «${tt.name}» no tiene la columna «${d.target.column}» (usa createColumn: true para crearla)`)
            tc = { id: uid('col_'), name: d.target.column, type: fkTypeFor(sc), pk: false, nullable: true, unique: false, autoIncrement: false }
            tt.columns.push(tc)
            changes.push(`+ ${tt.name}.${tc.name} ${tc.type}`)
          }
          if (s.relations.some((r) => r.sourceColumnId === sc.id && r.targetColumnId === tc!.id)) {
            throw new OpError(`ya existe la relación ${st.name}.${sc.name} → ${tt.name}.${tc.name}`)
          }
          const rel: Relation = {
            id: uid('rel_'),
            ...(d.name ? { name: d.name } : {}),
            sourceTableId: st.id,
            sourceColumnId: sc.id,
            targetTableId: tt.id,
            targetColumnId: tc.id,
            cardinality: d.cardinality ?? '1:N',
            onDelete: d.onDelete ?? 'NO ACTION',
            onUpdate: d.onUpdate ?? 'NO ACTION',
          }
          s.relations.push(rel)
          changes.push(`+ relación ${st.name}.${sc.name} → ${tt.name}.${tc.name} (${rel.cardinality})`)
          touch('table', tt.id, tt.name)
          break
        }
        case 'update_relation': {
          const r = relationOf(op.relation)
          if (op.set.name !== undefined) {
            if (op.set.name) r.name = op.set.name
            else delete r.name
          }
          if (op.set.cardinality) r.cardinality = op.set.cardinality
          if (op.set.onDelete) r.onDelete = op.set.onDelete
          if (op.set.onUpdate) r.onUpdate = op.set.onUpdate
          changes.push(`~ relación ${op.relation}`)
          break
        }
        case 'remove_relation': {
          const r = relationOf(op.relation)
          s.relations = s.relations.filter((x) => x.id !== r.id)
          changes.push(`- relación ${op.relation}`)
          break
        }
        case 'upsert_enum': {
          const d = op.enum
          const existing = byName(s.enums, d.name)
          if (existing) {
            if (d.rename && d.rename !== existing.name) {
              if (s.enums.some((e) => e.id !== existing.id && lower(e.name) === lower(d.rename!))) throw new OpError(`ya existe el enum «${d.rename}»`)
              // Las columnas que usan el enum siguen apuntando a él.
              for (const t of s.tables) for (const c of t.columns) if (c.type === existing.name) c.type = d.rename
              existing.name = d.rename
            }
            existing.values = [...d.values]
            changes.push(`~ enum ${existing.name} (${d.values.join(', ')})`)
          } else {
            s.enums.push({ id: uid('enum_'), name: d.name, values: [...d.values] })
            changes.push(`+ enum ${d.name} (${d.values.join(', ')})`)
          }
          break
        }
        case 'remove_enum': {
          const e = byName(s.enums, op.enum)
          if (!e) throw new OpError(`no existe el enum «${op.enum}»`)
          const users = s.tables.flatMap((t) => t.columns.filter((c) => c.type === e.name).map((c) => `${t.name}.${c.name}`))
          if (users.length) throw new OpError(`el enum «${e.name}» lo usan ${users.join(', ')}; cambia antes su tipo`)
          s.enums = s.enums.filter((x) => x.id !== e.id)
          changes.push(`- enum ${e.name}`)
          break
        }
        case 'upsert_view': {
          const d = op.view
          const existing = byName(s.views, d.name)
          const finalName = d.rename ?? d.name
          ensureUniqueTable(finalName, existing?.id)
          const sourceIds = d.sources
            ? d.sources.map((k) => {
                const rel = relOrView(k)
                if (!rel) throw new OpError(`la vista usa «${k}», que no es una tabla ni una vista`)
                return rel.id
              })
            : resolveViewSources(d.definition, s.tables, s.views.filter((v) => v.id !== existing?.id))
          const sources = s.tables.filter((t) => sourceIds.includes(t.id))
          const columns = d.columns ?? inferViewColumns(d.definition, sources)
          if (existing) {
            existing.name = finalName
            existing.definition = d.definition
            if (d.materialized !== undefined) existing.materialized = d.materialized
            if (d.comment !== undefined) {
              if (d.comment) existing.comment = d.comment
              else delete existing.comment
            }
            if (d.color) existing.color = d.color
            existing.sourceIds = sourceIds
            existing.columns = columns
            changes.push(`~ vista ${finalName}`)
            touch('view', existing.id, finalName)
          } else {
            const anchor = sources[0]?.position ?? { x: 0, y: 0 }
            const v: View = {
              id: uid('view_'),
              name: finalName,
              definition: d.definition,
              materialized: d.materialized ?? false,
              sourceIds,
              columns,
              color: d.color ?? VIEW_COLOR,
              ...(d.comment ? { comment: d.comment } : {}),
              position: freeCanvasSpot(s, { x: anchor.x + 340, y: anchor.y }),
            }
            s.views.push(v)
            changes.push(`+ vista ${v.materialized ? 'materializada ' : ''}${finalName}`)
            touch('view', v.id, finalName)
          }
          break
        }
        case 'remove_view': {
          const v = byName(s.views, op.view)
          if (!v) throw new OpError(`no existe la vista «${op.view}»`)
          s.views = s.views.filter((x) => x.id !== v.id)
          s.views.forEach((x) => (x.sourceIds = x.sourceIds.filter((id) => id !== v.id)))
          s.triggers = s.triggers.filter((t) => t.tableId !== v.id)
          changes.push(`- vista ${v.name}`)
          break
        }
        case 'upsert_function': {
          const d = op.function
          const existing = byName(s.functions, d.name)
          const finalName = d.rename ?? d.name
          if (s.functions.some((f) => f.id !== existing?.id && lower(f.name) === lower(finalName))) throw new OpError(`ya existe la función «${finalName}»`)
          if (existing) {
            existing.name = finalName
            existing.body = d.body
            if (d.language) existing.language = d.language
            if (d.args !== undefined) existing.args = d.args
            if (d.returns !== undefined) existing.returns = d.returns
            if (d.comment !== undefined) {
              if (d.comment) existing.comment = d.comment
              else delete existing.comment
            }
            changes.push(`~ función ${finalName}`)
            touch('function', existing.id, finalName)
          } else {
            const f = {
              id: uid('fn_'),
              name: finalName,
              language: d.language ?? 'plpgsql',
              args: d.args ?? '',
              returns: d.returns ?? 'trigger',
              body: d.body,
              ...(d.comment ? { comment: d.comment } : {}),
              position: freeSpot(s, { x: 640, y: 40 }),
            }
            s.functions.push(f)
            changes.push(`+ función ${finalName}`)
            touch('function', f.id, finalName)
          }
          break
        }
        case 'remove_function': {
          const f = byName(s.functions, op.function)
          if (!f) throw new OpError(`no existe la función «${op.function}»`)
          const trgs = s.triggers.filter((t) => t.functionId === f.id).length
          s.functions = s.functions.filter((x) => x.id !== f.id)
          s.triggers = s.triggers.filter((t) => t.functionId !== f.id)
          changes.push(`- función ${f.name}${trgs ? ` (y ${trgs} triggers)` : ''}`)
          break
        }
        case 'upsert_trigger': {
          const d = op.trigger
          const rel = relOrView(d.table)
          if (!rel) throw new OpError(`no existe la tabla o vista «${d.table}»`)
          const fn = byName(s.functions, d.function)
          if (!fn) throw new OpError(`no existe la función «${d.function}» (créala antes con upsert_function)`)
          if (d.timing === 'INSTEAD OF' && !s.views.some((v) => v.id === rel.id)) throw new OpError('INSTEAD OF solo vale para vistas')
          const existing = s.triggers.find((t) => lower(t.name) === lower(d.name) && t.tableId === rel.id)
          const fields: Omit<Trigger, 'id' | 'position'> = {
            name: d.name,
            tableId: rel.id,
            functionId: fn.id,
            timing: d.timing,
            events: [...new Set(d.events)],
            level: d.level ?? existing?.level ?? 'ROW',
            ...(d.condition ? { condition: d.condition } : d.condition === undefined && existing?.condition ? { condition: existing.condition } : {}),
            ...((d.enabled ?? existing?.enabled) === false ? { enabled: false } : {}),
          }
          if (existing) {
            const { id, position } = existing
            for (const k of Object.keys(existing)) delete (existing as unknown as Record<string, unknown>)[k]
            Object.assign(existing, { id, ...fields, position })
            changes.push(`~ trigger ${d.name} en ${rel.name}`)
            touch('trigger', id, d.name)
          } else {
            const t: Trigger = { id: uid('trg_'), ...fields, position: freeSpot(s, { x: 320, y: 40 }) }
            s.triggers.push(t)
            changes.push(`+ trigger ${d.name} ${d.timing} ${fields.events.join('/')} en ${rel.name} → ${fn.name}()`)
            touch('trigger', t.id, d.name)
          }
          break
        }
        case 'remove_trigger': {
          const tableId = op.table ? relOrView(op.table)?.id : undefined
          if (op.table && !tableId) throw new OpError(`no existe la tabla o vista «${op.table}»`)
          const matches = s.triggers.filter((t) => (t.id === op.trigger || lower(t.name) === lower(op.trigger)) && (!tableId || t.tableId === tableId))
          if (!matches.length) throw new OpError(`no existe el trigger «${op.trigger}»`)
          if (matches.length > 1) throw new OpError(`hay varios triggers «${op.trigger}»; indica «table»`)
          s.triggers = s.triggers.filter((t) => t.id !== matches[0].id)
          changes.push(`- trigger ${matches[0].name}`)
          break
        }
        case 'add_note': {
          if (op.note.near) table(op.note.near)
          const id = uid('note_')
          s.notes.push({ id, text: op.note.text, color: op.note.color ?? NOTE_COLOR, position: { x: 0, y: 0 } })
          notesToPlace.push({ id, near: op.note.near })
          changes.push(`+ nota «${op.note.text.slice(0, 60)}»`)
          break
        }
      }
    } catch (err) {
      if (err instanceof OpError) errors.push(`#${i + 1} ${op.op}: ${err.message}`)
      else throw err
    }
  })

  if (!errors.length) {
    placeTables(s, toPlace)
    for (const n of notesToPlace) {
      const note = s.notes.find((x) => x.id === n.id)!
      const anchor = n.near ? byName(s.tables, n.near)?.position : undefined
      note.position = freeCanvasSpot(s, anchor ? { x: anchor.x, y: anchor.y - 140 } : rightOf(s))
    }
  }
  return { schema: s, changes, errors, focus }
}

/* ───────────────────────── Posiciones en el lienzo ───────────────────────── */

const NODE_W = 280
const GAP = 60

const tableHeight = (t: Pick<Table, 'columns'>) => 56 + 30 * Math.max(1, t.columns.length)

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function occupied(s: Schema, except?: string): Rect[] {
  return [
    ...s.tables.filter((t) => t.id !== except).map((t) => ({ ...t.position, w: NODE_W, h: tableHeight(t) })),
    ...s.views.filter((v) => v.id !== except).map((v) => ({ ...v.position, w: NODE_W, h: 56 + 26 * Math.max(1, v.columns.length) })),
    ...s.notes.filter((n) => n.id !== except).map((n) => ({ ...n.position, w: 220, h: 120 })),
  ]
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + GAP / 2 && b.x < a.x + a.w + GAP / 2 && a.y < b.y + b.h + GAP / 2 && b.y < a.y + a.h + GAP / 2

/** Primer hueco libre bajando desde `p` (y si no, a la derecha). */
function freeCanvasSpot(s: Schema, p: Position, size = { w: NODE_W, h: 200 }, except?: string): Position {
  const rects = occupied(s, except)
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 30; row++) {
      const cand = { x: p.x + col * (NODE_W + GAP), y: p.y + row * 80, ...size }
      if (!rects.some((r) => overlaps(cand, r))) return { x: Math.round(cand.x), y: Math.round(cand.y) }
    }
  }
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

function rightOf(s: Schema): Position {
  const rects = occupied(s).filter((r) => r.x > -1e8 && (r.x !== 0 || r.y !== 0))
  if (!rects.length) return { x: 80, y: 80 }
  return { x: Math.max(...rects.map((r) => r.x + r.w)) + GAP * 2, y: Math.min(...rects.map((r) => r.y)) }
}

/** Coloca las tablas nuevas cerca de su tabla relacionada (o de `near`); si no tienen, a la derecha del diagrama. */
function placeTables(s: Schema, pending: { table: Table; near?: string }[]) {
  const pendingIds = new Set(pending.map((p) => p.table.id))
  // Se apartan del cálculo mientras no tengan sitio.
  for (const p of pending) p.table.position = { x: -1e9, y: -1e9 }
  for (const { table, near } of pending) {
    let anchor: Table | undefined = near ? byName(s.tables, near) : undefined
    if (!anchor) {
      const relatedId = s.relations
        .filter((r) => r.sourceTableId === table.id || r.targetTableId === table.id)
        .map((r) => (r.sourceTableId === table.id ? r.targetTableId : r.sourceTableId))
        .find((id) => id !== table.id && (!pendingIds.has(id) || s.tables.find((t) => t.id === id)!.position.x > -1e8))
      anchor = relatedId ? s.tables.find((t) => t.id === relatedId) : undefined
    }
    const size = { w: NODE_W, h: tableHeight(table) }
    table.position = anchor
      ? freeCanvasSpot(s, { x: anchor.position.x + NODE_W + GAP * 2, y: anchor.position.y }, size, table.id)
      : freeCanvasSpot(s, rightOf(s), size, table.id)
  }
}
