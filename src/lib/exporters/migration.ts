// Migración SQL (ALTER) entre dos esquemas: útil para comparar versiones/ramas
// o el borrador con una BD remota introspeccionada.
// Empareja tablas/columnas por id y, si no hay coincidencia, por nombre (insensible a mayúsculas).
import type { Column, DbFunction, Dialect, Schema, Table, Trigger, View } from '@/types/schema'

import { orderViews } from '@/lib/importers/views'

import {
  DIALECT_LABELS,
  columnTypeSQL,
  findEnum,
  indexName,
  lineComment,
  mapDefault,
  pkConstraintName,
  quoteIdent,
  relationConstraintName,
  resolveRelations,
  sqlString,
  uniqueConstraintName,
  type ResolvedRelation,
} from './dialects'
import {
  addForeignKeySQL,
  columnDefinitionSQL,
  createIndexSQL,
  createTableSQL,
  createViewSQL,
  dropViewSQL,
  triggerStateSQL,
  orderTables,
  triggerSQL,
} from './sql'

export interface MigrationSummary {
  createdTables: string[]
  droppedTables: string[]
  renamedTables: { from: string; to: string }[]
  alteredTables: string[]
  createdViews: string[]
  droppedViews: string[]
  dataMigrations: number
  addedRelations: number
  droppedRelations: number
  statements: number
}

export interface MigrationResult {
  sql: string
  /** Sentencias ejecutables (sin comentarios sueltos). */
  statements: string[]
  /** Avisos (operaciones no soportadas por el dialecto, posibles pérdidas de datos...). */
  warnings: string[]
  summary: MigrationSummary
  empty: boolean
}

const norm = (s: string) => s.trim().toLowerCase()

function matchBy<T extends { id: string; name: string }>(from: T[], to: T[]): Map<string, T> {
  const out = new Map<string, T>()
  const used = new Set<string>()
  for (const f of from) {
    const t = to.find((x) => x.id === f.id)
    if (t) {
      out.set(f.id, t)
      used.add(t.id)
    }
  }
  for (const f of from) {
    if (out.has(f.id)) continue
    const t = to.find((x) => !used.has(x.id) && norm(x.name) === norm(f.name))
    if (t) {
      out.set(f.id, t)
      used.add(t.id)
    }
  }
  return out
}

export function computeMigration(from: Schema, to: Schema, dialect: Dialect = to.dialect): MigrationResult {
  const q = (s: string) => quoteIdent(s, dialect)
  const pg = dialect === 'postgresql'
  const my = dialect === 'mysql'
  const lite = dialect === 'sqlite'
  const ms = dialect === 'sqlserver'

  const warnings: string[] = []
  const sections: { title: string; lines: string[] }[] = []
  const section = (title: string) => {
    const s = { title, lines: [] as string[] }
    sections.push(s)
    return s.lines
  }
  const unsupported = (lines: string[], msg: string) => {
    warnings.push(msg)
    lines.push(lineComment(`[${DIALECT_LABELS[dialect]}] ${msg}`))
  }

  const tableMatch = matchBy(from.tables, to.tables)
  const matchedTo = new Set([...tableMatch.values()].map((t) => t.id))
  const created = to.tables.filter((t) => !matchedTo.has(t.id))
  const dropped = from.tables.filter((t) => !tableMatch.has(t.id))
  const renamed = from.tables
    .filter((t) => tableMatch.has(t.id) && tableMatch.get(t.id)!.name !== t.name)
    .map((t) => ({ from: t, to: tableMatch.get(t.id)! }))

  // Mapas de columnas (from.id → to column) por tabla emparejada.
  const colMatch = new Map<string, Column>()
  for (const [fid, tt] of tableMatch) {
    const ft = from.tables.find((t) => t.id === fid)!
    for (const [cid, c] of matchBy(ft.columns, tt.columns)) colMatch.set(cid, c)
  }

  // --- Relaciones ---------------------------------------------------------
  const fromRels = resolveRelations(from)
  const toRels = resolveRelations(to)
  const relSig = (r: ResolvedRelation, side: 'from' | 'to') => {
    const tt = side === 'from' ? (tableMatch.get(r.target.id)?.id ?? `x:${r.target.id}`) : r.target.id
    const tc = side === 'from' ? (colMatch.get(r.targetColumn.id)?.id ?? `x:${r.targetColumn.id}`) : r.targetColumn.id
    const st = side === 'from' ? (tableMatch.get(r.source.id)?.id ?? `x:${r.source.id}`) : r.source.id
    const sc = side === 'from' ? (colMatch.get(r.sourceColumn.id)?.id ?? `x:${r.sourceColumn.id}`) : r.sourceColumn.id
    return `${tt}.${tc}->${st}.${sc}|${r.rel.onDelete}|${r.rel.onUpdate}`
  }
  const toSigs = new Set(toRels.map((r) => relSig(r, 'to')))
  const fromSigs = new Set(fromRels.map((r) => relSig(r, 'from')))
  const removedRels = fromRels.filter((r) => !toSigs.has(relSig(r, 'from')))
  const addedRels = toRels.filter((r) => !fromSigs.has(relSig(r, 'to')))

  // --- Triggers / funciones (solo PostgreSQL) ------------------------------
  const fnSig = (f: DbFunction) => `${f.args}|${f.returns}|${f.language}|${f.body.trim()}`
  const trgSig = (s: Schema, t: Trigger) => {
    // La tabla se identifica por su nombre en `to` (un renombrado no obliga a recrear el trigger).
    const table = (s === from ? tableMatch.get(t.tableId)?.name : undefined) ?? s.tables.find((x) => x.id === t.tableId)?.name ?? ''
    const fn = s.functions.find((x) => x.id === t.functionId)?.name ?? ''
    return `${norm(table)}|${t.timing}|${[...t.events].sort().join(',')}|${t.level}|${t.condition ?? ''}|${fn}`
  }
  const changedFns = to.functions.filter((f) => {
    const old = from.functions.find((x) => norm(x.name) === norm(f.name))
    return !old || fnSig(old) !== fnSig(f)
  })
  const removedFns = from.functions.filter((f) => !to.functions.some((x) => norm(x.name) === norm(f.name)))
  const removedTrgs = from.triggers.filter((t) => {
    const nt = to.triggers.find((x) => norm(x.name) === norm(t.name))
    return !nt || trgSig(from, t) !== trgSig(to, nt)
  })
  const addedTrgs = to.triggers.filter((t) => {
    const ot = from.triggers.find((x) => norm(x.name) === norm(t.name))
    return !ot || trgSig(from, ot) !== trgSig(to, t)
  })
  // En MySQL el cuerpo va incrustado en el trigger: si cambia la función, se recrean sus triggers.
  if (my) {
    const changedIds = new Set(changedFns.map((f) => f.id))
    for (const t of to.triggers) {
      if (!changedIds.has(t.functionId) || addedTrgs.includes(t)) continue
      addedTrgs.push(t)
      const old = from.triggers.find((x) => norm(x.name) === norm(t.name))
      if (old && !removedTrgs.includes(old)) removedTrgs.push(old)
    }
  }

  // --- Vistas ---------------------------------------------------------------
  // Se recrean (DROP + CREATE) si cambia su definición, si dependen de una vista recreada
  // o si leen de una tabla que se elimina o cuyas columnas se eliminan/renombran/cambian de tipo.
  const fromViews = from.views ?? []
  const toViews = to.views ?? []
  const touchedTables = new Set<string>(dropped.map((t) => t.id))
  for (const [fid, tt] of tableMatch) {
    const ft = from.tables.find((t) => t.id === fid)!
    const cm = matchBy(ft.columns, tt.columns)
    const touched = ft.columns.some((c) => {
      const m = cm.get(c.id)
      return !m || m.name !== c.name || columnTypeSQL(from, c, dialect) !== columnTypeSQL(to, m, dialect)
    })
    if (touched) touchedTables.add(fid)
  }
  const viewMatch = matchBy(fromViews, toViews)
  const viewSig = (v: View) => `${v.materialized}|${v.definition.trim().replace(/;+\s*$/, '').replace(/\s+/g, ' ')}`
  const recreate = new Set<string>() // ids de `from` a eliminar
  for (const v of fromViews) {
    const m = viewMatch.get(v.id)
    if (!m || m.name !== v.name || viewSig(m) !== viewSig(v) || v.sourceIds.some((s) => touchedTables.has(s))) recreate.add(v.id)
  }
  // Cierre transitivo: las vistas que leen de una vista recreada también se recrean.
  for (let changed = true; changed; ) {
    changed = false
    for (const v of fromViews) {
      if (!recreate.has(v.id) && v.sourceIds.some((s) => recreate.has(s))) {
        recreate.add(v.id)
        changed = true
      }
    }
  }
  const viewsToDrop = orderViews(fromViews.filter((v) => recreate.has(v.id))).reverse()
  const keptToIds = new Set(fromViews.filter((v) => !recreate.has(v.id)).map((v) => viewMatch.get(v.id)!.id))
  const viewsToCreate = orderViews(toViews.filter((v) => !keptToIds.has(v.id)))
  if (viewsToDrop.length) section('Vistas eliminadas o a recrear').push(...viewsToDrop.map((v) => dropViewSQL(v, dialect, false)))

  // --- Migraciones de datos (pistas registradas, p. ej., por la normalización) ---
  const fromHintIds = new Set((from.dataMigrations ?? []).map((h) => h.id))
  const newHints = (to.dataMigrations ?? []).filter((h) => !fromHintIds.has(h.id))
  const covered = new Set(newHints.flatMap((h) => h.sourceColumns.map(norm)))
  const isCovered = (table: string, column: string) => covered.has(norm(`${table}.${column}`)) || covered.has(norm(`${table}.*`))
  // Los DROP de columnas y tablas se aplazan hasta después de copiar los datos.
  const dropColumnLines: string[] = []
  const dropTableLines: string[] = []

  // 1. Quitar triggers y FKs que desaparecen o cambian.
  if ((pg || my) && removedTrgs.length) {
    const l = section('Triggers eliminados o modificados')
    for (const t of removedTrgs) {
      const table = from.tables.find((x) => x.id === t.tableId)
      if (!table) continue
      if (pg) l.push(`DROP TRIGGER IF EXISTS ${q(t.name)} ON ${q(table.name)};`)
      else {
        // El generador de MySQL crea un trigger por evento (nombre_evento) cuando hay varios.
        const names = t.events.length > 1 ? t.events.map((e) => `${t.name}_${e.toLowerCase()}`) : [t.name]
        for (const n of names) l.push(`DROP TRIGGER IF EXISTS ${q(n)};`)
      }
    }
  }
  if (removedRels.length) {
    const l = section('Claves foráneas eliminadas o modificadas')
    for (const r of removedRels) {
      const name = q(relationConstraintName(from, r.rel))
      if (lite) unsupported(l, `No se puede eliminar la FK ${relationConstraintName(from, r.rel)} sin recrear ${r.target.name}.`)
      else if (my) l.push(`ALTER TABLE ${q(r.target.name)} DROP FOREIGN KEY ${name};`)
      else l.push(`ALTER TABLE ${q(r.target.name)} DROP CONSTRAINT ${name};`)
    }
  }

  // 2. Índices eliminados (en tablas que se mantienen).
  const idxSig = (t: Table, i: Table['indexes'][number], useMatch: boolean) =>
    `${i.unique}|${i.columnIds
      .map((id) => {
        if (!useMatch) return norm(t.columns.find((c) => c.id === id)?.name ?? id)
        const m = colMatch.get(id)
        return norm(m?.name ?? t.columns.find((c) => c.id === id)?.name ?? id)
      })
      .join(',')}`
  {
    const l: string[] = []
    for (const [fid, tt] of tableMatch) {
      const ft = from.tables.find((t) => t.id === fid)!
      const keep = new Set(tt.indexes.map((i) => idxSig(tt, i, false)))
      for (const i of ft.indexes) {
        if (keep.has(idxSig(ft, i, true))) continue
        const n = q(indexName(ft, i))
        if (my || ms) l.push(`DROP INDEX ${n} ON ${q(ft.name)};`)
        else l.push(`DROP INDEX ${n};`)
      }
    }
    if (l.length) section('Índices eliminados').push(...l)
  }

  // 3. Tablas eliminadas (se emiten al final, tras la migración de datos).
  if (dropped.length) {
    for (const t of [...orderTables({ ...from, tables: dropped })].reverse()) dropTableLines.push(`DROP TABLE ${q(t.name)};`)
    const lost = dropped.filter((t) => !t.columns.every((c) => c.pk || isCovered(t.name, c.name)))
    if (lost.length) warnings.push(`Se eliminan ${lost.length} tabla(s) con sus datos: ${lost.map((t) => t.name).join(', ')}.`)
  }

  // 4. Enums nuevos / modificados.
  const enumChanged = new Set<string>()
  {
    const l: string[] = []
    for (const e of to.enums) {
      const old = from.enums.find((x) => norm(x.name) === norm(e.name))
      if (!old) {
        if (pg) l.push(`CREATE TYPE ${q(e.name)} AS ENUM (${e.values.map(sqlString).join(', ')});`)
        continue
      }
      if (old.values.join('\u0000') === e.values.join('\u0000')) continue
      enumChanged.add(norm(e.name))
      if (pg) {
        const added = e.values.filter((v) => !old.values.includes(v))
        const removed = old.values.filter((v) => !e.values.includes(v))
        for (const v of added) l.push(`ALTER TYPE ${q(e.name)} ADD VALUE IF NOT EXISTS ${sqlString(v)};`)
        if (removed.length) unsupported(l, `El enum ${e.name} pierde valores (${removed.join(', ')}): PostgreSQL requiere recrear el tipo.`)
      }
    }
    if (l.length) section('Tipos enumerados').push(...l)
  }

  // 5. Renombrar tablas.
  if (renamed.length) {
    const l = section('Tablas renombradas')
    for (const r of renamed) {
      if (my) l.push(`RENAME TABLE ${q(r.from.name)} TO ${q(r.to.name)};`)
      else if (ms) l.push(`EXEC sp_rename ${sqlString(r.from.name)}, ${sqlString(r.to.name)};`)
      else l.push(`ALTER TABLE ${q(r.from.name)} RENAME TO ${q(r.to.name)};`)
    }
  }

  // 6. Tablas nuevas.
  if (created.length) {
    const l = section('Tablas nuevas')
    for (const t of orderTables({ ...to, tables: created })) {
      const inline = lite ? toRels.filter((r) => r.target.id === t.id) : []
      l.push(createTableSQL(to, t, dialect, inline))
      if (pg) {
        if (t.comment) l.push(`COMMENT ON TABLE ${q(t.name)} IS ${sqlString(t.comment)};`)
        for (const c of t.columns) if (c.comment) l.push(`COMMENT ON COLUMN ${q(t.name)}.${q(c.name)} IS ${sqlString(c.comment)};`)
      }
      for (const i of t.indexes) {
        const s = createIndexSQL(t, i, dialect)
        if (s) l.push(s)
      }
    }
  }

  // 7. Cambios en tablas existentes.
  const altered: string[] = []
  for (const [fid, tt] of tableMatch) {
    const ft = from.tables.find((t) => t.id === fid)!
    const tn = q(tt.name)
    const l: string[] = []
    const cm = matchBy(ft.columns, tt.columns)
    const matchedCols = new Set([...cm.values()].map((c) => c.id))

    // Columnas eliminadas (se emiten al final, tras la migración de datos)
    for (const c of ft.columns.filter((c) => !cm.has(c.id))) {
      if (ms && c.unique) dropColumnLines.push(`ALTER TABLE ${tn} DROP CONSTRAINT ${q(uniqueConstraintName(ft, c))};`)
      dropColumnLines.push(`ALTER TABLE ${tn} DROP COLUMN ${q(c.name)};`)
      if (!isCovered(ft.name, c.name) && !isCovered(tt.name, c.name))
        warnings.push(`Se elimina la columna ${tt.name}.${c.name} (pérdida de datos).`)
    }

    // Columnas renombradas / modificadas
    for (const fc of ft.columns.filter((c) => cm.has(c.id))) {
      const tc = cm.get(fc.id)!
      const isRenamed = fc.name !== tc.name
      const typeChanged =
        columnTypeSQL(from, fc, dialect) !== columnTypeSQL(to, tc, dialect) ||
        (!!findEnum(to, tc.type) && enumChanged.has(norm(tc.type)) && !pg)
      const nullChanged = (fc.nullable && !fc.pk) !== (tc.nullable && !tc.pk)
      const defChanged = (mapDefault(fc.default, dialect, fc) ?? '') !== (mapDefault(tc.default, dialect, tc) ?? '')
      const uniqueChanged = (fc.unique && !fc.pk) !== (tc.unique && !tc.pk)
      const autoChanged = fc.autoIncrement !== tc.autoIncrement
      const commentChanged = (fc.comment ?? '') !== (tc.comment ?? '')
      const anyDef = typeChanged || nullChanged || defChanged || autoChanged

      if (pg) {
        if (isRenamed) l.push(`ALTER TABLE ${tn} RENAME COLUMN ${q(fc.name)} TO ${q(tc.name)};`)
        const cn = q(tc.name)
        if (typeChanged) {
          const ty = columnTypeSQL(to, tc, dialect)
          l.push(`ALTER TABLE ${tn} ALTER COLUMN ${cn} TYPE ${ty} USING ${cn}::${ty};`)
        }
        if (nullChanged) l.push(`ALTER TABLE ${tn} ALTER COLUMN ${cn} ${tc.nullable && !tc.pk ? 'DROP NOT NULL' : 'SET NOT NULL'};`)
        if (defChanged) {
          const d = mapDefault(tc.default, dialect, tc)
          l.push(`ALTER TABLE ${tn} ALTER COLUMN ${cn} ${d ? `SET DEFAULT ${d}` : 'DROP DEFAULT'};`)
        }
        if (autoChanged)
          l.push(
            `ALTER TABLE ${tn} ALTER COLUMN ${cn} ${tc.autoIncrement ? 'ADD GENERATED BY DEFAULT AS IDENTITY' : 'DROP IDENTITY IF EXISTS'};`,
          )
        if (uniqueChanged) {
          if (tc.unique) l.push(`ALTER TABLE ${tn} ADD CONSTRAINT ${q(uniqueConstraintName(tt, tc))} UNIQUE (${cn});`)
          else l.push(`ALTER TABLE ${tn} DROP CONSTRAINT IF EXISTS ${q(uniqueConstraintName(ft, fc))};`)
        }
        if (commentChanged)
          l.push(`COMMENT ON COLUMN ${tn}.${cn} IS ${tc.comment ? sqlString(tc.comment) : 'NULL'};`)
      } else if (my) {
        const def = columnDefinitionSQL(to, tt, { ...tc, pk: false, nullable: tc.nullable && !tc.pk }, dialect, { skipUnique: true })
        if (anyDef || commentChanged) {
          l.push(isRenamed ? `ALTER TABLE ${tn} CHANGE COLUMN ${q(fc.name)} ${def};` : `ALTER TABLE ${tn} MODIFY COLUMN ${def};`)
        } else if (isRenamed) {
          l.push(`ALTER TABLE ${tn} RENAME COLUMN ${q(fc.name)} TO ${q(tc.name)};`)
        }
        if (uniqueChanged) {
          if (tc.unique) l.push(`ALTER TABLE ${tn} ADD UNIQUE INDEX ${q(tc.name)} (${q(tc.name)});`)
          else l.push(`ALTER TABLE ${tn} DROP INDEX ${q(fc.name)};`)
        }
      } else if (ms) {
        if (isRenamed) l.push(`EXEC sp_rename ${sqlString(`${tt.name}.${fc.name}`)}, ${sqlString(tc.name)}, 'COLUMN';`)
        if (typeChanged || nullChanged)
          l.push(
            `ALTER TABLE ${tn} ALTER COLUMN ${q(tc.name)} ${columnTypeSQL(to, tc, dialect)} ${tc.nullable && !tc.pk ? 'NULL' : 'NOT NULL'};`,
          )
        if (defChanged) unsupported(l, `Cambiar el DEFAULT de ${tt.name}.${tc.name} requiere eliminar su restricción DEFAULT con nombre.`)
        if (autoChanged) unsupported(l, `SQL Server no permite añadir/quitar IDENTITY en ${tt.name}.${tc.name} sin recrear la columna.`)
        if (uniqueChanged) {
          if (tc.unique) l.push(`ALTER TABLE ${tn} ADD CONSTRAINT ${q(uniqueConstraintName(tt, tc))} UNIQUE (${q(tc.name)});`)
          else l.push(`ALTER TABLE ${tn} DROP CONSTRAINT ${q(uniqueConstraintName(ft, fc))};`)
        }
      } else {
        if (isRenamed) l.push(`ALTER TABLE ${tn} RENAME COLUMN ${q(fc.name)} TO ${q(tc.name)};`)
        if (anyDef || uniqueChanged)
          unsupported(l, `Cambiar la definición de ${tt.name}.${tc.name} requiere recrear la tabla en SQLite.`)
      }
    }

    // Columnas nuevas
    for (const c of tt.columns.filter((c) => !matchedCols.has(c.id))) {
      const def = columnDefinitionSQL(to, tt, { ...c, pk: false, nullable: c.nullable && !c.pk }, dialect)
      if (!c.nullable && !c.default && !c.autoIncrement)
        warnings.push(`La columna nueva ${tt.name}.${c.name} es NOT NULL sin DEFAULT: fallará si la tabla tiene filas.`)
      if (lite && (c.unique || c.pk)) unsupported(l, `SQLite no permite ADD COLUMN con UNIQUE/PRIMARY KEY (${tt.name}.${c.name}).`)
      l.push(ms ? `ALTER TABLE ${tn} ADD ${def};` : `ALTER TABLE ${tn} ADD COLUMN ${def};`)
      if (pg && c.comment) l.push(`COMMENT ON COLUMN ${tn}.${q(c.name)} IS ${sqlString(c.comment)};`)
    }

    // Clave primaria
    const fpk = ft.columns.filter((c) => c.pk).map((c) => norm(cm.get(c.id)?.name ?? c.name))
    const tpk = tt.columns.filter((c) => c.pk).map((c) => norm(c.name))
    if (fpk.join(',') !== tpk.join(',')) {
      const cols = tt.columns.filter((c) => c.pk).map((c) => q(c.name)).join(', ')
      if (pg) {
        if (fpk.length) l.push(`ALTER TABLE ${tn} DROP CONSTRAINT IF EXISTS ${q(pkConstraintName(ft))};`)
        if (tpk.length) l.push(`ALTER TABLE ${tn} ADD PRIMARY KEY (${cols});`)
      } else if (my) {
        if (fpk.length) l.push(`ALTER TABLE ${tn} DROP PRIMARY KEY;`)
        if (tpk.length) l.push(`ALTER TABLE ${tn} ADD PRIMARY KEY (${cols});`)
      } else {
        unsupported(l, `Cambiar la clave primaria de ${tt.name} requiere ${ms ? 'conocer el nombre de la restricción' : 'recrear la tabla'}.`)
      }
    }

    // Comentario de tabla
    if ((ft.comment ?? '') !== (tt.comment ?? '')) {
      if (pg) l.push(`COMMENT ON TABLE ${tn} IS ${tt.comment ? sqlString(tt.comment) : 'NULL'};`)
      else if (my) l.push(`ALTER TABLE ${tn} COMMENT = ${sqlString(tt.comment ?? '')};`)
    }

    // Índices nuevos
    const had = new Set(ft.indexes.map((i) => idxSig(ft, i, true)))
    for (const i of tt.indexes) {
      if (had.has(idxSig(tt, i, false))) continue
      const s = createIndexSQL(tt, i, dialect)
      if (s) l.push(s)
    }

    if (l.length) {
      altered.push(tt.name)
      section(`Cambios en ${tt.name}`).push(...l)
    }
  }

  // 7b. Migración de datos: después de crear tablas/columnas y antes de las FKs nuevas y los DROP.
  if (newHints.length) {
    const l = section('Migración de datos')
    const finalTables = new Set(to.tables.map((t) => norm(t.name)))
    for (const h of newHints) {
      const missing = h.requiresTables.filter((t) => !finalTables.has(norm(t)))
      if (missing.length) warnings.push(`La migración de datos «${h.description}» necesita tablas que no existirán: ${missing.join(', ')}.`)
      if (!pg) warnings.push(`La migración de datos «${h.description}» está escrita para PostgreSQL: revísala para ${DIALECT_LABELS[dialect]}.`)
      l.push(`${lineComment(h.description)}\n${h.sql.trim().replace(/;?\s*$/, ';')}`)
    }
  }

  // 8. FKs nuevas.
  {
    const l: string[] = []
    for (const r of addedRels) {
      if (lite && created.some((t) => t.id === r.target.id)) continue // ya van inline
      l.push(addForeignKeySQL(to, r, dialect))
      if (lite) warnings.push(`SQLite: la FK ${relationConstraintName(to, r.rel)} requiere recrear ${r.target.name}.`)
    }
    if (l.length) section('Claves foráneas nuevas').push(...l)
  }

  // 8b. Vistas nuevas o recreadas (después de las tablas, en orden de dependencias).
  if (viewsToCreate.length) section('Vistas').push(...viewsToCreate.map((v) => createViewSQL(v, dialect)))

  // 9. Funciones y triggers.
  if (pg || my) {
    // Se reemiten (CREATE OR REPLACE) también las funciones que usan los triggers nuevos.
    const fnIds = new Set([...changedFns.map((f) => f.id), ...addedTrgs.map((t) => t.functionId)])
    const subset = { ...to, functions: to.functions.filter((f) => fnIds.has(f.id)), triggers: addedTrgs }
    const body = (my ? (addedTrgs.length ? triggerSQL(subset, dialect) : '') : triggerSQL(subset, dialect)).trim()
    if (body) section('Funciones y triggers').push(body)
    if (pg && removedFns.length) {
      const l = section('Funciones eliminadas')
      for (const f of removedFns) l.push(`DROP FUNCTION IF EXISTS ${q(f.name)}(${f.args});`)
    }
  } else if (changedFns.length || addedTrgs.length || removedTrgs.length) {
    const l = section('Funciones y triggers')
    unsupported(l, 'Las funciones/triggers no se traducen a este dialecto.')
  }

  // 9b. Triggers activados/desactivados (sin otros cambios) y triggers nuevos desactivados.
  {
    const l: string[] = []
    for (const t of to.triggers) {
      const was = from.triggers.find((x) => norm(x.name) === norm(t.name))
      const recreated = addedTrgs.includes(t)
      const wantEnabled = t.enabled !== false
      if (recreated ? !wantEnabled : was && (was.enabled !== false) !== wantEnabled) {
        const sql = triggerStateSQL(to, t, wantEnabled, dialect)
        if (sql) l.push(sql)
        else if (!recreated || !wantEnabled) unsupported(l, `${DIALECT_LABELS[dialect]} no permite ${wantEnabled ? 'activar' : 'desactivar'} el trigger ${t.name}.`)
      }
    }
    if (l.length) section('Estado de triggers').push(...l)
  }

  // 9c. Columnas y tablas eliminadas (después de copiar los datos).
  if (dropColumnLines.length) section('Columnas eliminadas').push(...dropColumnLines)
  if (dropTableLines.length) section('Tablas eliminadas').push(...dropTableLines)

  // 10. Enums eliminados (al final, cuando ya nadie los usa).
  if (pg) {
    const gone = from.enums.filter((e) => !to.enums.some((x) => norm(x.name) === norm(e.name)))
    if (gone.length) section('Tipos eliminados').push(...gone.map((e) => `DROP TYPE IF EXISTS ${q(e.name)};`))
  }

  // Cada línea puede llevar comentarios delante (p. ej. migraciones de datos): se cuentan solo las sentencias.
  const statements = sections
    .flatMap((s) => s.lines)
    .map((l) => l.replace(/^(\s*--[^\n]*\n?)+/, '').trim())
    .filter(Boolean)
  const empty = sections.every((s) => s.lines.length === 0)
  const header = lineComment(
    `Migración generada por DB Tracker · ${DIALECT_LABELS[dialect]} · ${new Date().toISOString()}\n` +
      (empty ? 'Sin diferencias estructurales.' : `${statements.length} sentencia(s).`),
  )
  const warn = warnings.length ? '\n' + lineComment('AVISOS:\n' + warnings.map((w) => `  • ${w}`).join('\n')) : ''
  const sql =
    header +
    warn +
    '\n\n' +
    sections
      .filter((s) => s.lines.length)
      .map((s) => `${lineComment(s.title)}\n${s.lines.join('\n')}`)
      .join('\n\n') +
    '\n'

  return {
    sql,
    statements,
    warnings,
    empty,
    summary: {
      createdTables: created.map((t) => t.name),
      droppedTables: dropped.map((t) => t.name),
      renamedTables: renamed.map((r) => ({ from: r.from.name, to: r.to.name })),
      alteredTables: altered,
      createdViews: viewsToCreate.map((v) => v.name),
      droppedViews: viewsToDrop.map((v) => v.name),
      dataMigrations: newHints.length,
      addedRelations: addedRels.length,
      droppedRelations: removedRels.length,
      statements: statements.length,
    },
  }
}

/** SQL de migración (ALTER/CREATE/DROP) para pasar de `from` a `to`. */
export function generateMigration(from: Schema, to: Schema, dialect: Dialect = to.dialect): string {
  return computeMigration(from, to, dialect).sql
}
