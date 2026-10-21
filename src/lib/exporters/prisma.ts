// Exportador a schema.prisma.
import type { Column, Dialect, ReferentialAction, Schema, Table } from '@/types/schema'

import { canonicalType, findEnum, parseType, resolveRelations, type ResolvedRelation } from './dialects'

const PROVIDER: Record<Dialect, string> = {
  postgresql: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite',
  sqlserver: 'sqlserver',
}

const RESERVED = new Set(['model', 'enum', 'type', 'generator', 'datasource', 'String', 'Int', 'Boolean', 'DateTime', 'Json'])

function safeName(name: string): string {
  let s = name.replace(/[^A-Za-z0-9_]/g, '_')
  if (!/^[A-Za-z]/.test(s)) s = `t_${s}`
  if (RESERVED.has(s)) s = `${s}_`
  return s
}

const pascal = (name: string) =>
  safeName(
    name
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join('') || name,
  )

const camel = (name: string) => {
  const p = pascal(name)
  return p[0].toLowerCase() + p.slice(1)
}

const prismaAction = (a: ReferentialAction): string =>
  ({ 'NO ACTION': 'NoAction', CASCADE: 'Cascade', 'SET NULL': 'SetNull', 'SET DEFAULT': 'SetDefault', RESTRICT: 'Restrict' })[a]

function scalarType(schema: Schema, col: Column, dialect: Dialect): { type: string; native?: string } {
  const en = findEnum(schema, col.type)
  if (en) return { type: pascal(en.name) }
  const p = parseType(col.type)
  const canon = canonicalType(col.type)
  const pg = dialect === 'postgresql'
  const my = dialect === 'mysql'
  switch (canon) {
    case 'smallint':
      return { type: 'Int', native: pg || my ? '@db.SmallInt' : undefined }
    case 'integer':
      return { type: 'Int' }
    case 'bigint':
      return { type: 'BigInt' }
    case 'decimal':
      return { type: 'Decimal', native: p.args && (pg || my) ? `@db.Decimal(${p.args})` : undefined }
    case 'real':
    case 'double':
      return { type: 'Float' }
    case 'boolean':
      return { type: 'Boolean' }
    case 'char':
      return { type: 'String', native: p.args && (pg || my) ? `@db.Char(${p.args})` : undefined }
    case 'varchar':
      return { type: 'String', native: p.args && (pg || my) ? `@db.VarChar(${p.args})` : undefined }
    case 'text':
      return { type: 'String', native: my ? '@db.Text' : undefined }
    case 'uuid':
      return { type: 'String', native: pg ? '@db.Uuid' : my ? '@db.Char(36)' : undefined }
    case 'date':
      return { type: 'DateTime', native: pg || my ? '@db.Date' : undefined }
    case 'time':
      return { type: 'DateTime', native: pg || my ? '@db.Time' : undefined }
    case 'timestamp':
      return { type: 'DateTime' }
    case 'timestamptz':
      return { type: 'DateTime', native: pg ? '@db.Timestamptz' : undefined }
    case 'json':
      return { type: dialect === 'sqlite' || dialect === 'sqlserver' ? 'String' : 'Json' }
    case 'binary':
      return { type: 'Bytes' }
    default:
      return { type: 'String', native: undefined }
  }
}

function prismaDefault(schema: Schema, col: Column, type: string): string | null {
  if (col.autoIncrement) return '@default(autoincrement())'
  const v = col.default?.trim()
  if (!v) return null
  const low = v.toLowerCase()
  if (['now()', 'current_timestamp', 'getdate()', 'sysdatetime()'].includes(low)) return '@default(now())'
  if (['gen_random_uuid()', 'uuid_generate_v4()', 'uuid()', 'newid()'].includes(low)) return '@default(uuid())'
  if (/^(true|false)$/i.test(v)) return `@default(${low})`
  if (/^-?\d+(\.\d+)?$/.test(v)) return `@default(${v})`
  const m = /^'((?:[^']|'')*)'(::.*)?$/.exec(v)
  if (m) {
    const val = m[1].replace(/''/g, "'")
    const en = findEnum(schema, col.type)
    if (en && en.values.includes(val) && /^[A-Za-z_]\w*$/.test(val)) return `@default(${val})`
    if (type === 'String') return `@default(${JSON.stringify(val)})`
  }
  return `@default(dbgenerated(${JSON.stringify(v)}))`
}

export function generatePrisma(schema: Schema, dialect: Dialect = schema.dialect): string {
  const out: string[] = []
  out.push(`generator client {\n  provider = "prisma-client-js"\n}`)
  out.push(`datasource db {\n  provider = "${PROVIDER[dialect]}"\n  url      = env("DATABASE_URL")\n}`)

  const relations = resolveRelations(schema)
  const modelName = new Map(schema.tables.map((t) => [t.id, pascal(t.name)]))

  // Cuántas relaciones hay entre cada par de modelos → nombres de relación cuando hay ambigüedad.
  const pairCount = new Map<string, number>()
  const pairKey = (r: ResolvedRelation) => [r.source.id, r.target.id].sort().join('|')
  for (const r of relations) pairCount.set(pairKey(r), (pairCount.get(pairKey(r)) ?? 0) + 1)
  const relName = (r: ResolvedRelation) =>
    pairCount.get(pairKey(r))! > 1 || r.source.id === r.target.id ? `"${r.target.name}_${r.targetColumn.name}"` : null

  const modelFor = (t: Table): string => {
    const lines: string[] = []
    const used = new Set(t.columns.map((c) => safeName(c.name)))
    const pkCols = t.columns.filter((c) => c.pk)
    for (const c of t.columns) {
      const field = safeName(c.name)
      const { type, native } = scalarType(schema, c, dialect)
      const attrs: string[] = []
      if (c.pk && pkCols.length === 1) attrs.push('@id')
      const def = prismaDefault(schema, c, type)
      if (def) attrs.push(def)
      if (c.unique && !c.pk) attrs.push('@unique')
      if (native) attrs.push(native)
      if (field !== c.name) attrs.push(`@map("${c.name}")`)
      const optional = c.nullable && !c.pk ? '?' : ''
      const doc = c.comment ? `  /// ${c.comment.replace(/\n/g, ' ')}\n` : ''
      lines.push(`${doc}  ${field} ${type}${optional}${attrs.length ? ' ' + attrs.join(' ') : ''}`)
    }
    const uniqueField = (base: string) => {
      let n = base
      let i = 2
      while (used.has(n)) n = `${base}${i++}`
      used.add(n)
      return n
    }
    // Lado FK (muchos): campo de relación con fields/references.
    for (const r of relations.filter((x) => x.target.id === t.id)) {
      const fieldName = uniqueField(camel(r.targetColumn.name.replace(/_?id$/i, '') || r.source.name))
      const args = [
        relName(r),
        `fields: [${safeName(r.targetColumn.name)}]`,
        `references: [${safeName(r.sourceColumn.name)}]`,
        r.rel.onDelete !== 'NO ACTION' ? `onDelete: ${prismaAction(r.rel.onDelete)}` : null,
        r.rel.onUpdate !== 'NO ACTION' ? `onUpdate: ${prismaAction(r.rel.onUpdate)}` : null,
      ].filter(Boolean)
      const opt = r.targetColumn.nullable ? '?' : ''
      lines.push(`  ${fieldName} ${modelName.get(r.source.id)}${opt} @relation(${args.join(', ')})`)
    }
    // Lado referenciado (uno): campo inverso.
    for (const r of relations.filter((x) => x.source.id === t.id)) {
      const one = r.rel.cardinality === '1:1'
      const base = camel(r.target.name) + (one ? '' : r.target.name.endsWith('s') ? '' : 's')
      const fieldName = uniqueField(relName(r) ? `${base}_${safeName(r.targetColumn.name)}` : base)
      const name = relName(r)
      lines.push(`  ${fieldName} ${modelName.get(r.target.id)}${one ? '?' : '[]'}${name ? ` @relation(${name})` : ''}`)
    }
    const block: string[] = []
    if (pkCols.length > 1) block.push(`  @@id([${pkCols.map((c) => safeName(c.name)).join(', ')}])`)
    for (const i of t.indexes) {
      const cols = i.columnIds.map((id) => t.columns.find((c) => c.id === id)).filter(Boolean) as Column[]
      if (!cols.length) continue
      block.push(`  @@${i.unique ? 'unique' : 'index'}([${cols.map((c) => safeName(c.name)).join(', ')}]${i.name ? `, map: "${i.name}"` : ''})`)
    }
    const name = modelName.get(t.id)!
    if (name !== t.name) block.push(`  @@map("${t.name}")`)
    const doc = t.comment ? `/// ${t.comment.replace(/\n/g, ' ')}\n` : ''
    return `${doc}model ${name} {\n${lines.join('\n')}${block.length ? '\n\n' + block.join('\n') : ''}\n}`
  }

  for (const t of schema.tables) out.push(modelFor(t))

  for (const e of schema.enums) {
    const name = pascal(e.name)
    const vals = e.values.map((v) => {
      const s = safeName(v)
      return s === v ? `  ${v}` : `  ${s} @map("${v}")`
    })
    out.push(`enum ${name} {\n${vals.join('\n')}${name !== e.name ? `\n\n  @@map("${e.name}")` : ''}\n}`)
  }

  const views = schema.views ?? []
  if (views.length) {
    out.push(
      [
        '// Vistas (no se generan como modelos: requieren previewFeatures = ["views"] en Prisma):',
        ...views.map((v) => `//   ${v.materialized ? 'vista materializada' : 'vista'} ${v.name}: ${v.columns.map((c) => c.name).join(', ')}`),
      ].join('\n'),
    )
  }

  return out.join('\n\n') + '\n'
}
