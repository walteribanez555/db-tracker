// Utilidades de nombres (español/inglés) para las heurísticas de normalización.

/** Palabras terminadas en "s" que no son plurales o que suelen ser texto libre. */
const NOT_PLURAL = new Set([
  'status',
  'estatus',
  'address',
  'alias',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'mes',
  'tos',
  'gps',
  'sms',
  'ms',
  'bytes',
  'is',
  'has',
  'pais',
  'tesis',
  'crisis',
  'analisis',
  'dosis',
  'news',
  'series',
  'species',
  'class',
  'pass',
  'business',
  'process',
  'access',
  'success',
  'canvas',
  'virus',
  'campus',
  'bonus',
  'plus',
  'menos',
  'mas',
  'vez',
  'antes',
  'despues',
  'demas',
])

/** Plurales que, en columnas de texto, casi siempre son listas. */
export const STRONG_MULTIVALUED = new Set([
  'telefonos',
  'phones',
  'emails',
  'correos',
  'tags',
  'etiquetas',
  'productos',
  'products',
  'categorias',
  'categories',
  'direcciones',
  'addresses',
  'hijos',
  'roles',
  'permisos',
  'permissions',
  'items',
  'skills',
  'habilidades',
  'idiomas',
  'languages',
  'autores',
  'authors',
  'materias',
  'cursos',
  'alergias',
  'colores',
  'tallas',
  'ids',
  'miembros',
  'participantes',
  'invitados',
  'responsables',
  'archivos',
  'adjuntos',
  'imagenes',
  'fotos',
])

/** Plurales que suelen ser texto libre (no listas): no se marcan como multivaluados. */
const FREE_TEXT_PLURALS = new Set([
  'observaciones',
  'notas',
  'comentarios',
  'detalles',
  'instrucciones',
  'indicaciones',
  'notes',
  'comments',
  'details',
  'instructions',
  'datos',
  'antecedentes',
  'condiciones',
  'terminos',
  'requisitos',
  'especificaciones',
  'caracteristicas',
])

const lastWord = (name: string) => {
  const parts = splitWords(name)
  return parts[parts.length - 1] ?? name.toLowerCase()
}

/** Divide snake_case, camelCase o kebab-case en palabras en minúscula. */
export function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

export function isPluralWord(word: string): boolean {
  const w = word.toLowerCase()
  if (w.length < 4 || NOT_PLURAL.has(w)) return false
  if (/(us|is|ss)$/.test(w)) return false
  return w.endsWith('s')
}

export const isPluralName = (name: string) => isPluralWord(lastWord(name))

/** Nombre de tabla en plural si alguna palabra lo es: `pedidos_legacy`, `pedido_items`. */
export const isPluralTableName = (name: string) => splitWords(name).some(isPluralWord)

/** True si alguna palabra del nombre sugiere texto libre o datos opacos (notas, datos_extra...). */
export function isFreeTextPlural(name: string): boolean {
  return splitWords(name).some((w) => FREE_TEXT_PLURALS.has(w))
}

export function isStrongMultivalued(name: string): boolean {
  return STRONG_MULTIVALUED.has(lastWord(name))
}

/** Singular aproximado de una palabra (heurístico). */
export function singularizeWord(word: string): string {
  const w = word.toLowerCase()
  if (!isPluralWord(w)) return w
  if (w.endsWith('ciones')) return w.slice(0, -6) + 'cion'
  if (w.endsWith('siones')) return w.slice(0, -6) + 'sion'
  if (w.endsWith('ces')) return w.slice(0, -3) + 'z'
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (/[lrndj]es$/.test(w)) return w.slice(0, -2)
  return w.slice(0, -1)
}

/** Singular de un nombre compuesto: solo se singulariza la última palabra. */
export function singularize(name: string): string {
  const parts = splitWords(name)
  if (!parts.length) return name
  parts[parts.length - 1] = singularizeWord(parts[parts.length - 1])
  return parts.join('_')
}

export function pluralizeWord(word: string): string {
  const w = word.toLowerCase()
  if (isPluralWord(w)) return w
  if (/[aeiouáéó]$/.test(w)) return w + 's'
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies'
  if (w.endsWith('z')) return w.slice(0, -1) + 'ces'
  if (w.endsWith('cion')) return w + 'es'
  if (/[lrndj]$/.test(w)) return w + 'es'
  return w + 's'
}

export function pluralize(name: string): string {
  const parts = splitWords(name)
  if (!parts.length) return name
  parts[parts.length - 1] = pluralizeWord(parts[parts.length - 1])
  return parts.join('_')
}

export const isCamelCase = (name: string) => /^[a-z][a-z0-9]*[A-Z]/.test(name)
export const isSnakeCase = (name: string) => /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name)
export const toSnakeCase = (name: string) => splitWords(name).join('_')
export function toCamelCase(name: string): string {
  const [first, ...rest] = splitWords(name)
  return (first ?? '') + rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

/** Nombre "de entidad" de una tabla para comparar prefijos: pedidos → pedido. */
export const entityOf = (tableName: string) => singularize(toSnakeCase(tableName))

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Palabras reservadas habituales que conviene evitar como nombres. */
export const RESERVED_WORDS = new Set([
  'user',
  'order',
  'group',
  'table',
  'select',
  'from',
  'where',
  'key',
  'index',
  'column',
  'default',
  'check',
  'limit',
  'offset',
  'desc',
  'asc',
  'references',
  'primary',
  'foreign',
  'constraint',
  'grant',
  'role',
  'session',
])
