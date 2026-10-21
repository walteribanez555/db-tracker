// Troceado de scripts SQL en sentencias respetando cadenas, identificadores citados,
// comentarios y cuerpos $$ ... $$ de PostgreSQL. Sin dependencias: lo usa también el servidor.

export interface SplitOptions {
  /** Elimina los comentarios (-- y /* *\/). Por defecto true. */
  stripComments?: boolean
}

export function splitStatements(sql: string, opts: SplitOptions = {}): string[] {
  const strip = opts.stripComments ?? true
  const out: string[] = []
  let buf = ''
  let i = 0
  let delim = ';'
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]
    // DELIMITER $$ (cliente mysql): cambia el separador de sentencias.
    if ((ch === 'D' || ch === 'd') && !buf.trim() && (i === 0 || sql[i - 1] === '\n' || /\s/.test(sql[i - 1]))) {
      const dm = /^DELIMITER[ \t]+(\S+)[^\n]*/i.exec(sql.slice(i, i + 64))
      if (dm) {
        delim = dm[1]
        i += dm[0].length
        continue
      }
    }
    // Comentario de línea
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? n : end
      if (!strip) buf += sql.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '#' && /^\s*$/.test(buf.split('\n').pop() ?? '')) {
      // Comentario MySQL al inicio de línea
      const end = sql.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    // Comentario de bloque
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      if (!strip) buf += sql.slice(i, stop)
      else buf += ' '
      i = stop
      continue
    }
    // Cadenas e identificadores citados
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === '\\' && ch === "'") {
          j += 2
          continue
        }
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      buf += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (delim !== ';' && sql.startsWith(delim, i)) {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      i += delim.length
      continue
    }
    // Dollar quoting: $$ ... $$ o $tag$ ... $tag$ (no aplica si el delimitador es $$)
    if (ch === '$' && delim === ';') {
      const m = /^\$([A-Za-z_][\w]*)?\$/.exec(sql.slice(i, i + 64))
      if (m) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        const stop = end === -1 ? n : end + tag.length
        buf += sql.slice(i, stop)
        i = stop
        continue
      }
    }
    if (ch === ';' && delim === ';') {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      i++
      continue
    }
    buf += ch
    i++
  }
  if (buf.trim()) out.push(buf.trim())
  // Separadores GO de SQL Server
  return out.flatMap((s) => s.split(/^\s*GO\s*$/gim)).map((s) => s.trim()).filter(Boolean)
}
