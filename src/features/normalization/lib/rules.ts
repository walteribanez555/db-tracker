// Motor de reglas heurísticas de normalización. Puro: no depende de React ni del store.
import type { Column, Dialect, Schema, Table } from '@/types/schema'

import { detectRefreshes } from '@/features/triggers/lib/graph'

import { defaultPkType, schemaPkStyle } from './fixes'
import {
  RESERVED_WORDS,
  entityOf,
  isFreeTextPlural,
  isPluralName,
  isPluralTableName,
  isStrongMultivalued,
  pluralize,
  singularize,
  splitWords,
  toCamelCase,
  toSnakeCase,
} from './names'
import { checkView, isViewUsed } from './views'
import { LEVELS, NORMAL_FORMS, SEVERITY_ORDER, type Finding, type NormalLevel, type RuleId, type Severity } from './types'

export * from './types'
export { applyFix, describeFix, fixTableIds } from './fixes'

const TEXT_TYPE = /char|text|string|clob/i
const ARRAY_TYPE = /\[\]$|^_|^array\b|\barray$/i
const JSON_TYPE = /^jsonb?$/i
const FLOAT_TYPE = /^(float|double|real|double precision|float4|float8)\b/i

const MONEY_WORDS = new Set([
  'precio',
  'monto',
  'total',
  'subtotal',
  'importe',
  'costo',
  'coste',
  'salario',
  'sueldo',
  'saldo',
  'pago',
  'impuesto',
  'iva',
  'price',
  'amount',
  'cost',
  'balance',
  'salary',
  'tax',
  'fee',
  'tarifa',
])
const DATE_WORDS = new Set(['fecha', 'date', 'nacimiento', 'vencimiento', 'caducidad', 'birthday', 'dob', 'timestamp'])
const TIME_HINT = /hora|time|_at$|timestamp|creado|actualizado|eliminado|created|updated|deleted/i
const BOOL_PREFIX = /^(es|is|has|tiene|can|puede)_|^(activo|activa|active|habilitado|enabled|eliminado|borrado|verificado|verified)$/i

/** Prefijos que no indican una entidad (fecha_entrega, total_iva...). */
const STOP_PREFIXES = new Set([
  'fecha',
  'hora',
  'date',
  'time',
  'total',
  'monto',
  'precio',
  'costo',
  'num',
  'numero',
  'nro',
  'cantidad',
  'es',
  'is',
  'has',
  'tiene',
  'created',
  'updated',
  'deleted',
  'creado',
  'actualizado',
  'eliminado',
  'ultimo',
  'ultima',
  'primer',
  'primera',
  'max',
  'min',
  'id',
  'url',
  'meta',
  'tipo',
  'estado',
  'codigo',
  'nombre',
  'apellido',
  'descripcion',
  'fec',
  'ind',
  'flag',
  'valor',
  'importe',
  'saldo',
  'porcentaje',
  'tasa',
  'last',
  'first',
  'can',
  'puede',
  'requiere',
  'tiempo',
  'duracion',
  'nivel',
  'segundo',
  'segunda',
  'telefono',
  'email',
  'correo',
  'peso',
  'alto',
  'ancho',
  'largo',
  'datos',
  'data',
  'info',
  'extra',
  'config',
  'old',
  'new',
])

/** Nombres genéricos que pueden repetirse entre tablas sin indicar redundancia. */
const GENERIC_COLUMNS = new Set([
  'id',
  'uuid',
  'nombre',
  'name',
  'descripcion',
  'description',
  'created_at',
  'updated_at',
  'deleted_at',
  'creado_en',
  'actualizado_en',
  'fecha_creacion',
  'fecha_actualizacion',
  'created_by',
  'updated_by',
  'estado',
  'status',
  'activo',
  'active',
  'tipo',
  'type',
  'codigo',
  'code',
  'notas',
  'notes',
  'comentario',
  'observaciones',
  'orden',
  'version',
  'slug',
  'titulo',
  'title',
  'cantidad',
  'fecha',
])

const RESERVED_REPLACEMENTS: Record<string, string> = {
  user: 'usuario',
  order: 'orden',
  group: 'grupo',
  table: 'tabla',
  select: 'seleccion',
  from: 'desde',
  where: 'donde',
  key: 'clave',
  index: 'indice',
  column: 'columna',
  default: 'valor_defecto',
  check: 'verificacion',
  limit: 'limite',
  offset: 'desplazamiento',
  desc: 'descripcion',
  asc: 'ascendente',
  references: 'referencias',
  primary: 'principal',
  foreign: 'externo',
  constraint: 'restriccion',
  grant: 'permiso',
  role: 'rol',
  session: 'sesion',
}

const isFloat = (c: Column) => FLOAT_TYPE.test(c.type.trim())

interface Ctx {
  schema: Schema
  dialect: Dialect
  tableById: Map<string, Table>
  /** Columnas FK (lado "muchos") → relación. */
  fkByColumn: Map<string, Schema['relations'][number]>
  /** Columnas ya explicadas por una regla más específica (para no duplicar hallazgos). */
  handled: Set<string>
  out: Finding[]
}

function push(ctx: Ctx, f: Omit<Finding, 'id'>) {
  const id = `${f.rule}:${f.tableId}:${[...f.columnIds].sort().join('+')}`
  if (ctx.out.some((x) => x.id === id)) return
  ctx.out.push({ id, ...f })
}

const tableEntity = (t: Table) => entityOf(t.name)
const findEntityTable = (ctx: Ctx, entity: string) => ctx.schema.tables.find((t) => tableEntity(t) === entity || toSnakeCase(t.name) === entity)

// ---------------------------------------------------------------------------
// 1FN
// ---------------------------------------------------------------------------

function ruleNoPk(ctx: Ctx, t: Table) {
  if (t.columns.some((c) => c.pk)) return
  const hasId = t.columns.find((c) => c.name === 'id')
  const pkType = hasId?.type ?? schemaPkStyle(ctx.schema)?.type ?? defaultPkType(ctx.dialect).type
  push(ctx, {
    rule: 'sin-pk',
    level: '1FN',
    severity: 'alta',
    tableId: t.id,
    columnIds: hasId ? [hasId.id] : [],
    title: `"${t.name}" no tiene clave primaria`,
    explanation:
      'La primera forma normal exige que cada fila sea identificable de forma única. Sin clave primaria pueden existir filas duplicadas imposibles de distinguir, y ninguna otra tabla puede referenciar esta de forma fiable con una clave foránea.',
    suggestion: hasId
      ? `Marca la columna "id" como clave primaria.`
      : `Añade una clave primaria sustituta "id" (${pkType}) o define como PK la combinación de columnas que identifica cada fila.`,
    fix: { kind: 'add-pk', tableId: t.id, columnName: 'id', type: pkType },
  })
}

function ruleRepeatingGroups(ctx: Ctx, t: Table) {
  const groups = new Map<string, Column[]>()
  for (const c of t.columns) {
    if (c.pk) continue
    const m = /^(.*?[A-Za-z])_?(\d+)$/.exec(c.name)
    if (!m || m[1].length < 2) continue
    const base = m[1].replace(/_$/, '')
    groups.set(base, [...(groups.get(base) ?? []), c])
  }
  for (const [base, cols] of groups) {
    if (cols.length < 2) continue
    cols.forEach((c) => ctx.handled.add(c.id))
    const baseSnake = toSnakeCase(base)
    const newTableName = `${tableEntity(t)}_${pluralize(baseSnake)}`
    push(ctx, {
      rule: 'grupo-repetitivo',
      level: '1FN',
      severity: 'alta',
      tableId: t.id,
      columnIds: cols.map((c) => c.id),
      title: `Grupo repetitivo: ${cols.map((c) => c.name).join(', ')}`,
      explanation: `Las columnas ${cols.map((c) => `"${c.name}"`).join(', ')} repiten el mismo dato numerado. Es un "grupo repetitivo": viola la 1FN porque el número de valores queda fijado por el diseño (¿y si alguien tiene ${cols.length + 1}?), obliga a buscar en varias columnas a la vez y deja muchas celdas vacías.`,
      suggestion: `Crea una tabla hija "${newTableName}" con una fila por cada ${baseSnake}, unida a "${t.name}" mediante una clave foránea.`,
      fix: { kind: 'extract-multivalued', tableId: t.id, columnIds: cols.map((c) => c.id), newTableName, valueColumnName: baseSnake, valueType: cols[0].type },
    })
  }
}

function ruleMultivalued(ctx: Ctx, t: Table) {
  for (const c of t.columns) {
    if (c.pk || ctx.handled.has(c.id) || ctx.fkByColumn.has(c.id)) continue
    const type = c.type.trim()
    let severity: Severity | null = null
    let reason = ''
    let valueType = 'varchar(255)'
    if (ARRAY_TYPE.test(type)) {
      severity = 'alta'
      reason = `es de tipo arreglo (${type}): guarda varios valores en una sola celda.`
      valueType = type.replace(/\[\]$/, '').replace(/^_/, '').replace(/^array\s*/i, '').trim() || 'text'
    } else if (/^set\s*\(/i.test(type)) {
      severity = 'alta'
      reason = `es de tipo SET: guarda varios valores en una sola celda.`
    } else if (JSON_TYPE.test(type) && (isStrongMultivalued(c.name) || (isPluralName(c.name) && splitWords(c.name).length === 1)) && !isFreeTextPlural(c.name)) {
      severity = 'media'
      reason = `es ${type} y su nombre en plural sugiere que se usa como lista.`
    } else if (TEXT_TYPE.test(type) && isStrongMultivalued(c.name)) {
      severity = 'alta'
      reason = `es texto y su nombre en plural indica que almacena una lista (p. ej. "a, b, c").`
    } else if (TEXT_TYPE.test(type) && isPluralName(c.name) && !isFreeTextPlural(c.name)) {
      severity = 'baja'
      reason = `es texto con nombre en plural; podría estar guardando una lista separada por comas.`
    }
    if (!severity) continue
    ctx.handled.add(c.id)
    const value = singularize(toSnakeCase(c.name))
    const newTableName = `${tableEntity(t)}_${pluralize(value)}`
    push(ctx, {
      rule: 'multivaluada',
      level: '1FN',
      severity,
      tableId: t.id,
      columnIds: [c.id],
      title: `"${t.name}.${c.name}" parece multivaluada`,
      explanation: `La 1FN exige valores atómicos: una celda, un dato. "${c.name}" ${reason} Con listas dentro de una celda no puedes indexar, validar ni relacionar cada elemento, y consultas como "¿quién tiene X?" requieren LIKE o funciones especiales.`,
      suggestion: `Extrae los valores a una tabla "${newTableName}" (una fila por ${value}). Si los valores son otra entidad (p. ej. productos o etiquetas compartidas), conviértelo luego en una relación N:M con tabla intermedia.`,
      fix: { kind: 'extract-multivalued', tableId: t.id, columnIds: [c.id], newTableName, valueColumnName: value, valueType },
    })
  }
}

// ---------------------------------------------------------------------------
// 2FN
// ---------------------------------------------------------------------------

function rulePartialDependency(ctx: Ctx, t: Table) {
  const pk = t.columns.filter((c) => c.pk)
  if (pk.length < 2) return
  for (const k of pk) {
    const rel = ctx.fkByColumn.get(k.id)
    const refTable = rel ? ctx.tableById.get(rel.sourceTableId) : undefined
    const prefixes = new Set<string>()
    if (/_id$/i.test(k.name)) prefixes.add(toSnakeCase(k.name.slice(0, -3)))
    if (refTable) prefixes.add(tableEntity(refTable))
    for (const p of prefixes) {
      const cols = t.columns.filter((c) => !c.pk && !ctx.handled.has(c.id) && toSnakeCase(c.name).startsWith(`${p}_`) && c.id !== k.id)
      if (!cols.length) continue
      cols.forEach((c) => ctx.handled.add(c.id))
      const target = refTable ?? findEntityTable(ctx, p)
      const newTableName = pluralize(p)
      push(ctx, {
        rule: 'dependencia-parcial',
        level: '2FN',
        severity: 'alta',
        tableId: t.id,
        columnIds: cols.map((c) => c.id),
        title: `Dependencia parcial de "${k.name}" en ${t.name}`,
        explanation: `La clave primaria de "${t.name}" es compuesta (${pk.map((c) => c.name).join(', ')}). La 2FN exige que cada atributo dependa de la clave completa, pero ${cols.map((c) => `"${c.name}"`).join(', ')} solo depende de "${k.name}": el mismo ${p} repetirá esos datos en cada fila, y cambiarlos obliga a actualizar muchas filas (anomalía de actualización).`,
        suggestion: target
          ? `Mueve ${cols.map((c) => c.name).join(', ')} a la tabla "${target.name}" (ya existe) y deja solo "${k.name}" como referencia.`
          : `Crea la tabla "${newTableName}" con esos atributos y convierte "${k.name}" en una FK hacia ella.`,
        fix: {
          kind: 'extract-entity',
          sourceTableId: t.id,
          columnIds: cols.map((c) => c.id),
          targetTableId: target?.id,
          newTableName,
          linkColumnId: k.id,
          linkColumnName: k.name,
          stripPrefix: `${p}_`,
        },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// 3FN
// ---------------------------------------------------------------------------

/**
 * ¿La columna es el propio valor de una tabla extraída? P. ej. `cliente_telefono` en
 * `pedidos_legacy_cliente_telefonos`: la tabla es justamente la entidad de ese prefijo.
 */
function isOwnValueColumn(t: Table, c: Column): boolean {
  const table = singularize(toSnakeCase(t.name))
  const col = singularize(toSnakeCase(c.name))
  return table === col || table.endsWith(`_${col}`)
}

function ruleTransitive(ctx: Ctx, t: Table) {
  const own = tableEntity(t)
  const groups = new Map<string, Column[]>()
  for (const c of t.columns) {
    if (c.pk || ctx.handled.has(c.id) || ctx.fkByColumn.has(c.id) || isOwnValueColumn(t, c)) continue
    const words = splitWords(c.name)
    if (words.length < 2) continue
    const p = words[0]
    if (p.length < 3 || STOP_PREFIXES.has(p) || p === own || words[words.length - 1] === 'id') continue
    groups.set(p, [...(groups.get(p) ?? []), c])
  }
  for (const [p, cols] of groups) {
    const link =
      t.columns.find((c) => toSnakeCase(c.name) === `${p}_id`) ??
      t.columns.find((c) => {
        const r = ctx.fkByColumn.get(c.id)
        const ref = r && ctx.tableById.get(r.sourceTableId)
        return ref ? tableEntity(ref) === p : false
      })
    const linkRel = link ? ctx.fkByColumn.get(link.id) : undefined
    const refTable = (linkRel && ctx.tableById.get(linkRel.sourceTableId)) || findEntityTable(ctx, p)
    if (refTable?.id === t.id) continue
    // Sin FK que lo identifique, un único atributo con prefijo no basta: no hay otro atributo que dependa de él.
    let severity: Severity
    if (link) severity = 'alta'
    else if (cols.length >= 2) severity = 'media'
    else continue
    cols.forEach((c) => ctx.handled.add(c.id))
    const names = cols.map((c) => `"${c.name}"`).join(', ')
    const pkNames = t.columns.filter((c) => c.pk).map((c) => c.name).join(', ') || 'la clave'
    push(ctx, {
      rule: 'dependencia-transitiva',
      level: '3FN',
      severity,
      tableId: t.id,
      columnIds: cols.map((c) => c.id),
      title: `Dependencia transitiva: datos de ${p} en ${t.name}`,
      explanation: link
        ? `${names} describen al ${p}, no al registro de "${t.name}". Dependen de "${link.name}", que a su vez depende de ${pkNames}: es una dependencia transitiva (${pkNames} → ${link.name} → ${cols[0].name}) que viola la 3FN. Si el ${p} cambia su dato, habrá que actualizar cada fila de "${t.name}" y es fácil dejar copias inconsistentes.`
        : `${names} comparten el prefijo "${p}_": describen otra entidad (${p}) incrustada en "${t.name}". Esos atributos dependen del ${p}, no de ${pkNames}, así que se repetirán y podrán contradecirse entre filas (dependencia transitiva, viola la 3FN).`,
      suggestion: refTable
        ? `Mueve esos datos a "${refTable.name}" y referencia el ${p} solo por su clave${link ? ` ("${link.name}")` : ` (nueva FK "${p}_id")`}.`
        : `Crea la tabla "${pluralize(p)}" con ${cols.map((c) => c.name.replace(`${p}_`, '')).join(', ')} y sustitúyelos por una FK "${p}_id".`,
      fix: {
        kind: 'extract-entity',
        sourceTableId: t.id,
        columnIds: cols.map((c) => c.id),
        targetTableId: refTable?.id,
        newTableName: pluralize(p),
        linkColumnId: link?.id,
        linkColumnName: `${p}_id`,
        stripPrefix: `${p}_`,
      },
    })
  }
}

function ruleDuplicatedColumns(ctx: Ctx) {
  for (const r of ctx.schema.relations) {
    const parent = ctx.tableById.get(r.sourceTableId)
    const child = ctx.tableById.get(r.targetTableId)
    if (!parent || !child || parent.id === child.id) continue
    for (const c of child.columns) {
      const lower = c.name.toLowerCase()
      if (c.pk || ctx.handled.has(c.id) || ctx.fkByColumn.has(c.id) || GENERIC_COLUMNS.has(lower)) continue
      const twin = parent.columns.find((x) => !x.pk && x.name.toLowerCase() === lower)
      if (!twin) continue
      ctx.handled.add(c.id)
      const historical = splitWords(c.name).some((w) => MONEY_WORDS.has(w))
      const fkCol = child.columns.find((x) => x.id === r.targetColumnId)
      push(ctx, {
        rule: 'columna-duplicada',
        level: '3FN',
        severity: historical ? 'baja' : 'media',
        tableId: child.id,
        columnIds: [c.id],
        title: `"${c.name}" duplicada en ${child.name} y ${parent.name}`,
        explanation: `"${child.name}.${c.name}" repite "${parent.name}.${c.name}", que ya es accesible con un JOIN a través de "${fkCol?.name ?? 'la FK'}". Guardar el mismo dato en dos sitios crea una dependencia transitiva: si se actualiza en uno y no en el otro, la base queda inconsistente.${historical ? ' Excepción válida: si es un valor histórico (p. ej. el precio en el momento de la venta), la copia es intencional y conviene renombrarla para que quede claro (precio_unitario, precio_venta…).' : ''}`,
        suggestion: historical
        ? `Si no es un valor histórico, elimínala de "${child.name}" y obtenla con un JOIN.`
        : `Elimina "${c.name}" de "${child.name}" y consúltala con un JOIN a "${parent.name}".`,
        fix: { kind: 'drop-columns', tableId: child.id, columnIds: [c.id] },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// BCNF
// ---------------------------------------------------------------------------

function ruleOverlappingKeys(ctx: Ctx, t: Table) {
  const pk = new Set(t.columns.filter((c) => c.pk).map((c) => c.id))
  if (pk.size < 2) return
  for (const idx of t.indexes) {
    if (!idx.unique || idx.columnIds.length < 2) continue
    const overlap = idx.columnIds.filter((id) => pk.has(id))
    const inPk = idx.columnIds.every((id) => pk.has(id))
    const pkInIdx = [...pk].every((id) => idx.columnIds.includes(id))
    if (!overlap.length || inPk || pkInIdx) continue
    const names = (ids: string[]) => ids.map((id) => t.columns.find((c) => c.id === id)?.name ?? '?').join(', ')
    push(ctx, {
      rule: 'claves-superpuestas',
      level: 'BCNF',
      severity: 'media',
      tableId: t.id,
      columnIds: idx.columnIds.filter((id) => !pk.has(id)),
      title: `Claves candidatas superpuestas en ${t.name}`,
      explanation: `"${t.name}" tiene dos claves candidatas que comparten columnas: la PK (${names([...pk])}) y el índice único "${idx.name}" (${names(idx.columnIds)}). Es el escenario típico en el que una tabla cumple 3FN pero no BCNF: alguna columna que no es clave completa (p. ej. ${names(idx.columnIds.filter((id) => !pk.has(id)))}) determina parte de la clave, lo que provoca redundancia y anomalías de actualización.`,
      suggestion: `Revisa las dependencias: si ${names(idx.columnIds.filter((id) => !pk.has(id)))} determina ${names(overlap)}, descompón la tabla en dos (una con ese determinante como clave). La descomposición BCNF puede perder dependencias, así que valora si compensa.`,
    })
  }
}

// ---------------------------------------------------------------------------
// Buenas prácticas
// ---------------------------------------------------------------------------

function ruleFkWithoutIndex(ctx: Ctx) {
  const seen = new Set<string>()
  for (const r of ctx.schema.relations) {
    const t = ctx.tableById.get(r.targetTableId)
    const c = t?.columns.find((x) => x.id === r.targetColumnId)
    if (!t || !c || seen.has(c.id)) continue
    seen.add(c.id)
    const firstPk = t.columns.find((x) => x.pk)
    const covered = c.unique || firstPk?.id === c.id || t.indexes.some((i) => i.columnIds[0] === c.id)
    if (covered) continue
    const parent = ctx.tableById.get(r.sourceTableId)
    const name = `idx_${toSnakeCase(t.name)}_${toSnakeCase(c.name)}`
    push(ctx, {
      rule: 'fk-sin-indice',
      level: 'buenas-prácticas',
      severity: 'media',
      tableId: t.id,
      columnIds: [c.id],
      title: `FK sin índice: ${t.name}.${c.name}`,
      explanation: `"${c.name}" referencia a "${parent?.name ?? '?'}", pero no tiene índice. PostgreSQL no indexa automáticamente las FK: los JOIN y los filtros por "${c.name}" recorrerán toda la tabla, y cada DELETE/UPDATE en "${parent?.name ?? 'la tabla padre'}" tendrá que escanear "${t.name}" para comprobar la integridad.`,
      suggestion: `Crea el índice ${name} sobre ${t.name}(${c.name}).`,
      fix: { kind: 'add-index', tableId: t.id, columnIds: [c.id], name },
    })
  }
}

function ruleNaming(ctx: Ctx) {
  const style = (n: string) => (/[A-Z]/.test(n) ? 'camel' : n.includes('_') ? 'snake' : 'neutral')
  let camel = 0
  let snake = 0
  for (const t of ctx.schema.tables)
    for (const n of [t.name, ...t.columns.map((c) => c.name)]) {
      const s = style(n)
      if (s === 'camel') camel++
      else if (s === 'snake') snake++
    }
  if (camel && snake) {
    const majority = snake >= camel ? 'snake' : 'camel'
    const convert = majority === 'snake' ? toSnakeCase : toCamelCase
    const label = majority === 'snake' ? 'snake_case' : 'camelCase'
    for (const t of ctx.schema.tables) {
      const odd = t.columns.filter((c) => style(c.name) !== majority && style(c.name) !== 'neutral')
      if (odd.length)
        push(ctx, {
          rule: 'nombres-inconsistentes',
          level: 'buenas-prácticas',
          severity: 'baja',
          tableId: t.id,
          columnIds: odd.map((c) => c.id),
          title: `Estilo de nombres mezclado en ${t.name}`,
          explanation: `El esquema usa mayoritariamente ${label}, pero ${odd.map((c) => `"${c.name}"`).join(', ')} siguen otro estilo. No rompe la normalización, pero dificulta escribir consultas y mapear el modelo en el código. En PostgreSQL además los nombres con mayúsculas exigen comillas dobles.`,
          suggestion: `Renombra a ${label}: ${odd.map((c) => `${c.name} → ${convert(c.name)}`).join(', ')}.`,
          fix: { kind: 'rename-columns', tableId: t.id, renames: odd.map((c) => ({ columnId: c.id, newName: convert(c.name) })) },
        })
      if (style(t.name) !== majority && style(t.name) !== 'neutral')
        push(ctx, {
          rule: 'nombres-inconsistentes',
          level: 'buenas-prácticas',
          severity: 'baja',
          tableId: t.id,
          columnIds: [],
          title: `La tabla "${t.name}" no sigue ${label}`,
          explanation: `El resto del esquema usa ${label}. Mantener una convención única hace el modelo predecible.`,
          suggestion: `Renombra la tabla a "${convert(t.name)}".`,
          fix: { kind: 'rename-table', tableId: t.id, newName: convert(t.name) },
        })
    }
  }

  // Tablas en singular y en plural mezcladas.
  const plural = ctx.schema.tables.filter((t) => isPluralTableName(t.name))
  const singular = ctx.schema.tables.filter((t) => !isPluralTableName(t.name))
  if (plural.length && singular.length) {
    const minority = plural.length >= singular.length ? singular : plural
    const toPlural = minority === singular
    for (const t of minority) {
      const newName = toPlural ? pluralize(toSnakeCase(t.name)) : singularize(toSnakeCase(t.name))
      if (newName === toSnakeCase(t.name)) continue
      push(ctx, {
        rule: 'tabla-singular-plural',
        level: 'buenas-prácticas',
        severity: 'baja',
        tableId: t.id,
        columnIds: [],
        title: `"${t.name}" rompe la convención ${toPlural ? 'plural' : 'singular'}`,
        explanation: `La mayoría de las tablas están en ${toPlural ? 'plural' : 'singular'} y "${t.name}" no. Elegir una sola convención evita dudas al escribir consultas (¿era "cliente" o "clientes"?).`,
        suggestion: `Renómbrala a "${newName}" (los cuerpos de funciones que la mencionan se actualizan también).`,
        fix: { kind: 'rename-table', tableId: t.id, newName },
      })
    }
  }

  // Palabras reservadas.
  for (const t of ctx.schema.tables) {
    if (RESERVED_WORDS.has(t.name.toLowerCase())) {
      const newName = pluralize(RESERVED_REPLACEMENTS[t.name.toLowerCase()] ?? `${t.name}_t`)
      push(ctx, {
        rule: 'palabra-reservada',
        level: 'buenas-prácticas',
        severity: 'media',
        tableId: t.id,
        columnIds: [],
        title: `"${t.name}" es una palabra reservada de SQL`,
        explanation: `Usar palabras reservadas como nombre obliga a citarlas siempre ("${t.name}") y provoca errores de sintaxis difíciles de ver.`,
        suggestion: `Renombra la tabla a "${newName}".`,
        fix: { kind: 'rename-table', tableId: t.id, newName },
      })
    }
    const reserved = t.columns.filter((c) => RESERVED_WORDS.has(c.name.toLowerCase()))
    if (reserved.length)
      push(ctx, {
        rule: 'palabra-reservada',
        level: 'buenas-prácticas',
        severity: 'baja',
        tableId: t.id,
        columnIds: reserved.map((c) => c.id),
        title: `Columnas con nombre reservado en ${t.name}`,
        explanation: `${reserved.map((c) => `"${c.name}"`).join(', ')} son palabras reservadas de SQL: habrá que escribirlas entre comillas en cada consulta.`,
        suggestion: `Renómbralas: ${reserved.map((c) => `${c.name} → ${RESERVED_REPLACEMENTS[c.name.toLowerCase()] ?? `${c.name}_valor`}`).join(', ')}.`,
        fix: {
          kind: 'rename-columns',
          tableId: t.id,
          renames: reserved.map((c) => ({ columnId: c.id, newName: RESERVED_REPLACEMENTS[c.name.toLowerCase()] ?? `${c.name}_valor` })),
        },
      })
  }
}

function ruleTypes(ctx: Ctx, t: Table) {
  const dateTime = ctx.dialect === 'mysql' ? 'datetime' : ctx.dialect === 'sqlserver' ? 'datetime2' : 'timestamptz'
  for (const c of t.columns) {
    const words = splitWords(c.name)
    if (words.some((w) => MONEY_WORDS.has(w)) && isFloat(c)) {
      const newType = ctx.dialect === 'mysql' ? 'decimal(12,2)' : 'numeric(12,2)'
      push(ctx, {
        rule: 'tipo-dinero-float',
        level: 'buenas-prácticas',
        severity: 'alta',
        tableId: t.id,
        columnIds: [c.id],
        title: `Importe en coma flotante: ${t.name}.${c.name}`,
        explanation: `"${c.name}" guarda dinero en ${c.type}. Los tipos de coma flotante son aproximados (0.1 + 0.2 = 0.30000000000000004): al sumar importes aparecen céntimos fantasma y las comparaciones de igualdad fallan.`,
        suggestion: `Usa un tipo decimal exacto: ${newType}.`,
        fix: { kind: 'change-type', tableId: t.id, columnId: c.id, newType },
      })
      continue
    }
    const isDateName = words.some((w) => DATE_WORDS.has(w)) || /_at$/.test(c.name) || /^(created|updated|deleted)At$/.test(c.name)
    if (isDateName && TEXT_TYPE.test(c.type) && ctx.dialect !== 'sqlite') {
      const newType = TIME_HINT.test(c.name) ? dateTime : 'date'
      push(ctx, {
        rule: 'tipo-fecha-texto',
        level: 'buenas-prácticas',
        severity: 'media',
        tableId: t.id,
        columnIds: [c.id],
        title: `Fecha guardada como texto: ${t.name}.${c.name}`,
        explanation: `"${c.name}" es ${c.type}. Con fechas en texto la base no valida el formato ("31/02/2024" sería aceptado), ordenar da resultados alfabéticos y no puedes usar funciones de fecha ni rangos con índices.`,
        suggestion: `Cambia el tipo a ${newType}.`,
        fix: { kind: 'change-type', tableId: t.id, columnId: c.id, newType },
      })
      continue
    }
    if (BOOL_PREFIX.test(c.name) && /^(char\s*\(\s*1\s*\)|varchar|text|character)/i.test(c.type.trim())) {
      push(ctx, {
        rule: 'tipo-booleano-texto',
        level: 'buenas-prácticas',
        severity: 'baja',
        tableId: t.id,
        columnIds: [c.id],
        title: `Booleano guardado como texto: ${t.name}.${c.name}`,
        explanation: `"${c.name}" representa un sí/no pero es ${c.type}: admite valores como "S", "si", "true" o "1" a la vez, y cada consulta tiene que adivinar cuál se usó.`,
        suggestion: `Usa el tipo boolean.`,
        fix: { kind: 'change-type', tableId: t.id, columnId: c.id, newType: 'boolean' },
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Vistas
// ---------------------------------------------------------------------------

function ruleViews(ctx: Ctx) {
  const views = ctx.schema.views ?? []
  const refreshed = new Set(ctx.schema.functions.flatMap((f) => detectRefreshes(f, ctx.schema).map((v) => v.id)))
  for (const v of views) {
    const kind = v.materialized ? 'vista materializada' : 'vista'
    const problems = checkView(v, ctx.schema)
    if (problems.length) {
      const missingCols = problems.filter((p) => p.kind === 'missing-column').map((p) => p.ref)
      const missingTables = problems.filter((p) => p.kind === 'missing-table').map((p) => p.ref)
      const missingSources = problems.filter((p) => p.kind === 'missing-source').length
      const parts = [
        missingCols.length ? `columnas que no existen (${missingCols.join(', ')})` : null,
        missingTables.length ? `tablas que no existen (${missingTables.join(', ')})` : null,
        missingSources ? `${missingSources} origen(es) eliminados del esquema` : null,
      ].filter(Boolean)
      push(ctx, {
        rule: 'vista-rota',
        level: 'buenas-prácticas',
        severity: 'alta',
        tableId: v.id,
        viewId: v.id,
        columnIds: [],
        title: `La ${kind} "${v.name}" referencia elementos inexistentes`,
        explanation: `La definición de "${v.name}" usa ${parts.join(' y ')}. Suele pasar al renombrar o mover columnas (por ejemplo, al normalizar): la vista deja de compilar y cualquier consulta o informe que dependa de ella falla al desplegar la migración.`,
        suggestion: `Actualiza el SELECT de "${v.name}" en el diagrama: cambia las referencias a las columnas nuevas o añade el JOIN a la tabla donde ahora viven los datos.`,
      })
    }
    if (v.materialized && !refreshed.has(v.id))
      push(ctx, {
        rule: 'vista-sin-refresco',
        level: 'buenas-prácticas',
        severity: 'media',
        tableId: v.id,
        viewId: v.id,
        columnIds: [],
        title: `"${v.name}" nunca se refresca`,
        explanation: `Una vista materializada guarda una copia del resultado: no se actualiza sola. Ninguna función del esquema ejecuta REFRESH MATERIALIZED VIEW ${v.name}, así que mostrará datos cada vez más antiguos a medida que cambien sus tablas de origen.`,
        suggestion: `En la vista Triggers usa la plantilla "Refrescar vista materializada" sobre una de sus tablas de origen, o programa el refresco (pg_cron) si las escrituras son muy frecuentes.`,
      })
    if (!isViewUsed(v, ctx.schema))
      push(ctx, {
        rule: 'vista-sin-uso',
        level: 'buenas-prácticas',
        severity: 'baja',
        tableId: v.id,
        viewId: v.id,
        columnIds: [],
        title: `"${v.name}" no se usa dentro del esquema`,
        explanation: `Ninguna otra vista, función ni trigger hace referencia a "${v.name}". Puede que la consuma la aplicación, pero si no es así es código muerto: hay que mantenerla en cada migración y${v.materialized ? ' además ocupa espacio y tiempo de refresco.' : ' puede romperse sin que nadie lo note.'}`,
        suggestion: `Confirma si la aplicación o algún informe la consulta. Si no, elimínala.`,
        fix: { kind: 'drop-view', viewId: v.id },
      })
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<NormalLevel, number> = Object.fromEntries(LEVELS.map((l, i) => [l, i])) as Record<NormalLevel, number>

export function analyzeSchema(schema: Schema): Finding[] {
  const ctx: Ctx = {
    schema,
    dialect: schema.dialect,
    tableById: new Map(schema.tables.map((t) => [t.id, t])),
    fkByColumn: new Map(schema.relations.map((r) => [r.targetColumnId, r])),
    handled: new Set(),
    out: [],
  }
  // El orden importa: las reglas más específicas marcan columnas como "explicadas".
  for (const t of schema.tables) ruleNoPk(ctx, t)
  for (const t of schema.tables) ruleRepeatingGroups(ctx, t)
  for (const t of schema.tables) ruleMultivalued(ctx, t)
  for (const t of schema.tables) rulePartialDependency(ctx, t)
  for (const t of schema.tables) ruleTransitive(ctx, t)
  ruleDuplicatedColumns(ctx)
  for (const t of schema.tables) ruleOverlappingKeys(ctx, t)
  ruleFkWithoutIndex(ctx)
  ruleNaming(ctx)
  for (const t of schema.tables) ruleTypes(ctx, t)
  ruleViews(ctx)

  return ctx.out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

export interface LevelStatus {
  level: Exclude<NormalLevel, 'buenas-prácticas'>
  /** Se alcanza si no hay hallazgos de severidad alta/media en este nivel ni en los anteriores. */
  reached: boolean
  blocking: number
  warnings: number
  /** Tablas sin hallazgos bloqueantes en este nivel. */
  compliantTables: number
  totalTables: number
}

/** Hallazgos que impiden alcanzar una forma normal (los de severidad baja son avisos). */
export const isBlocking = (f: Finding) => f.severity !== 'baja'

export function normalFormStatus(schema: Schema, findings: Finding[]): LevelStatus[] {
  let previousReached = true
  return NORMAL_FORMS.map((level) => {
    const own = findings.filter((f) => f.level === level)
    const blocking = own.filter(isBlocking)
    const badTables = new Set(blocking.map((f) => f.tableId))
    const reached = previousReached && blocking.length === 0 && schema.tables.length > 0
    previousReached = reached
    return {
      level,
      reached,
      blocking: blocking.length,
      warnings: own.length - blocking.length,
      compliantTables: schema.tables.length - badTables.size,
      totalTables: schema.tables.length,
    }
  })
}

/** Mayor forma normal alcanzada, o null si ni siquiera 1FN. */
export function highestNormalForm(schema: Schema, findings: Finding[]): LevelStatus['level'] | null {
  const reached = normalFormStatus(schema, findings).filter((s) => s.reached)
  return reached.length ? reached[reached.length - 1].level : null
}

export const RULE_LABELS: Record<RuleId, string> = {
  'sin-pk': 'Sin clave primaria',
  multivaluada: 'Columna multivaluada',
  'grupo-repetitivo': 'Grupo repetitivo',
  'dependencia-parcial': 'Dependencia parcial',
  'dependencia-transitiva': 'Dependencia transitiva',
  'claves-superpuestas': 'Claves superpuestas',
  'fk-sin-indice': 'FK sin índice',
  'columna-duplicada': 'Columna duplicada',
  'nombres-inconsistentes': 'Nombres inconsistentes',
  'tabla-singular-plural': 'Singular / plural',
  'palabra-reservada': 'Palabra reservada',
  'tipo-dinero-float': 'Dinero en float',
  'tipo-fecha-texto': 'Fecha como texto',
  'tipo-booleano-texto': 'Booleano como texto',
  'vista-rota': 'Vista rota',
  'vista-sin-uso': 'Vista sin uso',
  'vista-sin-refresco': 'Vista sin refresco',
}
