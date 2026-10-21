// Genera, en el cliente, los archivos de cada versión que se publican como commit.
// Reutiliza los exportadores compartidos (src/lib/exporters) para no duplicarlos en el servidor.
import { exportSchema, generateMigration } from '@/lib/exporters'
import { emptySchema } from '@/store/project'
import type { Branch, Project, Schema, Version, View } from '@/types/schema'

import { PROJECT_META_PATH, type ProjectMetaFile, type SyncBranchInput, type SyncFile, type SyncInput, type SyncVersionInput } from './types'

const emptySchemaLike = (dialect: Schema['dialect']): Schema => emptySchema(dialect)
/** Versiones antiguas pueden no traer `views`. */
const viewsOf = (s: Schema): View[] => s.views ?? []

export const slugify = (s: string, max = 40) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max) || 'version'

const mdCell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** Profundidad de una versión en su linaje (raíz = 1). Numera las migraciones. */
export function versionDepth(versions: Version[]): Map<string, number> {
  const byId = new Map(versions.map((v) => [v.id, v]))
  const memo = new Map<string, number>()
  const depth = (v: Version, guard = 0): number => {
    const cached = memo.get(v.id)
    if (cached) return cached
    const parent = v.parentId ? byId.get(v.parentId) : undefined
    const d = parent && guard < 10_000 ? depth(parent, guard + 1) + 1 : 1
    memo.set(v.id, d)
    return d
  }
  versions.forEach((v) => depth(v))
  return memo
}

// ---------- Mermaid (respaldo si el exportador aún no lo implementa) ----------

const looksLikeMermaid = (s: string) => /^\s*(erDiagram|classDiagram|flowchart|graph)\b/m.test(s)
const mmdId = (s: string) => s.replace(/[^\w]/g, '_') || '_'

function fallbackMermaid(schema: Schema): string {
  const lines = ['erDiagram']
  for (const t of schema.tables) {
    lines.push(`  ${mmdId(t.name)} {`)
    for (const c of t.columns) {
      const keys = [c.pk && 'PK', schema.relations.some((r) => r.targetColumnId === c.id) && 'FK', c.unique && !c.pk && 'UK']
        .filter(Boolean)
        .join(',')
      lines.push(`    ${mmdId(c.type)} ${mmdId(c.name)}${keys ? ` ${keys}` : ''}`)
    }
    lines.push('  }')
  }
  const card = { '1:1': '||--||', '1:N': '||--o{', 'N:M': '}o--o{' } as const
  for (const r of schema.relations) {
    const s = schema.tables.find((t) => t.id === r.sourceTableId)
    const t = schema.tables.find((x) => x.id === r.targetTableId)
    if (!s || !t) continue
    const col = t.columns.find((c) => c.id === r.targetColumnId)?.name ?? 'fk'
    lines.push(`  ${mmdId(s.name)} ${card[r.cardinality]} ${mmdId(t.name)} : "${(r.name ?? col).replace(/"/g, "'")}"`)
  }
  return lines.join('\n') + '\n'
}

// ---------- README ----------

function readme(project: Project, branch: Branch | undefined, version: Version, mermaid: string, markdownDoc: string | null) {
  const s = version.schema
  const fork = branch?.forkedFromVersionId ? project.versions.find((v) => v.id === branch.forkedFromVersionId) : undefined
  const forkBranch = fork ? project.branches.find((b) => b.id === fork.branchId) : undefined
  const date = new Date(version.createdAt)
  const lines = [
    `# ${project.name} · ${branch?.name ?? 'main'}`,
    '',
    branch?.description ? `> ${branch.description.replace(/\n/g, '\n> ')}` : '> Flujo sin descripción.',
    '',
    `| | |`,
    `|---|---|`,
    `| Versión | ${mdCell(version.message)} |`,
    `| Autor | ${mdCell(version.author)} |`,
    `| Fecha | ${Number.isNaN(date.getTime()) ? version.createdAt : date.toISOString().replace('T', ' ').slice(0, 16)} UTC |`,
    `| Dialecto | ${s.dialect} |`,
    ...(fork ? [`| Bifurcado de | \`${forkBranch?.name ?? '?'}\` · ${mdCell(fork.message)} |`] : []),
    '',
    `## Tablas (${s.tables.length})`,
    '',
  ]
  if (s.tables.length) {
    lines.push('| Tabla | Columnas | Clave primaria | Relaciones | Descripción |', '|---|---:|---|---:|---|')
    for (const t of s.tables) {
      const pk = t.columns.filter((c) => c.pk).map((c) => c.name).join(', ') || '—'
      const rels = s.relations.filter((r) => r.sourceTableId === t.id || r.targetTableId === t.id).length
      lines.push(`| \`${mdCell(t.name)}\` | ${t.columns.length} | ${mdCell(pk)} | ${rels} | ${mdCell(t.comment)} |`)
    }
  } else {
    lines.push('_Sin tablas en esta versión._')
  }
  const views = viewsOf(s)
  const sourceName = (id: string) => s.tables.find((t) => t.id === id)?.name ?? views.find((v) => v.id === id)?.name ?? '?'
  lines.push('', `## Vistas (${views.length})`, '')
  if (views.length) {
    lines.push('| Vista | Tipo | Lee de | Columnas | Descripción |', '|---|---|---|---:|---|')
    for (const v of views) {
      const sources = v.sourceIds.map((id) => `\`${mdCell(sourceName(id))}\``).join(', ') || '—'
      lines.push(
        `| \`${mdCell(v.name)}\` | ${v.materialized ? 'materializada' : 'normal'} | ${sources} | ${v.columns.length} | ${mdCell(v.comment)} |`,
      )
    }
  } else {
    lines.push('_Sin vistas en esta versión._')
  }
  lines.push('', `## Triggers (${s.triggers.length})`, '')
  if (s.triggers.length) {
    lines.push('| Trigger | Tabla | Momento | Eventos | Nivel | Función |', '|---|---|---|---|---|---|')
    for (const t of s.triggers) {
      const tn = s.tables.find((x) => x.id === t.tableId)?.name ?? '?'
      const fn = s.functions.find((f) => f.id === t.functionId)?.name ?? '?'
      lines.push(
        `| \`${mdCell(t.name)}\` | \`${mdCell(tn)}\` | ${t.timing} | ${t.events.join(', ')} | ${t.level === 'ROW' ? 'por fila' : 'por sentencia'} | \`${mdCell(fn)}()\` |`,
      )
    }
  } else {
    lines.push('_Sin triggers en esta versión._')
  }
  lines.push(
    '',
    '## Diagrama',
    '',
    '```mermaid',
    mermaid.trim(),
    '```',
    '',
    '## Archivos',
    '',
    '- `schema.sql` — DDL completo',
    '- `schema.dbml` — DBML (dbdiagram.io)',
    '- `schema.json` — modelo de DB Tracker',
    '- `diagram.mmd` — diagrama Mermaid',
    '- `migrations/` — una migración por versión del linaje de este flujo',
    '- `.dbtracker/project.json` — metadatos del proyecto (ramas, colores, descripciones) para volver a bajarlo',
  )
  if (markdownDoc) lines.push('', '## Documentación del esquema', '', markdownDoc.trim())
  lines.push('', '---', '', '_Generado por DB Tracker._', '')
  return lines.join('\n')
}

// ---------- Ensamblado ----------

export function buildVersionFiles(project: Project, version: Version, depth: number): SyncFile[] {
  const schema = version.schema
  const dialect = schema.dialect ?? project.dialect
  const opts = { name: 'schema', dialect }
  const sql = exportSchema(schema, 'sql', opts).content
  const dbml = exportSchema(schema, 'dbml', opts).content
  const json = exportSchema(schema, 'json', opts).content
  const mermaidRaw = exportSchema(schema, 'mermaid', opts).content
  const markdownRaw = exportSchema(schema, 'markdown', opts).content
  const mermaid = looksLikeMermaid(mermaidRaw) ? mermaidRaw : fallbackMermaid(schema)
  const markdownDoc = markdownRaw && markdownRaw !== sql ? markdownRaw.replace(/^#\s.*\n/, '') : null

  const branch = project.branches.find((b) => b.id === version.branchId)
  const parent = version.parentId ? project.versions.find((v) => v.id === version.parentId) : undefined
  const nnn = String(depth).padStart(3, '0')
  const header = [
    `-- Migración ${nnn}: ${version.message.replace(/\n/g, ' ')}`,
    `-- Flujo: ${branch?.name ?? '?'} · Autor: ${version.author} · Fecha: ${version.createdAt}`,
    '',
  ].join('\n')

  return [
    { path: 'schema.sql', content: sql },
    // Si el exportador aún no soporta el formato devuelve SQL: se publica igual con su extensión.
    { path: 'schema.dbml', content: dbml },
    { path: 'schema.json', content: json },
    { path: 'diagram.mmd', content: mermaidRaw },
    { path: 'README.md', content: readme(project, branch, version, mermaid, markdownDoc) },
    { path: `migrations/${nnn}_${slugify(version.message)}.sql`, content: header + generateMigration(parent?.schema ?? emptySchemaLike(dialect), schema, dialect) },
  ]
}

/** Nombre de la rama por defecto: la rama raíz llamada "main" o, si no, la primera sin fork. */
export function defaultBranchName(project: Project): string {
  const roots = project.branches.filter((b) => !b.forkedFromVersionId)
  return (roots.find((b) => b.name === 'main') ?? roots[0] ?? project.branches[0])?.name ?? 'main'
}

/** Metadatos sin versiones: permiten recuperar nombre, dialecto, colores y descripciones al bajar. */
export function projectMeta(project: Project): ProjectMetaFile {
  return {
    format: 'db-tracker/github-meta',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      dialect: project.dialect,
      currentBranch: project.branches.find((b) => b.id === project.currentBranchId)?.name ?? null,
    },
    branches: project.branches.map((b) => ({
      id: b.id,
      name: b.name,
      color: b.color,
      description: b.description,
      createdAt: b.createdAt,
      forkedFromVersionId: b.forkedFromVersionId,
    })),
  }
}

export function buildSyncInput(project: Project, owner: string, repo: string, force: boolean): SyncInput {
  const depths = versionDepth(project.versions)
  const meta: SyncFile = { path: PROJECT_META_PATH, content: JSON.stringify(projectMeta(project), null, 2) + '\n' }
  const versions: SyncVersionInput[] = project.versions.map((v) => ({
    id: v.id,
    branchId: v.branchId,
    parentId: v.parentId,
    message: v.message,
    author: v.author,
    createdAt: v.createdAt,
    githubSha: v.githubSha || undefined,
    files: [...buildVersionFiles(project, v, depths.get(v.id) ?? 1), meta],
  }))
  const branches: SyncBranchInput[] = project.branches.map((b) => ({
    id: b.id,
    name: b.name,
    forkedFromVersionId: b.forkedFromVersionId,
    headVersionId: b.headVersionId,
  }))
  return { owner, repo, force, defaultBranch: defaultBranchName(project), branches, versions }
}

/** Orden en el que el servidor publicará las versiones (padres primero, luego por fecha). */
export function syncOrder(versions: Version[]): Version[] {
  const ids = new Set(versions.map((v) => v.id))
  const children = new Map<string, Version[]>()
  const ready: Version[] = []
  for (const v of versions) {
    if (v.parentId && ids.has(v.parentId)) children.set(v.parentId, [...(children.get(v.parentId) ?? []), v])
    else ready.push(v)
  }
  const out: Version[] = []
  while (ready.length) {
    ready.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    const next = ready.shift()!
    out.push(next)
    ready.push(...(children.get(next.id) ?? []))
  }
  return out
}
