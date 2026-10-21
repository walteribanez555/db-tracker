// Aplicación de planes de corrección. Funciones puras: reciben un esquema y devuelven uno nuevo.
import { uid } from '@/lib/id'
import type { Column, DataMigrationHint, Dialect, Relation, Schema, Table } from '@/types/schema'

import { entityOf } from './names'
import type { FixPlan } from './types'

const TABLE_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#f43f5e', '#06b6d4', '#64748b']

const makeColumn = (partial: Partial<Column>): Column => ({
  id: uid('col_'),
  name: 'columna',
  type: 'varchar(255)',
  pk: false,
  nullable: true,
  unique: false,
  autoIncrement: false,
  ...partial,
})

/** Tipo por defecto para una PK sustituta según el dialecto. */
export function defaultPkType(dialect: Dialect): Pick<Column, 'type' | 'autoIncrement' | 'default'> {
  switch (dialect) {
    case 'mysql':
      return { type: 'bigint', autoIncrement: true }
    case 'sqlite':
      return { type: 'integer', autoIncrement: true }
    case 'sqlserver':
      return { type: 'uniqueidentifier', autoIncrement: false, default: 'NEWID()' }
    default:
      return { type: 'uuid', autoIncrement: false, default: 'gen_random_uuid()' }
  }
}

/** PK más habitual del esquema (para que las tablas nuevas sigan el mismo estilo). */
export function schemaPkStyle(schema: Schema): Column | undefined {
  const counts = new Map<string, { n: number; col: Column }>()
  for (const t of schema.tables) {
    const pk = t.columns.filter((c) => c.pk)
    if (pk.length !== 1) continue
    const key = pk[0].type.toLowerCase()
    const e = counts.get(key)
    counts.set(key, { n: (e?.n ?? 0) + 1, col: e?.col ?? pk[0] })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.col
}

/** PK nueva "parecida" a otra existente (para mantener el estilo del esquema). */
function pkLike(ref: Column | undefined, dialect: Dialect, name = 'id'): Column {
  if (ref) {
    const t = ref.type.toLowerCase()
    if (t.includes('uuid') || t.includes('uniqueidentifier'))
      return makeColumn({ name, type: ref.type, pk: true, nullable: false, default: ref.default ?? defaultPkType(dialect).default })
    if (/serial|int/.test(t)) return makeColumn({ name, type: ref.type, pk: true, nullable: false, autoIncrement: ref.autoIncrement })
  }
  return makeColumn({ name, pk: true, nullable: false, ...defaultPkType(dialect) })
}

/** Tipo de una FK que apunta a `pk` (serial → integer, etc.). */
export function fkTypeFor(pk: Column): string {
  const t = pk.type.toLowerCase()
  if (t === 'serial') return 'integer'
  if (t === 'bigserial') return 'bigint'
  if (t === 'smallserial') return 'smallint'
  return pk.type
}

function freePosition(schema: Schema, near: Table): Table['position'] {
  let x = near.position.x + 360
  let y = near.position.y
  const busy = (px: number, py: number) => schema.tables.some((t) => Math.abs(t.position.x - px) < 300 && Math.abs(t.position.y - py) < 200)
  let guard = 0
  while (busy(x, y) && guard++ < 30) y += 220
  if (guard >= 30) x += 360
  return { x, y }
}

function newTable(schema: Schema, name: string, near: Table, columns: Column[]): Table {
  return {
    id: uid('tbl_'),
    name,
    color: TABLE_COLORS[schema.tables.length % TABLE_COLORS.length],
    columns,
    indexes: [],
    position: freePosition(schema, near),
  }
}

const findTable = (s: Schema, id: string) => {
  const t = s.tables.find((x) => x.id === id)
  if (!t) throw new Error(`Tabla ${id} no encontrada`)
  return t
}

function removeColumns(schema: Schema, table: Table, ids: string[]) {
  const set = new Set(ids)
  table.columns = table.columns.filter((c) => !set.has(c.id))
  table.indexes = table.indexes
    .map((i) => ({ ...i, columnIds: i.columnIds.filter((c) => !set.has(c)) }))
    .filter((i) => i.columnIds.length > 0)
  schema.relations = schema.relations.filter((r) => !set.has(r.sourceColumnId) && !set.has(r.targetColumnId))
}

function relation(partial: Omit<Relation, 'id' | 'cardinality' | 'onDelete' | 'onUpdate'> & Partial<Relation>): Relation {
  return { id: uid('rel_'), cardinality: '1:N', onDelete: 'NO ACTION', onUpdate: 'CASCADE', ...partial }
}

/** Un paso real de un plan de corrección: se aplica sobre un esquema de trabajo (mutándolo). */
export interface FixStep {
  id: string
  label: string
  detail?: string
  kind: 'table' | 'column' | 'relation' | 'index' | 'view' | 'function' | 'sql'
  apply: (schema: Schema) => void
  /** Presente en los pasos "Copiar datos": la migración de datos que se registra en el esquema. */
  hint?: DataMigrationHint
}

// ---------------------------------------------------------------------------
// Migración de datos (PostgreSQL): SQL que preserva los datos al transformar.
// ---------------------------------------------------------------------------

const q = (n: string) => (/^[a-z_][a-z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`)

function hint(description: string, sql: string, sourceColumns: string[], requiresTables: string[]): DataMigrationHint {
  return { id: uid('dm_'), description, sql, sourceColumns, requiresTables }
}

function addHint(add: (step: Omit<FixStep, 'id'>) => void, h: DataMigrationHint) {
  add({
    kind: 'sql',
    label: 'Copiar datos',
    detail: h.description,
    hint: h,
    apply: (s) => void (s.dataMigrations = [...(s.dataMigrations ?? []), structuredClone(h)]),
  })
}

/** Separador de una lista guardada como texto: se detecta por el comentario o el valor por defecto. */
function listSeparator(c: Column): string {
  const text = `${c.comment ?? ''} ${c.default ?? ''}`
  for (const sep of [';', '|', '/']) if (text.includes(sep)) return sep
  return ','
}

/** Expresión que expande los valores de una columna multivaluada (alias `v`). */
function unnestExpr(alias: string, c: Column): { from: string; value: string; filter: string } {
  const col = `${alias}.${q(c.name)}`
  const type = c.type.trim().toLowerCase()
  if (/\[\]$|^_|^array/.test(type)) return { from: `unnest(${col}) AS v`, value: 'v', filter: 'v IS NOT NULL' }
  if (/^jsonb?$/.test(type)) return { from: `jsonb_array_elements_text(${col}::jsonb) AS v`, value: 'trim(v)', filter: "trim(v) <> ''" }
  const sep = listSeparator(c).replace(/'/g, "''")
  return { from: `unnest(string_to_array(${col}, '${sep}')) AS v`, value: 'trim(v)', filter: "trim(v) <> ''" }
}

function multivaluedSql(a: { parent: Table; parentPk: Column[]; child: Table; fkCols: Column[]; valueCol: Column; sourceCols: Column[] }): string {
  const cols = [...a.fkCols.map((c) => q(c.name)), q(a.valueCol.name)].join(', ')
  const keys = a.parentPk.map((pk) => `p.${q(pk.name)}`).join(', ')
  if (a.sourceCols.length > 1) {
    // Grupo repetitivo: una fila por cada columna con valor.
    const values = a.sourceCols.map((c) => `(p.${q(c.name)})`).join(', ')
    return [
      `INSERT INTO ${q(a.child.name)} (${cols})`,
      `SELECT ${keys}, t.v`,
      `FROM ${q(a.parent.name)} p`,
      `CROSS JOIN LATERAL (VALUES ${values}) AS t(v)`,
      `WHERE t.v IS NOT NULL AND trim(t.v::text) <> '';`,
    ].join('\n')
  }
  const c = a.sourceCols[0]
  const { from, value, filter } = unnestExpr('p', c)
  return [
    `INSERT INTO ${q(a.child.name)} (${cols})`,
    `SELECT ${keys}, ${value}`,
    `FROM ${q(a.parent.name)} p, ${from}`,
    `WHERE p.${q(c.name)} IS NOT NULL AND ${filter};`,
  ].join('\n')
}

function entitySql(a: {
  source: Table
  target: Table
  targetPk: Column
  moved: Column[]
  strip: (n: string) => string
  link: Column
  linkExisted: boolean
  targetExisted: boolean
}): string {
  const src = q(a.source.name)
  const tgt = q(a.target.name)
  const pairs = a.moved.map((c) => ({ from: `p.${q(c.name)}`, to: q(a.strip(c.name)) }))
  if (a.linkExisted) {
    // La FK ya identifica la entidad: se crean las filas que falten con su clave y se completan los datos.
    const insert = [
      `INSERT INTO ${tgt} (${[q(a.targetPk.name), ...pairs.map((x) => x.to)].join(', ')})`,
      `SELECT DISTINCT ON (p.${q(a.link.name)}) p.${q(a.link.name)}, ${pairs.map((x) => x.from).join(', ')}`,
      `FROM ${src} p`,
      `WHERE p.${q(a.link.name)} IS NOT NULL`,
      `ON CONFLICT (${q(a.targetPk.name)}) DO NOTHING;`,
    ]
    if (!a.targetExisted) return insert.join('\n')
    const update = [
      `UPDATE ${tgt} e SET ${pairs.map((x) => `${x.to} = COALESCE(e.${x.to}, p.${x.from.slice(2)})`).join(', ')}`,
      `FROM (SELECT DISTINCT ON (${q(a.link.name)}) * FROM ${src}) p`,
      `WHERE e.${q(a.targetPk.name)} = p.${q(a.link.name)};`,
    ]
    return [...insert, '', ...update].join('\n')
  }
  // Sin FK previa: se crean las entidades distintas y se enlaza cada fila con su entidad.
  const match = pairs.map((x) => `e.${x.to} IS NOT DISTINCT FROM ${x.from}`).join('\n     AND ')
  return [
    `INSERT INTO ${tgt} (${pairs.map((x) => x.to).join(', ')})`,
    `SELECT DISTINCT ${pairs.map((x) => x.from).join(', ')}`,
    `FROM ${src} p`,
    // En una entidad existente no se duplican las filas que ya están.
    `WHERE (${pairs.map((x) => `${x.from} IS NOT NULL`).join(' OR ')})` +
      (a.targetExisted ? `\n  AND NOT EXISTS (SELECT 1 FROM ${tgt} e WHERE ${match});` : ';'),
    '',
    `UPDATE ${src} p SET ${q(a.link.name)} = (`,
    `  SELECT e.${q(a.targetPk.name)} FROM ${tgt} e`,
    `   WHERE ${match}`,
    `   LIMIT 1);`,
  ].join('\n')
}

const TEXT = /char|text|string/i

/** Cláusula USING para ALTER COLUMN … TYPE cuando el cambio no es directo (texto → fecha/booleano). */
function castUsing(c: Column, newType: string): string | null {
  const col = q(c.name)
  const to = newType.toLowerCase()
  if (!TEXT.test(c.type)) return null // float → numeric, int → bigint…: conversión directa
  if (to === 'date')
    return [
      `CASE`,
      `    WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN ${col}::date`,
      `    WHEN ${col} ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN to_date(${col}, 'DD/MM/YYYY')`,
      `    WHEN ${col} ~ '^\\d{1,2}-\\d{1,2}-\\d{4}$' THEN to_date(${col}, 'DD-MM-YYYY')`,
      `    ELSE NULL END`,
    ].join('\n')
  if (/timestamp|datetime/.test(to))
    return [
      `CASE`,
      `    WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN ${col}::timestamptz`,
      `    WHEN ${col} ~ '^\\d{1,2}/\\d{1,2}/\\d{4}' THEN to_timestamp(${col}, 'DD/MM/YYYY HH24:MI:SS')`,
      `    ELSE NULL END`,
    ].join('\n')
  if (to === 'boolean')
    return `CASE WHEN lower(trim(${col})) IN ('s', 'si', 'sí', 'y', 'yes', 'true', 't', '1') THEN true\n    WHEN lower(trim(${col})) IN ('n', 'no', 'false', 'f', '0') THEN false ELSE NULL END`
  if (/^(numeric|decimal|int|integer|bigint|smallint|real|double)/.test(to)) return `NULLIF(regexp_replace(${col}, '[^0-9.,-]', '', 'g'), '')::${newType}`
  return `${col}::${newType}`
}

const tableIn = (s: Schema, id: string) => findTable(s, id)

/**
 * Descompone un FixPlan en las transformaciones reales que lo forman (crear tabla, mover columnas,
 * crear relación, índice…). Los ids de lo que se crea se fijan al planificar, de modo que los pasos
 * se pueden aplicar uno a uno (p. ej. animados en el dock) y el resultado es idéntico a `applyFix`.
 */
export function planFix(input: Schema, fix: FixPlan): FixStep[] {
  const schema = input
  const steps: FixStep[] = []
  const add = (step: Omit<FixStep, 'id'>) => steps.push({ ...step, id: `fix-${steps.length + 1}` })

  switch (fix.kind) {
    case 'add-pk': {
      const t = findTable(schema, fix.tableId)
      const existing = t.columns.find((c) => c.name === fix.columnName)
      if (existing)
        add({
          kind: 'column',
          label: 'Marcar clave primaria',
          detail: `${t.name}.${existing.name}`,
          apply: (s) => void Object.assign(tableIn(s, t.id).columns.find((c) => c.id === existing.id)!, { pk: true, nullable: false }),
        })
      else {
        const style = pkLike(schemaPkStyle(schema), schema.dialect, fix.columnName)
        const col = style.type === fix.type ? style : { ...style, type: fix.type, autoIncrement: /serial/i.test(fix.type) }
        add({
          kind: 'column',
          label: 'Añadir clave primaria',
          detail: `${t.name}.${col.name} ${col.type}`,
          apply: (s) => void tableIn(s, t.id).columns.unshift(structuredClone(col)),
        })
      }
      break
    }

    case 'extract-entity': {
      const source = findTable(schema, fix.sourceTableId)
      const moved = source.columns.filter((c) => fix.columnIds.includes(c.id))
      const strip = (n: string) => (fix.stripPrefix && n.startsWith(fix.stripPrefix) && n.length > fix.stripPrefix.length ? n.slice(fix.stripPrefix.length) : n)
      const existingLink = fix.linkColumnId ? source.columns.find((c) => c.id === fix.linkColumnId) : undefined
      const existingTarget = fix.targetTableId ? schema.tables.find((t) => t.id === fix.targetTableId) : undefined

      // 1. Tabla destino (nueva) o PK de la existente.
      let target: Table
      let targetPk: Column
      if (existingTarget) {
        target = existingTarget
        const pk = existingTarget.columns.find((c) => c.pk)
        if (pk) targetPk = pk
        else {
          targetPk = pkLike(schemaPkStyle(schema), schema.dialect)
          const col = targetPk
          add({ kind: 'column', label: 'Añadir clave primaria', detail: `${target.name}.${col.name}`, apply: (s) => void tableIn(s, target.id).columns.unshift(structuredClone(col)) })
        }
      } else {
        const refPk = existingLink ?? source.columns.find((c) => c.pk) ?? schemaPkStyle(schema)
        targetPk = pkLike(refPk, schema.dialect)
        if (existingLink) {
          // La PK de la nueva entidad debe ser compatible con la FK existente.
          targetPk.type = existingLink.type
          targetPk.autoIncrement = false
          targetPk.default = /uuid/i.test(existingLink.type) ? (targetPk.default ?? 'gen_random_uuid()') : undefined
        }
        const created = newTable(schema, fix.newTableName, source, [targetPk])
        target = created
        add({
          kind: 'table',
          label: 'Crear tabla',
          detail: `${created.name} (PK ${targetPk.name} ${targetPk.type})`,
          apply: (s) => void s.tables.push(structuredClone(created)),
        })
      }

      // 2. Columnas en la entidad (sin prefijo).
      const copies = moved
        .map((c) => ({ ...c, id: uid('col_'), name: strip(c.name), pk: false, autoIncrement: false }))
        .filter((c) => !target.columns.some((x) => x.name === c.name))
      if (copies.length)
        add({
          kind: 'column',
          label: 'Añadir columnas',
          detail: `${copies.map((c) => c.name).join(', ')} en ${target.name}`,
          apply: (s) => {
            const t = tableIn(s, target.id)
            for (const c of copies) if (!t.columns.some((x) => x.name === c.name)) t.columns.push(structuredClone(c))
          },
        })

      // 3. FK en el origen si no existía.
      const insertAt = Math.max(0, source.columns.findIndex((c) => fix.columnIds.includes(c.id)))
      const link = existingLink ?? makeColumn({ name: fix.linkColumnName, type: fkTypeFor(targetPk), nullable: true })
      if (!existingLink)
        add({
          kind: 'column',
          label: 'Añadir clave foránea',
          detail: `${source.name}.${link.name} ${link.type}`,
          apply: (s) => {
            const t = tableIn(s, source.id)
            t.columns.splice(Math.min(insertAt, t.columns.length), 0, structuredClone(link))
          },
        })

      // 4. Copiar los datos antes de quitar las columnas de origen.
      addHint(
        add,
        hint(
          `Copiar ${moved.map((c) => c.name).join(', ')} de ${source.name} a ${target.name}`,
          entitySql({ source, target, targetPk, moved, strip, link, linkExisted: !!existingLink, targetExisted: !!existingTarget }),
          moved.map((c) => `${source.name}.${c.name}`),
          [target.name, source.name],
        ),
      )

      // 5. Quitar las columnas del origen.
      add({
        kind: 'column',
        label: 'Quitar columnas',
        detail: `${moved.map((c) => c.name).join(', ')} de ${source.name}`,
        apply: (s) => removeColumns(s, tableIn(s, source.id), fix.columnIds),
      })

      // 6. Relación.
      if (!schema.relations.some((r) => r.targetTableId === source.id && r.targetColumnId === link.id)) {
        const rel = relation({ sourceTableId: target.id, sourceColumnId: targetPk.id, targetTableId: source.id, targetColumnId: link.id, onDelete: 'RESTRICT' })
        add({ kind: 'relation', label: 'Crear relación', detail: `${target.name} → ${source.name}.${link.name}`, apply: (s) => void s.relations.push(structuredClone(rel)) })
      }

      // 7. Índice sobre la FK si no está cubierta (evita el hallazgo "FK sin índice").
      const firstPk = source.columns.find((c) => c.pk)
      const covered = link.unique || firstPk?.id === link.id || source.indexes.some((i) => i.columnIds[0] === link.id)
      if (!covered) {
        const idx = { id: uid('idx_'), name: `idx_${source.name}_${link.name}`, columnIds: [link.id], unique: false }
        add({ kind: 'index', label: 'Crear índice', detail: `${idx.name} (${link.name})`, apply: (s) => void tableIn(s, source.id).indexes.push(structuredClone(idx)) })
      }
      break
    }

    case 'extract-multivalued': {
      const parent = findTable(schema, fix.tableId)
      let parentPk = parent.columns.filter((c) => c.pk)
      if (!parentPk.length) {
        const col = pkLike(schemaPkStyle(schema), schema.dialect)
        parentPk = [col]
        add({ kind: 'column', label: 'Añadir clave primaria', detail: `${parent.name}.${col.name}`, apply: (s) => void tableIn(s, parent.id).columns.unshift(structuredClone(col)) })
      }
      const entity = entityOf(parent.name)
      const fkCols = parentPk.map((pk) =>
        makeColumn({ name: parentPk.length === 1 ? `${entity}_id` : `${entity}_${pk.name}`, type: fkTypeFor(pk), nullable: false }),
      )
      const valueCol = makeColumn({ name: fix.valueColumnName, type: fix.valueType, nullable: false })
      const child = newTable(schema, fix.newTableName, parent, [pkLike(parentPk[0], schema.dialect), ...fkCols, valueCol])
      add({
        kind: 'table',
        label: 'Crear tabla',
        detail: `${child.name} (${child.columns.map((c) => c.name).join(', ')})`,
        apply: (s) => void s.tables.push(structuredClone(child)),
      })
      const rels = parentPk.map((pk, i) =>
        relation({ sourceTableId: parent.id, sourceColumnId: pk.id, targetTableId: child.id, targetColumnId: fkCols[i].id, onDelete: 'CASCADE' }),
      )
      add({
        kind: 'relation',
        label: 'Crear relación',
        detail: `${parent.name} → ${child.name}.${fkCols.map((c) => c.name).join(', ')} (CASCADE)`,
        apply: (s) => void s.relations.push(...structuredClone(rels)),
      })
      const idx = { id: uid('idx_'), name: `idx_${fix.newTableName}_${fkCols[0].name}`, columnIds: fkCols.map((c) => c.id), unique: false }
      add({ kind: 'index', label: 'Crear índice', detail: idx.name, apply: (s) => void tableIn(s, child.id).indexes.push(structuredClone(idx)) })
      const sourceCols = parent.columns.filter((c) => fix.columnIds.includes(c.id))
      addHint(
        add,
        hint(
          `Copiar ${sourceCols.map((c) => c.name).join(', ')} de ${parent.name} a ${child.name}`,
          multivaluedSql({ parent, parentPk, child, fkCols, valueCol, sourceCols }),
          sourceCols.map((c) => `${parent.name}.${c.name}`),
          [child.name, parent.name],
        ),
      )
      add({
        kind: 'column',
        label: 'Quitar columnas',
        detail: `${colNames(parent, fix.columnIds)} de ${parent.name}`,
        apply: (s) => removeColumns(s, tableIn(s, parent.id), fix.columnIds),
      })
      break
    }

    case 'add-index': {
      const t = findTable(schema, fix.tableId)
      if (!t.indexes.some((i) => i.columnIds.join() === fix.columnIds.join())) {
        const idx = { id: uid('idx_'), name: fix.name, columnIds: [...fix.columnIds], unique: false }
        add({ kind: 'index', label: 'Crear índice', detail: `${fix.name} (${colNames(t, fix.columnIds)})`, apply: (s) => void tableIn(s, t.id).indexes.push(structuredClone(idx)) })
      }
      break
    }

    case 'change-type': {
      const t = findTable(schema, fix.tableId)
      const c = t.columns.find((x) => x.id === fix.columnId)
      if (c) {
        // La conversión de datos va en el mismo ALTER (USING): el hint se registra antes de cambiar el tipo.
        const using = castUsing(c, fix.newType)
        if (using)
          addHint(
            add,
            hint(
              `Convertir ${t.name}.${c.name} de ${c.type} a ${fix.newType}`,
              `ALTER TABLE ${q(t.name)} ALTER COLUMN ${q(c.name)} TYPE ${fix.newType}\n  USING ${using};`,
              [],
              [t.name],
            ),
          )
        add({
          kind: 'column',
          label: 'Cambiar tipo',
          detail: `${t.name}.${c.name}: ${c.type} → ${fix.newType}`,
          apply: (s) => {
            const col = tableIn(s, t.id).columns.find((x) => x.id === c.id)
            if (col) col.type = fix.newType
          },
        })
      }
      break
    }

    case 'rename-columns': {
      const t = findTable(schema, fix.tableId)
      for (const r of fix.renames) {
        const c = t.columns.find((x) => x.id === r.columnId)
        if (!c) continue
        const oldName = c.name
        add({
          kind: 'column',
          label: 'Renombrar columna',
          detail: `${t.name}.${oldName} → ${r.newName}`,
          apply: (s) => {
            const col = tableIn(s, t.id).columns.find((x) => x.id === c.id)
            if (!col) return
            // Las vistas que leen de la tabla siguen funcionando tras el renombrado.
            const re = new RegExp(`\\b${escapeRe(col.name)}\\b`, 'g')
            for (const v of (s.views ?? []).filter((v) => v.sourceIds.includes(t.id))) {
              v.definition = v.definition.replace(re, r.newName)
              v.columns = v.columns.map((vc) => (vc.name === col.name ? { ...vc, name: r.newName } : vc))
            }
            col.name = r.newName
          },
        })
      }
      break
    }

    case 'rename-table': {
      const t = findTable(schema, fix.tableId)
      const old = t.name
      const re = () => new RegExp(`\\b${escapeRe(old)}\\b`, 'g')
      add({ kind: 'table', label: 'Renombrar tabla', detail: `${old} → ${fix.newName}`, apply: (s) => void (tableIn(s, t.id).name = fix.newName) })
      const fns = schema.functions.filter((f) => re().test(f.body))
      const views = (schema.views ?? []).filter((v) => v.sourceIds.includes(t.id) && re().test(v.definition))
      if (fns.length || views.length)
        add({
          kind: fns.length ? 'function' : 'view',
          label: 'Actualizar referencias',
          detail: [...fns.map((f) => `${f.name}()`), ...views.map((v) => v.name)].join(', '),
          apply: (s) => {
            // Los cuerpos de funciones y vistas que nombran la tabla se actualizan para no romper triggers.
            for (const f of s.functions) f.body = f.body.replace(re(), fix.newName)
            for (const v of s.views ?? []) if (v.sourceIds.includes(t.id)) v.definition = v.definition.replace(re(), fix.newName)
          },
        })
      break
    }

    case 'drop-view': {
      const v = (schema.views ?? []).find((x) => x.id === fix.viewId)
      const triggers = schema.triggers.filter((t) => t.tableId === fix.viewId)
      add({
        kind: 'view',
        label: 'Eliminar vista',
        detail: `${v?.name ?? '?'}${triggers.length ? ` y ${triggers.length} trigger(s)` : ''}`,
        apply: (s) => {
          s.views = (s.views ?? []).filter((x) => x.id !== fix.viewId)
          for (const x of s.views) x.sourceIds = x.sourceIds.filter((id) => id !== fix.viewId)
          s.triggers = s.triggers.filter((t) => t.tableId !== fix.viewId)
        },
      })
      break
    }

    case 'drop-columns': {
      const t = findTable(schema, fix.tableId)
      add({ kind: 'column', label: 'Eliminar columnas', detail: `${colNames(t, fix.columnIds)} de ${t.name}`, apply: (s) => removeColumns(s, tableIn(s, t.id), fix.columnIds) })
      break
    }
  }
  return steps
}

export function applyFix(input: Schema, fix: FixPlan): Schema {
  const schema = structuredClone(input)
  for (const step of planFix(input, fix)) step.apply(schema)
  return schema
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const colNames = (t: Table | undefined, ids: string[]) =>
  ids.map((id) => t?.columns.find((c) => c.id === id)?.name ?? '?').join(', ')

/** Descripción breve del cambio (se usa como mensaje de commit). */
export function describeFix(schema: Schema, fix: FixPlan): string {
  const name = (id: string) => schema.tables.find((t) => t.id === id)?.name ?? '?'
  const tbl = (id: string) => schema.tables.find((t) => t.id === id)
  switch (fix.kind) {
    case 'add-pk':
      return `añadir clave primaria "${fix.columnName}" a ${name(fix.tableId)}`
    case 'extract-entity': {
      const dest = fix.targetTableId ? name(fix.targetTableId) : fix.newTableName
      return `mover ${colNames(tbl(fix.sourceTableId), fix.columnIds)} de ${name(fix.sourceTableId)} a ${dest}${fix.targetTableId ? '' : ' (tabla nueva)'}`
    }
    case 'extract-multivalued':
      return `extraer ${colNames(tbl(fix.tableId), fix.columnIds)} de ${name(fix.tableId)} a la tabla ${fix.newTableName}`
    case 'add-index':
      return `crear índice ${fix.name} en ${name(fix.tableId)}(${colNames(tbl(fix.tableId), fix.columnIds)})`
    case 'change-type':
      return `cambiar el tipo de ${name(fix.tableId)}.${colNames(tbl(fix.tableId), [fix.columnId])} a ${fix.newType}`
    case 'rename-columns':
      return `renombrar en ${name(fix.tableId)}: ${fix.renames.map((r) => `${colNames(tbl(fix.tableId), [r.columnId])} → ${r.newName}`).join(', ')}`
    case 'rename-table':
      return `renombrar la tabla ${name(fix.tableId)} a ${fix.newName}`
    case 'drop-columns':
      return `eliminar ${colNames(tbl(fix.tableId), fix.columnIds)} (redundante) de ${name(fix.tableId)}`
    case 'drop-view':
      return `eliminar la vista ${(schema.views ?? []).find((v) => v.id === fix.viewId)?.name ?? '?'}`
  }
}

/** Tablas que un plan toca en el esquema original (para el "antes/después"). */
export function fixTableIds(schema: Schema, fix: FixPlan): string[] {
  const ids = new Set<string>()
  switch (fix.kind) {
    case 'extract-entity':
      ids.add(fix.sourceTableId)
      if (fix.targetTableId) ids.add(fix.targetTableId)
      else {
        const link = fix.linkColumnId
        const r = schema.relations.find((x) => x.targetColumnId === link)
        if (r) ids.add(r.sourceTableId)
      }
      break
    case 'extract-multivalued':
    case 'add-pk':
    case 'add-index':
    case 'change-type':
    case 'rename-columns':
    case 'rename-table':
    case 'drop-columns':
      ids.add(fix.tableId)
      break
    case 'drop-view':
      break
  }
  return [...ids]
}
