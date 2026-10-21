// Parser DDL propio (tolerante) para PostgreSQL y MySQL, con soporte básico de SQLite/SQL Server.
// Entiende: CREATE TABLE, ALTER TABLE ADD [CONSTRAINT] FOREIGN KEY/PRIMARY KEY/UNIQUE/COLUMN,
// CREATE TYPE ... AS ENUM, CREATE [UNIQUE] INDEX, COMMENT ON, CREATE FUNCTION y CREATE TRIGGER.
import { uid } from '@/lib/id'
import type {
  Column,
  DbFunction,
  Dialect,
  EnumType,
  ReferentialAction,
  Relation,
  Schema,
  Table,
  Trigger,
  TriggerEvent,
  TriggerTiming,
  View,
} from '@/types/schema'

import { IMPORT_TABLE_COLORS, gridLayout } from './layout'
import { inferCardinality, toAction, type ParseOptions } from './normalize'
import { splitStatements } from './split'
import { normalizeType } from './types'
import { VIEW_COLOR, inferViewColumns, orderViews, resolveViewSources } from './views'

export interface SQLImportResult {
  schema: Schema
  warnings: string[]
  /** Sentencias reconocidas / ignoradas. */
  stats: { statements: number; recognized: number; ignored: number }
}

// ---------------------------------------------------------------------------
// Utilidades léxicas
// ---------------------------------------------------------------------------

const IDENT = String.raw`(?:"(?:[^"]|"")+"|\x60[^\x60]+\x60|\[[^\]]+\]|[\w$]+)`
const QNAME = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})*)`

/** Quita comillas y el prefijo de esquema: public."Users" → Users */
export function unquoteName(raw: string): string {
  const parts: string[] = []
  const re = new RegExp(IDENT, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) parts.push(m[0])
  const last = (parts.pop() ?? raw).trim()
  if (last.startsWith('"')) return last.slice(1, -1).replace(/""/g, '"')
  if (last.startsWith('`') || last.startsWith('[')) return last.slice(1, -1)
  return last
}

function matchParen(s: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) {
        if (s[i + 1] === quote) i++
        else quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return s.length - 1
}

/** Divide por comas de primer nivel (fuera de paréntesis y comillas). */
export function splitTopLevel(s: string, sep = ','): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) {
        if (s[i + 1] === quote) i++
        else quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i).trim())
      start = i + 1
    }
  }
  const last = s.slice(start).trim()
  if (last) out.push(last)
  return out
}

const parseStringList = (s: string): string[] =>
  splitTopLevel(s)
    .map((v) => v.trim())
    .map((v) => (/^'.*'$/s.test(v) ? v.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'") : v))

const parseIdentList = (s: string): string[] =>
  splitTopLevel(s)
    .map((c) => c.trim())
    .filter((c) => !c.includes('(')) // índices por expresión: se ignoran
    .map((c) => unquoteName(c.replace(/\s+(ASC|DESC|NULLS\s+(FIRST|LAST)|COLLATE\s+\S+|\w+_ops)\b.*$/i, '')))

interface Token {
  text: string
  upper: string
  start: number
  end: number
  kind: 'word' | 'string' | 'group' | 'ident' | 'punct'
}

function tokenize(s: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const start = i
    let kind: Token['kind'] = 'word'
    if (ch === '(') {
      i = matchParen(s, i) + 1
      kind = 'group'
    } else if (ch === "'") {
      i++
      while (i < s.length) {
        if (s[i] === '\\') i += 2
        else if (s[i] === "'" && s[i + 1] === "'") i += 2
        else if (s[i] === "'") break
        else i++
      }
      i++
      kind = 'string'
      // Cast posterior ('x'::text) pegado a la cadena
      const cast = /^::[\w."]+(\[\])?/.exec(s.slice(i))
      if (cast) i += cast[0].length
    } else if (ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch
      i = s.indexOf(close, i + 1)
      i = i === -1 ? s.length : i + 1
      kind = 'ident'
      // "x"."y" y casts
      const rest = /^(\.(?:"[^"]+"|[\w$]+))+|^(\[\])/.exec(s.slice(i))
      if (rest) i += rest[0].length
    } else if (/[\w$:.\-+*/]/.test(ch)) {
      while (i < s.length && /[\w$:.\-+*/[\]]/.test(s[i])) {
        if (s[i] === '[' && s[i + 1] !== ']') break
        i++
        // esquema."Tabla" / esquema.`tabla`
        if (s[i - 1] === '.' && (s[i] === '"' || s[i] === '`')) {
          const close = s.indexOf(s[i], i + 1)
          i = close === -1 ? s.length : close + 1
        }
      }
    } else {
      i++
      kind = 'punct'
    }
    const text = s.slice(start, i)
    out.push({ text, upper: text.toUpperCase(), start, end: i, kind })
  }
  return out
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface PendingRef {
  table: string
  columns: string[]
  refTable: string
  refColumns: string[] | null
  onDelete: ReferentialAction
  onUpdate: ReferentialAction
  name?: string
}

const COLUMN_STOP = new Set([
  'NOT', 'NULL', 'PRIMARY', 'UNIQUE', 'DEFAULT', 'REFERENCES', 'CHECK', 'CONSTRAINT', 'AUTO_INCREMENT',
  'AUTOINCREMENT', 'IDENTITY', 'GENERATED', 'COMMENT', 'COLLATE', 'ON', 'KEY', 'CHARSET',
])

function readAction(tokens: Token[], i: number): [ReferentialAction, number] {
  const a = tokens[i]?.upper
  const b = tokens[i + 1]?.upper
  if (a === 'NO' && b === 'ACTION') return ['NO ACTION', i + 2]
  if (a === 'SET' && (b === 'NULL' || b === 'DEFAULT')) return [toAction(`SET ${b}`), i + 2]
  return [toAction(a), i + 1]
}

/** Lee "REFERENCES t (c) ON DELETE x ON UPDATE y" desde tokens[i] (que es REFERENCES). */
function readReferences(tokens: Token[], i: number) {
  let j = i + 1
  const refTable = unquoteName(tokens[j]?.text ?? '')
  j++
  let refColumns: string[] | null = null
  if (tokens[j]?.kind === 'group') {
    refColumns = parseIdentList(tokens[j].text.slice(1, -1))
    j++
  }
  let onDelete: ReferentialAction = 'NO ACTION'
  let onUpdate: ReferentialAction = 'NO ACTION'
  while (j < tokens.length) {
    const u = tokens[j].upper
    if (u === 'ON' && (tokens[j + 1]?.upper === 'DELETE' || tokens[j + 1]?.upper === 'UPDATE')) {
      const which = tokens[j + 1].upper
      const [act, next] = readAction(tokens, j + 2)
      if (which === 'DELETE') onDelete = act
      else onUpdate = act
      j = next
    } else if (u === 'MATCH') j += 2
    else if (['DEFERRABLE', 'INITIALLY', 'DEFERRED', 'IMMEDIATE', 'NOT'].includes(u) && !(u === 'NOT' && tokens[j + 1]?.upper === 'NULL')) j++
    else break
  }
  return { refTable, refColumns, onDelete, onUpdate, next: j }
}

export function detectSQLDialect(sql: string): Dialect {
  if (/`|\bAUTO_INCREMENT\b|\bENGINE\s*=|\bUNSIGNED\b/i.test(sql)) return 'mysql'
  if (/\[\w+\]\s|\bIDENTITY\s*\(|\bNVARCHAR\b|\bGO\s*$/im.test(sql)) return 'sqlserver'
  if (/\bAUTOINCREMENT\b|\bWITHOUT\s+ROWID\b/i.test(sql)) return 'sqlite'
  return 'postgresql'
}

export function importSQL(sql: string, dialectHint?: Dialect, opts: ParseOptions = {}): SQLImportResult {
  const dialect = dialectHint ?? detectSQLDialect(sql)
  const warnings: string[] = []
  const tables: Table[] = []
  const enums: EnumType[] = []
  const functions: DbFunction[] = []
  const pendingTriggers: { name: string; table: string; fn: string; timing: TriggerTiming; events: TriggerEvent[]; level: 'ROW' | 'STATEMENT'; condition?: string }[] = []
  const refs: PendingRef[] = []
  const views: (View & { explicitColumns?: string[] })[] = []
  const statements = splitStatements(sql)
  let recognized = 0

  const findTable = (name: string) => tables.find((t) => t.name.toLowerCase() === name.toLowerCase())
  const findCol = (t: Table, name: string) => t.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())

  const addIndex = (t: Table, name: string | undefined, cols: string[], unique: boolean) => {
    const columnIds = cols.map((c) => findCol(t, c)?.id).filter((x): x is string => !!x)
    if (!columnIds.length) return
    if (unique && columnIds.length === 1) {
      const col = t.columns.find((c) => c.id === columnIds[0])!
      if (!col.pk) {
        col.unique = true
        return
      }
    }
    if (t.indexes.some((i) => i.columnIds.join() === columnIds.join() && i.unique === unique)) return
    t.indexes.push({ id: uid('idx_'), name: name ?? '', columnIds, unique })
  }

  const setPk = (t: Table, cols: string[]) => {
    for (const name of cols) {
      const c = findCol(t, name)
      if (c) {
        c.pk = true
        c.nullable = false
      }
    }
  }

  /** Parsea una definición de columna. Devuelve la columna y registra FKs inline. */
  const parseColumn = (table: Table, def: string): Column | null => {
    const tokens = tokenize(def)
    if (!tokens.length) return null
    const name = unquoteName(tokens[0].text)
    let i = 1
    const typeTokens: Token[] = []
    while (i < tokens.length) {
      const t = tokens[i]
      if (t.kind === 'word' && COLUMN_STOP.has(t.upper)) break
      if (t.upper === 'CHARACTER' && tokens[i + 1]?.upper === 'SET') break
      typeTokens.push(t)
      i++
    }
    const typeRaw = typeTokens.length ? def.slice(typeTokens[0].start, typeTokens[typeTokens.length - 1].end) : 'text'
    const col: Column = {
      id: uid('col_'),
      name,
      type: 'text',
      pk: false,
      nullable: true,
      unique: false,
      autoIncrement: false,
    }
    // ENUM inline de MySQL → EnumType
    const enumMatch = /^enum\s*\((.*)\)$/is.exec(typeRaw.trim())
    if (enumMatch) {
      const enumName = `${table.name}_${name}`
      enums.push({ id: uid('enum_'), name: enumName, values: parseStringList(enumMatch[1]) })
      col.type = enumName
    } else {
      const nt = normalizeType(typeRaw)
      col.type = nt.type
      col.autoIncrement = nt.autoIncrement
    }

    while (i < tokens.length) {
      const u = tokens[i].upper
      if (u === 'NOT' && tokens[i + 1]?.upper === 'NULL') {
        col.nullable = false
        i += 2
      } else if (u === 'NULL') {
        i++
      } else if (u === 'PRIMARY') {
        col.pk = true
        col.nullable = false
        i += tokens[i + 1]?.upper === 'KEY' ? 2 : 1
      } else if (u === 'UNIQUE') {
        col.unique = true
        i += tokens[i + 1]?.upper === 'KEY' ? 2 : 1
      } else if (u === 'KEY') {
        i++
      } else if (u === 'DEFAULT') {
        const start = i + 1
        let j = start
        while (j < tokens.length) {
          const t = tokens[j]
          if (t.kind === 'word' && COLUMN_STOP.has(t.upper) && !(t.upper === 'NULL' && j === start)) break
          j++
        }
        if (j > start) {
          let v = def.slice(tokens[start].start, tokens[j - 1].end).trim()
          if (/^\((.*)\)$/s.test(v) && !/^\(.*\)\s*\(/.test(v) && dialect === 'mysql') v = v.slice(1, -1).trim()
          if (/^nextval\(/i.test(v)) col.autoIncrement = true
          else if (!/^null$/i.test(v)) col.default = v
        }
        i = j
      } else if (u === 'AUTO_INCREMENT' || u === 'AUTOINCREMENT') {
        col.autoIncrement = true
        i++
      } else if (u === 'IDENTITY') {
        col.autoIncrement = true
        i += tokens[i + 1]?.kind === 'group' ? 2 : 1
      } else if (u === 'GENERATED') {
        // GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY [(...)] | GENERATED ALWAYS AS (expr) STORED
        let j = i + 1
        while (j < tokens.length && ['ALWAYS', 'BY', 'DEFAULT', 'AS'].includes(tokens[j].upper)) j++
        if (tokens[j]?.upper === 'IDENTITY') {
          col.autoIncrement = true
          j++
          if (tokens[j]?.kind === 'group') j++
        } else if (tokens[j]?.kind === 'group') {
          warnings.push(`Columna calculada ${table.name}.${name}: se importa como columna normal.`)
          j++
          if (/^(STORED|VIRTUAL)$/.test(tokens[j]?.upper ?? '')) j++
        }
        i = j
      } else if (u === 'REFERENCES') {
        const r = readReferences(tokens, i)
        refs.push({ table: table.name, columns: [name], refTable: r.refTable, refColumns: r.refColumns, onDelete: r.onDelete, onUpdate: r.onUpdate })
        i = r.next
      } else if (u === 'CHECK') {
        i += tokens[i + 1]?.kind === 'group' ? 2 : 1
      } else if (u === 'CONSTRAINT') {
        i += 2
      } else if (u === 'COMMENT') {
        const s = tokens[i + 1]
        if (s?.kind === 'string') col.comment = s.text.replace(/::.*$/, '').slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'")
        i += 2
      } else if (u === 'COLLATE' || u === 'CHARSET') {
        i += 2
      } else if (u === 'CHARACTER' && tokens[i + 1]?.upper === 'SET') {
        i += 3
      } else if (u === 'ON' && tokens[i + 1]?.upper === 'UPDATE') {
        // MySQL: ON UPDATE CURRENT_TIMESTAMP
        i += 3
      } else {
        i++
      }
    }
    if (col.pk) col.nullable = false
    return col
  }

  /** Restricciones de tabla (dentro de CREATE TABLE o en ALTER TABLE ADD). Devuelve true si la reconoce. */
  const parseConstraint = (table: Table, def: string): boolean => {
    let s = def.trim()
    let cname: string | undefined
    const cm = new RegExp(`^CONSTRAINT\\s+(${IDENT})\\s+`, 'i').exec(s)
    if (cm) {
      cname = unquoteName(cm[1])
      s = s.slice(cm[0].length)
    }
    let m: RegExpExecArray | null
    if ((m = /^PRIMARY\s+KEY\s*(?:CLUSTERED\s*|NONCLUSTERED\s*)?\(([^)]*)\)/i.exec(s))) {
      setPk(table, parseIdentList(m[1]))
      return true
    }
    if ((m = new RegExp(`^FOREIGN\\s+KEY\\s*(?:${IDENT}\\s*)?\\(([^)]*)\\)\\s*(REFERENCES.*)$`, 'is').exec(s))) {
      const tokens = tokenize(m[2])
      const r = readReferences(tokens, 0)
      refs.push({ table: table.name, columns: parseIdentList(m[1]), refTable: r.refTable, refColumns: r.refColumns, onDelete: r.onDelete, onUpdate: r.onUpdate, name: cname })
      return true
    }
    if ((m = new RegExp(`^UNIQUE(?:\\s+(?:KEY|INDEX))?\\s*(?:(${IDENT})\\s*)?(?:USING\\s+\\w+\\s*)?\\(([^)]*)\\)`, 'i').exec(s))) {
      addIndex(table, m[1] ? unquoteName(m[1]) : cname, parseIdentList(m[2]), true)
      return true
    }
    if ((m = new RegExp(`^(?:FULLTEXT\\s+|SPATIAL\\s+)?(?:KEY|INDEX)\\s*(?:(${IDENT})\\s*)?(?:USING\\s+\\w+\\s*)?\\(([^)]*)\\)`, 'i').exec(s))) {
      addIndex(table, m[1] ? unquoteName(m[1]) : undefined, parseIdentList(m[2]), false)
      return true
    }
    if (/^(CHECK|EXCLUDE|LIKE|PERIOD)\b/i.test(s)) return true
    return false
  }

  for (const stmt of statements) {
    const s = stmt.replace(/^\s+/, '')
    let m: RegExpExecArray | null

    // CREATE TYPE x AS ENUM (...)
    if ((m = new RegExp(`^CREATE\\s+TYPE\\s+${QNAME}\\s+AS\\s+ENUM\\s*\\(([\\s\\S]*)\\)\\s*$`, 'i').exec(s))) {
      enums.push({ id: uid('enum_'), name: unquoteName(m[1]), values: parseStringList(m[2]) })
      recognized++
      continue
    }

    // CREATE [OR REPLACE] [MATERIALIZED] VIEW
    if (
      (m = new RegExp(
        `^CREATE\\s+(?:OR\\s+(?:REPLACE|ALTER)\\s+)?(?:ALGORITHM\\s*=\\s*\\w+\\s+)?(?:DEFINER\\s*=\\s*\\S+\\s+)?(?:SQL\\s+SECURITY\\s+\\w+\\s+)?(?:TEMP(?:ORARY)?\\s+|RECURSIVE\\s+)?(MATERIALIZED\\s+)?VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QNAME}\\s*(\\([^)]*\\))?\\s*(?:WITH\\s*\\([^)]*\\)\\s*)?AS\\s+([\\s\\S]*)$`,
        'i',
      ).exec(s))
    ) {
      const definition = m[4]
        .replace(/\s+WITH\s+(NO\s+)?DATA\s*$/i, '')
        .replace(/\s+WITH\s+(CASCADED\s+|LOCAL\s+)?CHECK\s+OPTION\s*$/i, '')
        .trim()
      const name = unquoteName(m[2])
      const prev = views.findIndex((v) => v.name.toLowerCase() === name.toLowerCase())
      if (prev >= 0) views.splice(prev, 1)
      views.push({
        id: uid('view_'),
        name,
        definition,
        materialized: !!m[1],
        sourceIds: [],
        columns: [],
        color: VIEW_COLOR,
        position: { x: 0, y: 0 },
        explicitColumns: m[3] ? parseIdentList(m[3].slice(1, -1)) : undefined,
      })
      recognized++
      continue
    }

    // COMMENT ON [MATERIALIZED] VIEW
    if ((m = new RegExp(`^COMMENT\\s+ON\\s+(?:MATERIALIZED\\s+)?VIEW\\s+${QNAME}\\s+IS\\s+'((?:[^']|'')*)'`, 'i').exec(s))) {
      const v = views.find((x) => x.name.toLowerCase() === unquoteName(m![1]).toLowerCase())
      if (v) v.comment = m[2].replace(/''/g, "'")
      recognized++
      continue
    }

    // CREATE TABLE
    if ((m = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:(?:GLOBAL|LOCAL)\\s+)?(?:TEMP(?:ORARY)?\\s+|UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QNAME}\\s*\\(`, 'i').exec(s))) {
      const name = unquoteName(m[1])
      const open = m[0].length - 1
      const close = matchParen(s, open)
      const body = s.slice(open + 1, close)
      const tail = s.slice(close + 1)
      const table: Table = {
        id: uid('tbl_'),
        name,
        color: IMPORT_TABLE_COLORS[tables.length % IMPORT_TABLE_COLORS.length],
        columns: [],
        indexes: [],
        position: { x: 0, y: 0 },
      }
      const existing = findTable(name)
      if (existing) {
        warnings.push(`La tabla ${name} está definida dos veces; se usa la última definición.`)
        tables.splice(tables.indexOf(existing), 1)
      }
      tables.push(table)
      const items = splitTopLevel(body)
      // Primero columnas, luego restricciones (que referencian columnas).
      const constraints: string[] = []
      for (const item of items) {
        if (/^(CONSTRAINT\s|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s*(KEY|INDEX)?\s*[\w"`(]|(FULLTEXT\s+|SPATIAL\s+)?(KEY|INDEX)\s|CHECK\s*\(|EXCLUDE\s|LIKE\s)/i.test(item)) {
          if (/^UNIQUE\s/i.test(item) && !/^UNIQUE\s*(KEY|INDEX)?\s*(\S+\s*)?\(/i.test(item)) {
            /* columna llamada "unique"… improbable */
          }
          constraints.push(item)
        } else {
          const col = parseColumn(table, item)
          if (col) table.columns.push(col)
        }
      }
      for (const c of constraints) if (!parseConstraint(table, c)) warnings.push(`Restricción no reconocida en ${name}: ${c.slice(0, 60)}`)
      const tc = /\bCOMMENT\s*=?\s*'((?:[^']|'')*)'/i.exec(tail)
      if (tc) table.comment = tc[1].replace(/''/g, "'")
      recognized++
      continue
    }

    // ALTER TABLE
    if ((m = new RegExp(`^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${QNAME}\\s+([\\s\\S]*)$`, 'i').exec(s))) {
      const table = findTable(unquoteName(m[1]))
      if (!table) {
        warnings.push(`ALTER TABLE sobre una tabla desconocida: ${unquoteName(m[1])}`)
        continue
      }
      let any = false
      for (const action of splitTopLevel(m[2])) {
        const a = action.trim()
        let am: RegExpExecArray | null
        if ((am = /^ADD\s+(?!COLUMN\b)([\s\S]*)$/i.exec(a)) && /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|KEY|INDEX|CHECK|FULLTEXT)\b/i.test(am[1].trim())) {
          any = parseConstraint(table, am[1]) || any
        } else if ((am = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]*)$/i.exec(a))) {
          const col = parseColumn(table, am[1])
          if (col && !findCol(table, col.name)) table.columns.push(col)
          any = true
        } else if ((am = new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?(${IDENT})\\s+SET\\s+DEFAULT\\s+([\\s\\S]+)$`, 'i').exec(a))) {
          const col = findCol(table, unquoteName(am[1]))
          if (col) {
            if (/^nextval\(/i.test(am[2].trim())) col.autoIncrement = true
            else col.default = am[2].trim()
          }
          any = true
        } else if ((am = new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?(${IDENT})\\s+SET\\s+NOT\\s+NULL`, 'i').exec(a))) {
          const col = findCol(table, unquoteName(am[1]))
          if (col) col.nullable = false
          any = true
        } else if ((am = new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?(${IDENT})\\s+ADD\\s+GENERATED`, 'i').exec(a))) {
          const col = findCol(table, unquoteName(am[1]))
          if (col) col.autoIncrement = true
          any = true
        } else if (/^(OWNER\s+TO|ENABLE|DISABLE|SET\s|REPLICA|CLUSTER)/i.test(a)) {
          any = true
        }
      }
      if (any) recognized++
      continue
    }

    // CREATE INDEX
    if ((m = new RegExp(`^CREATE\\s+(UNIQUE\\s+)?(?:CLUSTERED\\s+|NONCLUSTERED\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:(${IDENT}(?:\\s*\\.\\s*${IDENT})?)\\s+)?ON\\s+(?:ONLY\\s+)?${QNAME}\\s*(?:USING\\s+\\w+\\s*)?\\(`, 'i').exec(s))) {
      const table = findTable(unquoteName(m[3]))
      const open = m[0].length - 1
      const cols = parseIdentList(s.slice(open + 1, matchParen(s, open)))
      if (table && cols.length) {
        addIndex(table, m[2] ? unquoteName(m[2]) : undefined, cols, !!m[1])
        recognized++
      } else if (!table) warnings.push(`Índice sobre tabla desconocida: ${unquoteName(m[3])}`)
      else warnings.push(`Índice por expresión ignorado: ${m[2] ? unquoteName(m[2]) : ''}`)
      continue
    }

    // COMMENT ON TABLE / COLUMN
    if ((m = new RegExp(`^COMMENT\\s+ON\\s+(TABLE|COLUMN)\\s+${QNAME}\\s+IS\\s+(NULL|'((?:[^']|'')*)')`, 'i').exec(s))) {
      const text = m[4]?.replace(/''/g, "'")
      if (m[1].toUpperCase() === 'TABLE') {
        const t = findTable(unquoteName(m[2]))
        if (t) t.comment = text
      } else {
        const parts = [...m[2].matchAll(new RegExp(IDENT, 'g'))].map((x) => unquoteName(x[0]))
        const colName = parts.pop() ?? ''
        const t = findTable(parts.pop() ?? '')
        const c = t && findCol(t, colName)
        if (c) c.comment = text
      }
      recognized++
      continue
    }

    // CREATE FUNCTION
    if ((m = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${QNAME}\\s*\\(`, 'i').exec(s))) {
      const open = m[0].length - 1
      const close = matchParen(s, open)
      const args = s.slice(open + 1, close).trim()
      const tail = s.slice(close + 1)
      const returns = /RETURNS\s+(SETOF\s+)?([\w."]+(?:\s*\([^)]*\))?(?:\[\])?)/i.exec(tail)?.[0].replace(/^RETURNS\s+/i, '') ?? 'trigger'
      const lang = /LANGUAGE\s+'?(\w+)'?/i.exec(tail)?.[1]?.toLowerCase()
      const body = /\$([A-Za-z_]\w*)?\$([\s\S]*?)\$\1\$/.exec(tail)?.[2] ?? /\bAS\s+'((?:[^']|'')*)'/i.exec(tail)?.[1]?.replace(/''/g, "'") ?? ''
      functions.push({
        id: uid('fn_'),
        name: unquoteName(m[1]),
        language: lang === 'sql' ? 'sql' : 'plpgsql',
        args,
        returns: returns.trim(),
        body: body.replace(/^\n+|\s+$/g, ''),
        position: { x: 0, y: 0 },
      })
      if (lang && lang !== 'sql' && lang !== 'plpgsql') warnings.push(`Función ${unquoteName(m[1])} en lenguaje ${lang}: se importa como plpgsql.`)
      recognized++
      continue
    }

    // CREATE TRIGGER (PostgreSQL)
    if (
      (m = new RegExp(
        `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+(${IDENT})\\s+(BEFORE|AFTER|INSTEAD\\s+OF)\\s+([\\s\\S]+?)\\s+ON\\s+${QNAME}([\\s\\S]*?)EXECUTE\\s+(?:FUNCTION|PROCEDURE)\\s+${QNAME}`,
        'i',
      ).exec(s))
    ) {
      const events = m[3]
        .split(/\s+OR\s+/i)
        .map((e) => e.trim().split(/\s+/)[0].toUpperCase())
        .filter((e): e is TriggerEvent => ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].includes(e))
      const middle = m[5]
      const level = /FOR\s+EACH\s+STATEMENT/i.test(middle) ? 'STATEMENT' : 'ROW'
      const whenIdx = middle.search(/\bWHEN\s*\(/i)
      let condition: string | undefined
      if (whenIdx >= 0) {
        const open = middle.indexOf('(', whenIdx)
        condition = middle.slice(open + 1, matchParen(middle, open)).trim()
      }
      pendingTriggers.push({
        name: unquoteName(m[1]),
        timing: m[2].toUpperCase().replace(/\s+/, ' ') as TriggerTiming,
        events,
        table: unquoteName(m[4]),
        fn: unquoteName(m[6]),
        level,
        condition,
      })
      recognized++
      continue
    }

    if (/^(SET|USE|BEGIN|COMMIT|START|SELECT\s+pg_catalog|CREATE\s+(SCHEMA|EXTENSION|SEQUENCE)|ALTER\s+SEQUENCE|DROP|PRAGMA|LOCK|UNLOCK|INSERT|COPY|GRANT|REVOKE|\\)/i.test(s)) continue
    warnings.push(`Sentencia ignorada: ${s.slice(0, 70).replace(/\s+/g, ' ')}${s.length > 70 ? '…' : ''}`)
  }

  // Resolver relaciones
  const relations: Relation[] = []
  for (const r of refs) {
    const t = findTable(r.table)
    const rt = findTable(r.refTable)
    if (!t || !rt) {
      warnings.push(`FK de ${r.table} hacia tabla desconocida ${r.refTable}.`)
      continue
    }
    const refCols = r.refColumns?.length ? r.refColumns : rt.columns.filter((c) => c.pk).map((c) => c.name)
    r.columns.forEach((cn, i) => {
      const c = findCol(t, cn)
      const rc = findCol(rt, refCols[i] ?? refCols[0] ?? '')
      if (!c || !rc) {
        warnings.push(`FK ${r.table}.${cn} → ${r.refTable}: columna no encontrada.`)
        return
      }
      const dup = relations.find((x) => x.targetColumnId === c.id && x.sourceColumnId === rc.id)
      if (dup) {
        if (r.onDelete !== 'NO ACTION') dup.onDelete = r.onDelete
        if (r.onUpdate !== 'NO ACTION') dup.onUpdate = r.onUpdate
        if (r.name) dup.name = r.name
        return
      }
      relations.push({
        id: uid('rel_'),
        ...(r.name ? { name: r.columns.length > 1 ? `${r.name}_${i + 1}` : r.name } : {}),
        sourceTableId: rt.id,
        sourceColumnId: rc.id,
        targetTableId: t.id,
        targetColumnId: c.id,
        cardinality: r.columns.length === 1 ? inferCardinality(c, t.columns.filter((x) => x.pk).length) : '1:N',
        onDelete: r.onDelete,
        onUpdate: r.onUpdate,
      })
    })
  }

  const triggers: Trigger[] = []
  for (const p of pendingTriggers) {
    const t = findTable(p.table)
    const f = functions.find((x) => x.name.toLowerCase() === p.fn.toLowerCase())
    if (!t || !f) {
      warnings.push(`Trigger ${p.name}: no se encontró ${!t ? `la tabla ${p.table}` : `la función ${p.fn}`}.`)
      continue
    }
    triggers.push({
      id: uid('trg_'),
      name: p.name,
      tableId: t.id,
      functionId: f.id,
      timing: p.timing,
      events: p.events.length ? p.events : ['INSERT'],
      level: p.level,
      ...(p.condition ? { condition: p.condition } : {}),
      position: { x: 0, y: 0 },
    })
  }

  // Vistas: dependencias y columnas (se resuelven al final porque pueden leer de objetos posteriores).
  for (const v of views) v.sourceIds = resolveViewSources(v.definition, tables, views)
  for (const v of orderViews(views)) {
    const sources = [
      ...tables.filter((t) => v.sourceIds.includes(t.id)),
      ...views
        .filter((x) => v.sourceIds.includes(x.id))
        .map((x) => ({ name: x.name, columns: x.columns.map((c) => ({ name: c.name, type: c.type ?? '' })) })),
    ] as Pick<Table, 'name' | 'columns'>[]
    v.columns = inferViewColumns(v.definition, sources, v.explicitColumns)
  }
  const finalViews: View[] = views.map(({ explicitColumns: _omit, ...v }) => v)

  const schema: Schema = { dialect, tables, views: finalViews, relations, enums, functions, triggers, notes: [] }
  if (opts.layout !== false) gridLayout(schema)
  return {
    schema,
    warnings,
    stats: { statements: statements.length, recognized, ignored: statements.length - recognized },
  }
}
