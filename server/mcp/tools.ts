// Herramientas MCP de DB Tracker (contrato: docs/arquitectura/agentes-mcp.md).
// Todas trabajan sobre la sala Yjs de la sesión colaborativa activa. Las que modifican aceptan `agent`: el
// nombre del participante virtual que aparece en la app, con su presencia (editing) y su entrada en Actividad.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type * as Y from 'yjs'
import { z } from 'zod'

import { isDocEmpty, writeBranches, writeVersions } from '../../src/collab/doc.ts'
import { buildFlowRows, estimatedBenchmarks, recommend } from '../../src/features/reports/lib.ts'
import { applyFix, describeFix, fixTableIds } from '../../src/features/normalization/lib/fixes.ts'
import { analyzeSchema, highestNormalForm, normalFormStatus, RULE_LABELS } from '../../src/features/normalization/lib/rules.ts'
import { diffSchemas } from '../../src/lib/diff.ts'
import { computeMigration } from '../../src/lib/exporters/migration.ts'
import { generateSQL } from '../../src/lib/exporters/sql.ts'
import { uid } from '../../src/lib/id.ts'
import type { SchemaDiff } from '../../src/types/report.ts'
import type { Branch, Dialect, Schema, Version } from '../../src/types/schema.ts'
import { PROVISIONAL_PROJECT_NAME } from '../collab/manager.ts'
import { RoomError, type Room, type RoomAgent } from '../collab/room.ts'
import { runBenchmark } from '../lib/db/benchmark.ts'
import { DbError, elapsed, now, withClient } from '../lib/db/client.ts'
import { introspectMysql } from '../lib/db/introspect-mysql.ts'
import { introspectPostgres } from '../lib/db/introspect-pg.ts'
import { suggestQueries } from '../lib/db/samples.ts'
import { connectionSchema, LIMITS, sampleQueriesSchema } from '../lib/db/validation.ts'
import { applyOperations, operationSchema } from './operations.ts'
import {
  agentOrigin,
  BRANCH_COLORS,
  baseSchema,
  benchmarksMap,
  branchDraft,
  branchHeadId,
  compactSchema,
  draftIsDirty,
  normalizeSchema,
  projectOf,
  readBenchmarks,
  readBranches,
  readMeta,
  requireContent,
  resolveBranch,
  resolveRef,
  resolveVersion,
  rootMaps,
  schemaStats,
  ToolError,
  versionById,
  writeBranchDraft,
  type StoredBenchmark,
} from './project.ts'
import type { McpService } from './service.ts'

const SESSION_WAIT_MS = 20_000

/* ───────────────────────── Respuestas ───────────────────────── */

/** Texto resumen + JSON compacto. */
export function ok(summary: string, data?: unknown): CallToolResult {
  const content: CallToolResult['content'] = [{ type: 'text', text: summary }]
  if (data !== undefined) content.push({ type: 'text', text: JSON.stringify(data) })
  return { content }
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

function errorMessage(err: unknown): string {
  if (err instanceof ToolError || err instanceof RoomError || err instanceof DbError) return err.message
  if (err instanceof z.ZodError) {
    const issue = err.issues[0]
    return `Datos no válidos (${issue.path.join('.') || 'entrada'}): ${issue.message}`
  }
  console.error('[mcp] Error inesperado:', err)
  return `Error interno: ${(err as Error)?.message ?? String(err)}`
}

/** Envuelve la herramienta: errores conocidos → isError con su mensaje; registro mínimo (sin argumentos). */
function wrap<A>(name: string, fn: (args: A) => Promise<CallToolResult> | CallToolResult) {
  return async (args: A): Promise<CallToolResult> => {
    const agent = (args as { agent?: string } | undefined)?.agent
    console.log(`[mcp] ${agent ? `${agent} → ` : ''}${name}`)
    try {
      return await fn(args)
    } catch (err) {
      return fail(errorMessage(err))
    }
  }
}

/* ───────────────────────── Sesión ───────────────────────── */

function requireRoom(service: McpService): Room {
  const room = service.collab.room
  if (!room || room.isEnded) {
    throw new ToolError('No hay ninguna sesión colaborativa activa. Llama a session_open para abrir una sesión local con la app de DB Tracker.')
  }
  return room
}

/** Sala con el proyecto ya sembrado por la app. */
function requireDoc(service: McpService): { room: Room; doc: Y.Doc } {
  const room = requireRoom(service)
  requireContent(room.doc)
  return { room, doc: room.doc }
}

/** Participante virtual del agente, activo y con permiso de edición. */
function requireAgent(room: Room, name: string): RoomAgent {
  const agent = room.agent(name)
  if (!agent.active) {
    throw new ToolError(
      `El agente «${agent.name}» está esperando aprobación en la app de DB Tracker (Participantes). Vuelve a intentarlo cuando el anfitrión lo apruebe.`,
    )
  }
  if (agent.participant.role === 'viewer') {
    throw new ToolError(`El anfitrión ha dado al agente «${agent.name}» permiso solo de lectura: no puede modificar el proyecto.`)
  }
  return agent
}

function waitForContent(room: Room, ms: number): Promise<boolean> {
  if (!isDocEmpty(room.doc)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      clearTimeout(timer)
      room.doc.off('update', onUpdate)
      resolve(value)
    }
    const onUpdate = () => {
      if (!isDocEmpty(room.doc)) done(true)
    }
    const timer = setTimeout(() => done(!isDocEmpty(room.doc)), ms)
    room.doc.on('update', onUpdate)
  })
}

function sessionSummary(service: McpService) {
  const room = service.collab.room
  const status = service.collab.status()
  if (!room || !status.session) return null
  const s = status.session
  return {
    id: s.id,
    network: s.network,
    code: s.code,
    projectName: room.projectName,
    hostName: s.hostName,
    startedAt: s.startedAt,
    autoApproveAgents: room.autoApproveAgents,
    seeded: !isDocEmpty(room.doc),
    ownerConnected: room.hasOwner(),
  }
}

const participantsOf = (room: Room) =>
  room.participants().map(({ address: _address, ...p }) => p)

/* ───────────────────────── Utilidades ───────────────────────── */

const DIALECTS = ['postgresql', 'mysql', 'sqlite', 'sqlserver'] as const
const agentParam = z.string().trim().min(1).max(40).describe('Nombre visible del agente en la app (p. ej. «Normalizador»)')
const branchParam = z.string().trim().min(1).max(200).describe('Rama por id o nombre (p. ej. «main» o «flujo/3fn»)')
const connectionParam = connectionSchema.describe(
  'Conexión a una BD real: { dialect, host, port, database, user, password?, ssl? }. La contraseña no se guarda ni se registra.',
)

/** Líneas legibles de un SchemaDiff. */
export function diffActions(d: SchemaDiff): string[] {
  const out: string[] = []
  for (const t of d.addedTables) out.push(`+ tabla ${t}`)
  for (const t of d.removedTables) out.push(`- tabla ${t}`)
  for (const r of d.renamedTables) out.push(`~ tabla ${r.from} → ${r.to}`)
  for (const m of d.modifiedTables) {
    for (const c of m.addedColumns) out.push(`+ ${m.table}.${c}`)
    for (const c of m.removedColumns) out.push(`- ${m.table}.${c}`)
    for (const c of m.changedColumns) out.push(`~ ${m.table}.${c.column}: ${c.changes.join(', ')}`)
  }
  for (const r of d.addedRelations) out.push(`+ relación ${r}`)
  for (const r of d.removedRelations) out.push(`- relación ${r}`)
  for (const v of d.addedViews) out.push(`+ vista ${v}`)
  for (const v of d.removedViews) out.push(`- vista ${v}`)
  for (const v of d.changedViews) out.push(`~ vista ${v}`)
  for (const t of d.addedTriggers) out.push(`+ trigger ${t}`)
  for (const t of d.removedTriggers) out.push(`- trigger ${t}`)
  for (const t of d.changedTriggers) out.push(`~ trigger ${t}`)
  return out
}

function schemaFor(doc: Y.Doc, branchRef: string, versionRef?: string): { schema: Schema; label: string; branch?: Branch; version?: Version } {
  if (versionRef) {
    const version = resolveVersion(doc, versionRef)
    return { schema: normalizeSchema(version.schema), label: `versión ${version.id}`, version }
  }
  const branch = resolveBranch(doc, branchRef)
  return { schema: normalizeSchema(branchDraft(doc, branch.id).schema), label: `${branch.name}@draft`, branch }
}

function projectSummary(doc: Y.Doc) {
  const project = projectOf(doc)
  const meta = readMeta(doc)
  const byBranch = new Map<string, Version[]>()
  for (const v of project.versions) byBranch.set(v.branchId, [...(byBranch.get(v.branchId) ?? []), v])
  const nameOf = (id: string | null) => (id ? project.branches.find((b) => b.id === id)?.name : undefined)
  const versionBranch = (id: string | null) => (id ? nameOf(project.versions.find((v) => v.id === id)?.branchId ?? null) : undefined)
  return {
    project: { id: meta.projectId, name: meta.name, dialect: meta.dialect },
    branches: project.branches.map((b) => {
      const draft = branchDraft(doc, b.id)
      return {
        id: b.id,
        name: b.name,
        description: b.description,
        color: b.color,
        forkedFrom: b.forkedFromVersionId ? { versionId: b.forkedFromVersionId, branch: versionBranch(b.forkedFromVersionId) } : null,
        headVersionId: b.headVersionId,
        versions: byBranch.get(b.id)?.length ?? 0,
        uncommittedChanges: draftIsDirty(doc, draft),
        stats: schemaStats(normalizeSchema(draft.schema)),
      }
    }),
    recentVersions: project.versions
      .slice(-15)
      .reverse()
      .map((v) => ({ id: v.id, branch: nameOf(v.branchId), parentId: v.parentId, message: v.message, author: v.author, createdAt: v.createdAt })),
  }
}

/* ───────────────────────── Registro ───────────────────────── */

export function registerTools(server: McpServer, service: McpService) {
  /* ── Sesión ── */

  server.registerTool(
    'session_status',
    {
      title: 'Estado de la sesión',
      description:
        'Devuelve la sesión colaborativa activa (si la hay), sus participantes (personas y agentes), la actividad reciente y la URL de la app. Llámala primero para saber si hay que abrir sesión.',
      annotations: { readOnlyHint: true },
    },
    wrap('session_status', () => {
      const room = service.collab.room
      const session = sessionSummary(service)
      const data = {
        app: { url: service.url, mcpUrl: service.mcpUrl, runtime: service.options.runtime },
        session,
        participants: room ? participantsOf(room) : [],
        recentActivity: room?.activityLog(10) ?? [],
      }
      if (!session) return ok('No hay sesión activa. Usa session_open para abrir una sesión local con la app.', data)
      const people = data.participants.filter((p) => p.kind !== 'agent').length
      const agents = data.participants.filter((p) => p.kind === 'agent').length
      return ok(
        `Sesión ${session.network === 'local' ? 'local' : 'en red'} «${session.projectName}»: ${people} personas y ${agents} agentes.` +
          (session.seeded ? '' : ' La app aún no ha compartido el proyecto.'),
        data,
      )
    }),
  )

  server.registerTool(
    'session_open',
    {
      title: 'Abrir sesión local',
      description:
        'Abre una sesión LOCAL para agentes (sin red ni mDNS) si no hay ninguna y espera (máx. 20 s) a que la ventana de DB Tracker se una como anfitriona y comparta el proyecto. Si ya hay sesión, solo espera a que tenga proyecto.',
      inputSchema: { projectName: z.string().trim().min(1).max(120).optional().describe('Nombre del proyecto (opcional: se adopta el de la app)') },
    },
    wrap('session_open', async ({ projectName }: { projectName?: string }) => {
      let room = service.collab.room
      let created = false
      if (!room || room.isEnded) {
        await service.collab.share({
          network: 'local',
          projectName: projectName || PROVISIONAL_PROJECT_NAME,
          provisionalName: !projectName,
          hostName: '',
          autoApproveAgents: true,
        })
        room = service.collab.room!
        created = true
      }
      const seeded = await waitForContent(room, SESSION_WAIT_MS)
      const data = { created, session: sessionSummary(service), participants: participantsOf(room) }
      if (!seeded) {
        return fail(
          `${created ? 'He abierto una sesión local para agentes' : 'Hay una sesión activa'}, pero la app de DB Tracker no ha compartido el proyecto en ${SESSION_WAIT_MS / 1000} s. ` +
            `Abre DB Tracker en este equipo${service.url ? ` (${service.url})` : ''}: se une sola como anfitriona. Después vuelve a llamar a session_open.`,
        )
      }
      return ok(`Sesión lista: «${room.projectName}»${created ? ' (sesión local nueva)' : ''}.`, data)
    }),
  )

  /* ── Lectura ── */

  server.registerTool(
    'get_project',
    {
      title: 'Proyecto',
      description: 'Proyecto compartido: dialecto, ramas (descripción, origen, cabeza, nº de versiones, cambios sin confirmar) y últimas versiones.',
      annotations: { readOnlyHint: true },
    },
    wrap('get_project', () => {
      const { doc } = requireDoc(service)
      const data = projectSummary(doc)
      return ok(`«${data.project.name}» (${data.project.dialect}): ${data.branches.length} ramas, ${projectOf(doc).versions.length} versiones.`, data)
    }),
  )

  server.registerTool(
    'get_schema',
    {
      title: 'Esquema',
      description:
        'Esquema de una rama (su borrador compartido, con los cambios sin confirmar) o de una versión: tablas, columnas, relaciones, vistas, funciones, triggers y enums, referenciados por nombre.',
      inputSchema: {
        branch: branchParam,
        version: z.string().trim().min(1).optional().describe('Id de versión (en lugar del borrador)'),
        full: z.boolean().optional().describe('true: JSON completo con ids y posiciones'),
      },
      annotations: { readOnlyHint: true },
    },
    wrap('get_schema', ({ branch, version, full }: { branch: string; version?: string; full?: boolean }) => {
      const { doc } = requireDoc(service)
      const r = schemaFor(doc, branch, version)
      const stats = schemaStats(r.schema)
      const extra = r.branch ? { baseVersionId: branchDraft(doc, r.branch.id).baseVersionId, uncommittedChanges: draftIsDirty(doc, branchDraft(doc, r.branch.id)) } : {}
      return ok(`${r.label}: ${stats.tables} tablas, ${stats.relations} relaciones, ${stats.views} vistas, ${stats.triggers} triggers.`, {
        source: r.label,
        ...extra,
        stats,
        schema: full ? r.schema : compactSchema(r.schema),
      })
    }),
  )

  server.registerTool(
    'get_sql',
    {
      title: 'DDL',
      description: 'DDL (CREATE TABLE, índices, FKs, vistas, funciones y triggers) del borrador de una rama o de una versión.',
      inputSchema: {
        branch: branchParam,
        version: z.string().trim().min(1).optional(),
        dialect: z.enum(DIALECTS).optional().describe('Por defecto, el del proyecto'),
      },
      annotations: { readOnlyHint: true },
    },
    wrap('get_sql', ({ branch, version, dialect }: { branch: string; version?: string; dialect?: Dialect }) => {
      const { doc } = requireDoc(service)
      const r = schemaFor(doc, branch, version)
      const d = dialect ?? r.schema.dialect
      return ok(`-- DDL de ${r.label} (${d})\n${generateSQL(r.schema, d)}`)
    }),
  )

  /* ── Ramas y edición ── */

  server.registerTool(
    'create_branch',
    {
      title: 'Crear flujo',
      description:
        'Crea un flujo (rama) nuevo desde la cabeza de otra rama o desde una versión, con su borrador compartido. Por defecto parte de la cabeza de main.',
      inputSchema: {
        agent: agentParam,
        name: z.string().trim().min(1).max(80).describe('Nombre de la rama, p. ej. «flujo/3fn»'),
        description: z.string().trim().max(500).describe('Qué explora este flujo'),
        from: z.string().trim().min(1).optional().describe('Rama (su cabeza) o id de versión de partida'),
      },
    },
    wrap('create_branch', ({ agent, name, description, from }: { agent: string; name: string; description: string; from?: string }) => {
      const { room, doc } = requireDoc(service)
      const a = requireAgent(room, agent)
      const branches = readBranches(doc)
      if (branches.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw new ToolError(`Ya existe una rama llamada «${name}».`)

      let forkedFromVersionId: string | null
      let fromLabel: string
      if (from) {
        const isBranch = branches.some((b) => b.id === from || b.name.toLowerCase() === from.toLowerCase() || b.name.toLowerCase() === `flujo/${from}`.toLowerCase())
        if (isBranch) {
          const src = resolveBranch(doc, from)
          forkedFromVersionId = branchHeadId(src)
          fromLabel = `cabeza de ${src.name}`
        } else {
          const v = resolveVersion(doc, from)
          forkedFromVersionId = v.id
          fromLabel = `versión ${v.id}`
        }
      } else {
        const main = branches.find((b) => b.name === 'main') ?? branches[0]
        forkedFromVersionId = main ? branchHeadId(main) : null
        fromLabel = main ? `cabeza de ${main.name}` : 'vacío'
      }

      const branch: Branch = {
        id: uid('br_'),
        name,
        description,
        color: BRANCH_COLORS[branches.length % BRANCH_COLORS.length],
        forkedFromVersionId,
        headVersionId: null,
        createdAt: new Date().toISOString(),
      }
      doc.transact(() => {
        writeBranches(doc, [branch], false)
        const base = versionById(doc, forkedFromVersionId)
        writeBranchDraft(
          doc,
          branch.id,
          { schema: structuredClone(base?.schema ?? emptyFor(doc)), baseVersionId: base?.id ?? null },
          null,
        )
      }, agentOrigin(a.name))
      a.setPresence({ branchId: branch.id, editing: { kind: 'branch', id: branch.id, label: name } })
      room.activity(a.participant, 'creó la rama', `${name} (desde ${fromLabel})`, branch.id)
      return ok(`Rama «${name}» creada desde ${fromLabel}.`, { branch })
    }),
  )

  server.registerTool(
    'edit_schema',
    {
      title: 'Editar esquema',
      description:
        'Aplica un lote de operaciones al borrador compartido de una rama, referenciando tablas y columnas por NOMBRE. El lote es atómico: si una operación no es válida no se aplica ninguna y se devuelven los errores. ' +
        'Operaciones: add_table, update_table, remove_table, add_column, update_column, remove_column, move_column, add_index, remove_index, add_relation, update_relation, remove_relation, upsert_enum, remove_enum, upsert_view, remove_view, upsert_function, remove_function, upsert_trigger, remove_trigger, add_note. ' +
        'Ejemplo: { "op": "add_column", "table": "pedidos", "column": { "name": "actualizado_en", "type": "timestamptz", "nullable": false, "default": "now()" } }. ' +
        'Los ids y las posiciones en el lienzo los asigna el servidor.',
      inputSchema: {
        agent: agentParam,
        branch: branchParam,
        operations: z.array(operationSchema).min(1).max(200),
        note: z.string().trim().max(300).optional().describe('Resumen del lote para Actividad'),
      },
    },
    wrap('edit_schema', ({ agent, branch, operations, note }: { agent: string; branch: string; operations: z.infer<typeof operationSchema>[]; note?: string }) => {
      const { room, doc } = requireDoc(service)
      const a = requireAgent(room, agent)
      const b = resolveBranch(doc, branch)
      const prev = branchDraft(doc, b.id)
      const result = applyOperations(normalizeSchema(prev.schema), operations)
      if (result.errors.length) {
        return fail(`No se aplicó ningún cambio (${result.errors.length} ${result.errors.length === 1 ? 'operación no válida' : 'operaciones no válidas'}):\n${result.errors.join('\n')}`)
      }
      // Lectura y escritura en el mismo tick: ninguna actualización remota se cuela entre medias.
      doc.transact(() => writeBranchDraft(doc, b.id, { schema: result.schema, baseVersionId: prev.baseVersionId }, prev), agentOrigin(a.name))
      const jumps = diffSchemas(normalizeSchema(prev.schema), result.schema).jumps
      a.setPresence({ branchId: b.id, editing: result.focus ?? { kind: 'branch', id: b.id, label: b.name } })
      room.activity(a.participant, 'editó el esquema', note || result.changes.slice(0, 4).join('; ') + (result.changes.length > 4 ? '…' : ''), b.id)
      return ok(`${operations.length} operaciones aplicadas al borrador de «${b.name}» (${jumps} saltos respecto al estado anterior). Sin confirmar: usa commit_version.`, {
        branch: b.name,
        changes: result.changes,
        stats: schemaStats(result.schema),
      })
    }),
  )

  server.registerTool(
    'commit_version',
    {
      title: 'Confirmar versión',
      description: 'Confirma el borrador compartido de la rama como una versión nueva (autor = agente). Falla si no hay cambios sin confirmar.',
      inputSchema: { agent: agentParam, branch: branchParam, message: z.string().trim().min(1).max(300).describe('Mensaje de la versión') },
    },
    wrap('commit_version', ({ agent, branch, message }: { agent: string; branch: string; message: string }) => {
      const { room, doc } = requireDoc(service)
      const a = requireAgent(room, agent)
      const b = resolveBranch(doc, branch)
      const draft = branchDraft(doc, b.id)
      if (!draftIsDirty(doc, draft)) throw new ToolError(`El borrador de «${b.name}» no tiene cambios sin confirmar.`)
      const version: Version = {
        id: uid('ver_'),
        branchId: b.id,
        // Misma semántica que commit() del store: el padre es la cabeza de la rama o, si no tiene, la versión de la que nació.
        parentId: b.headVersionId ?? b.forkedFromVersionId,
        message,
        author: a.name,
        createdAt: new Date().toISOString(),
        schema: structuredClone(draft.schema),
      }
      const parentSchema = baseSchema(doc, { schema: draft.schema, baseVersionId: version.parentId })
      doc.transact(() => {
        writeVersions(doc, [version])
        rootMaps(doc).branches.get(b.id)?.set('headVersionId', version.id)
        const ydraft = rootMaps(doc).drafts.get(b.id)
        if (ydraft) ydraft.set('baseVersionId', version.id)
        else writeBranchDraft(doc, b.id, { schema: draft.schema, baseVersionId: version.id }, null)
      }, agentOrigin(a.name))
      const d = diffSchemas(normalizeSchema(parentSchema), normalizeSchema(version.schema))
      a.setPresence({ branchId: b.id, editing: { kind: 'version', id: version.id, label: message } })
      room.activity(a.participant, 'confirmó la versión', `«${message}» en ${b.name}`, b.id)
      return ok(`Versión ${version.id} confirmada en «${b.name}» (${d.jumps} saltos respecto a su padre).`, {
        version: { id: version.id, branch: b.name, parentId: version.parentId, message, author: a.name, createdAt: version.createdAt },
        jumps: d.jumps,
        actions: diffActions(d),
      })
    }),
  )

  /* ── Comparación ── */

  server.registerTool(
    'diff',
    {
      title: 'Diff estructural',
      description: 'Diff estructural entre dos referencias: «rama» (su cabeza), «rama@draft» (borrador compartido) o un id de versión. Devuelve los saltos y la lista de acciones.',
      inputSchema: { from: z.string().trim().min(1), to: z.string().trim().min(1) },
      annotations: { readOnlyHint: true },
    },
    wrap('diff', ({ from, to }: { from: string; to: string }) => {
      const { doc } = requireDoc(service)
      const a = resolveRef(doc, from)
      const b = resolveRef(doc, to)
      const d = diffSchemas(a.schema, b.schema)
      const actions = diffActions(d)
      return ok(`${a.label} → ${b.label}: ${d.jumps} saltos.${actions.length ? `\n${actions.join('\n')}` : ''}`, { from: a.label, to: b.label, diff: d })
    }),
  )

  server.registerTool(
    'generate_migration',
    {
      title: 'Migración SQL',
      description: 'SQL de migración entre dos referencias (rama, rama@draft o versión), incluidos los pasos de copia de datos registrados por la normalización.',
      inputSchema: { from: z.string().trim().min(1), to: z.string().trim().min(1), dialect: z.enum(DIALECTS).optional() },
      annotations: { readOnlyHint: true },
    },
    wrap('generate_migration', ({ from, to, dialect }: { from: string; to: string; dialect?: Dialect }) => {
      const { doc } = requireDoc(service)
      const a = resolveRef(doc, from)
      const b = resolveRef(doc, to)
      const m = computeMigration(a.schema, b.schema, dialect ?? b.schema.dialect)
      if (m.empty) return ok(`No hay diferencias entre ${a.label} y ${b.label}.`, { summary: m.summary })
      return ok(`-- Migración ${a.label} → ${b.label} (${m.summary.statements} sentencias${m.warnings.length ? `, ${m.warnings.length} avisos` : ''})\n${m.sql}`, {
        summary: m.summary,
        warnings: m.warnings,
      })
    }),
  )

  /* ── Normalización ── */

  server.registerTool(
    'analyze_normalization',
    {
      title: 'Analizar normalización',
      description: 'Analiza el borrador de una rama: hallazgos de 1FN a BCNF y buenas prácticas, cada uno con id, severidad y, si existe, plan de corrección aplicable con apply_normalization_fix.',
      inputSchema: { branch: branchParam, version: z.string().trim().min(1).optional() },
      annotations: { readOnlyHint: true },
    },
    wrap('analyze_normalization', ({ branch, version }: { branch: string; version?: string }) => {
      const { doc } = requireDoc(service)
      const r = schemaFor(doc, branch, version)
      const findings = analyzeSchema(r.schema)
      const name = (id: string) => r.schema.tables.find((t) => t.id === id)?.name ?? r.schema.views.find((v) => v.id === id)?.name ?? id
      const col = (tableId: string, id: string) => r.schema.tables.find((t) => t.id === tableId)?.columns.find((c) => c.id === id)?.name ?? id
      const levels = normalFormStatus(r.schema, findings)
      const highest = highestNormalForm(r.schema, findings)
      const data = {
        source: r.label,
        highestNormalForm: highest,
        levels: levels.map((l) => ({ level: l.level, reached: l.reached, blocking: l.blocking, warnings: l.warnings })),
        findings: findings.map((f) => ({
          id: f.id,
          rule: f.rule,
          ruleLabel: RULE_LABELS[f.rule],
          level: f.level,
          severity: f.severity,
          table: name(f.tableId),
          columns: f.columnIds.map((c) => col(f.tableId, c)),
          title: f.title,
          explanation: f.explanation,
          suggestion: f.suggestion,
          fix: f.fix ? describeFix(r.schema, f.fix) : null,
        })),
      }
      return ok(
        `${r.label}: ${findings.length} hallazgos (${findings.filter((f) => f.severity === 'alta').length} de severidad alta). Forma normal alcanzada: ${highest ?? 'ninguna'}.`,
        data,
      )
    }),
  )

  server.registerTool(
    'apply_normalization_fix',
    {
      title: 'Aplicar corrección',
      description: 'Aplica al borrador de la rama la corrección de un hallazgo de analyze_normalization (incluye el paso de copia de datos para la migración). No confirma: usa commit_version.',
      inputSchema: { agent: agentParam, branch: branchParam, finding_id: z.string().trim().min(1).describe('id del hallazgo (de analyze_normalization)') },
    },
    wrap('apply_normalization_fix', ({ agent, branch, finding_id }: { agent: string; branch: string; finding_id: string }) => {
      const { room, doc } = requireDoc(service)
      const a = requireAgent(room, agent)
      const b = resolveBranch(doc, branch)
      const prev = branchDraft(doc, b.id)
      const schema = normalizeSchema(prev.schema)
      const findings = analyzeSchema(schema)
      const finding = findings.find((f) => f.id === finding_id)
      if (!finding) {
        throw new ToolError(
          `No hay ningún hallazgo «${finding_id}» en el borrador actual de «${b.name}» (puede que ya se corrigiera). Hallazgos actuales: ${findings.map((f) => f.id).join(', ') || 'ninguno'}.`,
        )
      }
      if (!finding.fix) throw new ToolError(`El hallazgo «${finding.title}» no tiene corrección automática. Sugerencia: ${finding.suggestion}`)
      const description = describeFix(schema, finding.fix)
      const next = applyFix(schema, finding.fix)
      doc.transact(() => writeBranchDraft(doc, b.id, { schema: next, baseVersionId: prev.baseVersionId }, prev), agentOrigin(a.name))
      const addedMigrations = (next.dataMigrations ?? []).filter((m) => !(schema.dataMigrations ?? []).some((x) => x.id === m.id))
      const d = diffSchemas(schema, next)
      const focusId = fixTableIds(next, finding.fix)[0] ?? finding.tableId
      const focusName = next.tables.find((t) => t.id === focusId)?.name ?? finding.title
      a.setPresence({ branchId: b.id, editing: { kind: 'table', id: focusId, label: focusName } })
      room.activity(a.participant, 'aplicó normalización', `${finding.title} en ${b.name}`, b.id)
      const remaining = analyzeSchema(next)
      return ok(`Corrección aplicada en «${b.name}»: ${description}. Quedan ${remaining.length} hallazgos.`, {
        finding: { id: finding.id, title: finding.title, level: finding.level },
        actions: diffActions(d),
        dataMigrations: addedMigrations.map((m) => ({ description: m.description, sql: m.sql })),
      })
    }),
  )

  server.registerTool(
    'compare_flows',
    {
      title: 'Comparar flujos',
      description:
        'Métricas por flujo (rama): versiones, agilidad, saltos y latencia de consultas (medida con db_benchmark o estimada) con una recomendación del flujo con mejor equilibrio.',
      inputSchema: {
        branches: z.array(z.string().trim().min(1)).optional().describe('Ramas a comparar (por defecto, todas)'),
        latency_weight: z.number().min(0).max(1).optional().describe('Peso de la latencia frente a los saltos (0–1, por defecto 0,5)'),
      },
      annotations: { readOnlyHint: true },
    },
    wrap('compare_flows', ({ branches, latency_weight }: { branches?: string[]; latency_weight?: number }) => {
      const { doc } = requireDoc(service)
      const full = projectOf(doc)
      const ids = branches?.length ? new Set(branches.map((r) => resolveBranch(doc, r).id)) : null
      const project = ids
        ? { ...full, branches: full.branches.filter((b) => ids.has(b.id)), versions: full.versions }
        : full
      const remote = readBenchmarks(doc).filter((bm) => bm.source === 'remote')
      const rows = buildFlowRows(project, remote, estimatedBenchmarks(project), { from: null, to: null }, latency_weight ?? 0.5)
      const rec = recommend(rows)
      return ok(rec?.text ?? 'Sin datos suficientes para recomendar (faltan versiones o latencias).', {
        flows: rows.map((r) => ({
          branch: r.branchName,
          versions: r.versions,
          avgHoursBetweenVersions: r.avgHoursBetweenVersions,
          versionsPerDay: r.versionsPerDay,
          totalJumps: r.totalJumps,
          maxJump: r.maxJump,
          avgQueryMs: r.avgQueryMs,
          p95QueryMs: r.p95QueryMs,
          latencySource: r.latencySource,
          score: r.score,
          ...(r.scoreNote ? { note: r.scoreNote } : {}),
        })),
        recommendation: rec ? { best: rec.best.branchName, runnerUp: rec.runnerUp?.branchName ?? null, fastest: rec.fastest.branchName, calmest: rec.calmest.branchName } : null,
      })
    }),
  )

  /* ── Base de datos real ── */

  server.registerTool(
    'db_introspect',
    {
      title: 'Leer BD real',
      description: 'Lee el esquema de una base de datos real (PostgreSQL o MySQL) en solo lectura. No modifica el proyecto.',
      inputSchema: { connection: connectionParam, schema_name: z.string().trim().max(128).optional().describe('Esquema de PostgreSQL (por defecto public)') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap('db_introspect', async ({ connection, schema_name }: { connection: z.infer<typeof connectionSchema>; schema_name?: string }) => {
      const cfg = connectionSchema.parse(connection)
      const t0 = now()
      const out = await withClient(cfg, async (client) => {
        const serverVersion = await client.serverVersion()
        const r = client.dialect === 'postgresql' ? await introspectPostgres(client, schema_name || 'public') : await introspectMysql(client, cfg.database)
        return { ...r, serverVersion }
      })
      const s = out.schema
      return ok(
        `${cfg.dialect} ${out.serverVersion} · ${cfg.database}: ${s.tables.length} tablas, ${s.views.length} vistas, ${s.relations.length} relaciones, ${s.triggers.length} triggers (${Math.round(elapsed(t0))} ms).`,
        { serverVersion: out.serverVersion, warnings: out.warnings, rowEstimates: out.rowEstimates, schema: compactSchema(s) },
      )
    }),
  )

  server.registerTool(
    'db_benchmark',
    {
      title: 'Medir consultas',
      description:
        'Mide consultas en una BD real (transacción de solo lectura con ROLLBACK) y guarda los resultados en el proyecto, asociados a la cabeza de la rama, para que Informes y compare_flows los usen. Sin `queries` usa consultas de ejemplo deducidas del esquema.',
      inputSchema: {
        agent: agentParam,
        branch: branchParam,
        connection: connectionParam,
        queries: z
          .array(z.object({ label: z.string().trim().min(1).max(200), query: z.string().trim().min(1).max(LIMITS.maxQueryChars) }))
          .max(LIMITS.maxBenchmarkQueries)
          .optional(),
        runs: z.number().int().min(1).max(LIMITS.maxBenchmarkRuns).optional().describe('Ejecuciones por consulta (por defecto 5)'),
        explain: z.boolean().optional().describe('Incluir el plan (EXPLAIN ANALYZE)'),
      },
      annotations: { openWorldHint: true },
    },
    wrap(
      'db_benchmark',
      async ({
        agent,
        branch,
        connection,
        queries,
        runs,
        explain,
      }: {
        agent: string
        branch: string
        connection: z.infer<typeof connectionSchema>
        queries?: { label: string; query: string }[]
        runs?: number
        explain?: boolean
      }) => {
        const { room, doc } = requireDoc(service)
        const a = requireAgent(room, agent)
        const b = resolveBranch(doc, branch)
        const versionId = branchHeadId(b)
        const version = versionById(doc, versionId)
        if (!version) throw new ToolError(`La rama «${b.name}» no tiene versiones: confirma una con commit_version antes de medir.`)
        const cfg = connectionSchema.parse(connection)
        const list = queries?.length
          ? queries
          : suggestQueries(sampleQueriesSchema.shape.schema.parse(normalizeSchema(version.schema)), cfg.dialect, 8).map(({ label, query }) => ({ label, query }))
        if (!list.length) throw new ToolError('No hay consultas que medir (el esquema no tiene tablas): pásalas en `queries`.')
        a.setPresence({ branchId: b.id, editing: { kind: 'benchmark', id: version.id, label: `midiendo ${list.length} consultas` } })
        const res = await withClient(cfg, (client) => runBenchmark(client, { queries: list, runs: runs ?? 5, explain: explain ?? false, versionId: version.id }))
        if (room.isEnded) throw new ToolError('La sesión terminó durante la medición; no se guardaron los resultados.')
        const stored: StoredBenchmark[] = res.results.map((r) => {
          const detail = res.details.find((d) => d.label === r.label && d.query === r.query)
          return {
            ...r,
            id: uid('bm_'),
            branchId: b.id,
            agent: a.name,
            ...(detail ? { detail: { minMs: detail.minMs, maxMs: detail.maxMs, medianMs: detail.medianMs, rows: detail.rows, ...(detail.plan ? { plan: detail.plan } : {}) } } : {}),
          }
        })
        doc.transact(() => {
          const map = benchmarksMap(doc)
          for (const bm of stored) map.set(bm.id, JSON.stringify(bm))
        }, agentOrigin(a.name))
        const errors = res.details.filter((d) => d.error).map((d) => `${d.label}: ${d.error}`)
        const avg = stored.length ? stored.reduce((n, x) => n + x.avgMs, 0) / stored.length : 0
        room.activity(a.participant, 'midió consultas', `${stored.length} consultas en ${b.name} (media ${avg.toFixed(2)} ms)`, b.id)
        return ok(
          `${stored.length} consultas medidas contra ${cfg.database} para la versión ${version.id} de «${b.name}»${errors.length ? ` (${errors.length} con error)` : ''}${res.truncated ? '; se cortó por tiempo' : ''}.`,
          {
            versionId: version.id,
            results: stored.map((x) => ({ label: x.label, avgMs: x.avgMs, p95Ms: x.p95Ms, runs: x.runs, rows: x.detail?.rows ?? null, ...(x.detail?.plan ? { plan: x.detail.plan } : {}) })),
            errors,
            totalMs: res.totalMs,
          },
        )
      },
    ),
  )

  /* ── Presencia ── */

  server.registerTool(
    'set_status',
    {
      title: 'Publicar estado',
      description: 'Publica qué está haciendo el agente (p. ej. «Revisando triggers de pedidos»). Se ve en la app junto a su avatar y en lo que esté editando.',
      inputSchema: {
        agent: agentParam,
        text: z.string().trim().max(200).describe('Texto de estado (vacío lo borra)'),
        editing: z.object({ kind: z.string().min(1).max(40), id: z.string().max(200), label: z.string().max(200) }).nullable().optional().describe('Elemento que está editando'),
        branch: branchParam.optional().describe('Rama en la que trabaja'),
      },
    },
    wrap(
      'set_status',
      ({ agent, text, editing, branch }: { agent: string; text: string; editing?: { kind: string; id: string; label: string } | null; branch?: string }) => {
        const room = requireRoom(service)
        const a = requireAgent(room, agent)
        let branchId: string | undefined
        let resolvedEditing = editing
        if (!isDocEmpty(room.doc)) {
          if (branch) branchId = resolveBranch(room.doc, branch).id
          // Si `editing` nombra una tabla por nombre, se traduce a su id para que la app la marque en el lienzo.
          if (editing && editing.kind === 'table' && branchId) {
            const t = branchDraft(room.doc, branchId).schema.tables.find((x) => x.id === editing.id || x.name === editing.id || x.name === editing.label)
            if (t) resolvedEditing = { kind: 'table', id: t.id, label: editing.label || t.name }
          }
        }
        a.setPresence(
          { status: text, ...(branchId ? { branchId } : {}), editing: resolvedEditing ?? (text ? { kind: 'status', id: a.participant.id, label: text } : null) },
          true,
        )
        if (text) room.activity(a.participant, 'está', text, branchId)
        return ok(text ? `Estado publicado: ${text}` : 'Estado borrado.')
      },
    ),
  )
}

function emptyFor(doc: Y.Doc): Schema {
  return { dialect: readMeta(doc).dialect, tables: [], views: [], relations: [], enums: [], functions: [], triggers: [], notes: [] }
}
