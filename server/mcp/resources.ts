// Recursos y prompts MCP de DB Tracker.
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { isDocEmpty } from '../../src/collab/doc.ts'
import { generateSQL } from '../../src/lib/exporters/sql.ts'
import { branchDraft, normalizeSchema, projectOf, readBranches, readMeta, resolveBranch } from './project.ts'
import type { McpService } from './service.ts'

const NO_SESSION = 'No hay sesión colaborativa con proyecto. Usa la herramienta session_open.'

export function registerResources(server: McpServer, service: McpService) {
  const doc = () => {
    const room = service.collab.room
    return room && !room.isEnded && !isDocEmpty(room.doc) ? room.doc : null
  }

  server.registerResource(
    'proyecto',
    'dbtracker://project',
    { title: 'Proyecto de DB Tracker', description: 'Resumen del proyecto compartido: ramas, cabezas y últimas versiones (JSON).', mimeType: 'application/json' },
    (uri) => {
      const d = doc()
      if (!d) return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: NO_SESSION }] }
      const project = projectOf(d)
      const meta = readMeta(d)
      const summary = {
        name: meta.name,
        dialect: meta.dialect,
        branches: project.branches.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          headVersionId: b.headVersionId,
          forkedFromVersionId: b.forkedFromVersionId,
          versions: project.versions.filter((v) => v.branchId === b.id).length,
        })),
        recentVersions: project.versions
          .slice(-10)
          .reverse()
          .map((v) => ({ id: v.id, branchId: v.branchId, message: v.message, author: v.author, createdAt: v.createdAt })),
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }] }
    },
  )

  server.registerResource(
    'ddl-de-rama',
    new ResourceTemplate('dbtracker://branch/{rama}/schema.sql', {
      list: () => {
        const d = doc()
        if (!d) return { resources: [] }
        return {
          resources: readBranches(d).map((b) => ({
            uri: `dbtracker://branch/${encodeURIComponent(b.name)}/schema.sql`,
            name: `${b.name}/schema.sql`,
            description: `DDL del borrador de ${b.name}`,
            mimeType: 'application/sql',
          })),
        }
      },
      complete: {
        rama: (value) => {
          const d = doc()
          return d ? readBranches(d).map((b) => b.name).filter((n) => n.toLowerCase().startsWith(value.toLowerCase())) : []
        },
      },
    }),
    { title: 'DDL de una rama', description: 'SQL (DDL) del borrador compartido de una rama.', mimeType: 'application/sql' },
    (uri, { rama }) => {
      const d = doc()
      if (!d) return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: NO_SESSION }] }
      const ref = decodeURIComponent(Array.isArray(rama) ? rama.join('/') : String(rama))
      const branch = resolveBranch(d, ref)
      const schema = normalizeSchema(branchDraft(d, branch.id).schema)
      return { contents: [{ uri: uri.href, mimeType: 'application/sql', text: generateSQL(schema, schema.dialect) }] }
    },
  )
}

const text = (t: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: t } }] })

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'normalizar_flujo',
    {
      title: 'Normalizar un flujo',
      description: 'Lleva una rama hasta 3FN/BCNF en un flujo nuevo, aplicando las correcciones y confirmando versiones.',
      argsSchema: { rama: z.string().describe('Rama de partida (p. ej. main)') },
    },
    ({ rama }) =>
      text(
        `Normaliza el esquema de la rama «${rama}» de DB Tracker. Usa las herramientas mcp de dbtracker con agent="Normalizador":\n` +
          `1. session_status; si no hay sesión con proyecto, session_open.\n` +
          `2. set_status con lo que vas a hacer y analyze_normalization sobre «${rama}».\n` +
          `3. create_branch con un nombre tipo «flujo/${rama}-3fn», una descripción del objetivo y from="${rama}".\n` +
          `4. Aplica las correcciones de severidad alta y media con apply_normalization_fix (de una en una; vuelve a analizar tras cada una porque los ids cambian). Para lo que no tenga corrección automática usa edit_schema.\n` +
          `5. Confirma con commit_version un mensaje claro por forma normal alcanzada (1FN, 2FN, 3FN…).\n` +
          `6. Revisa diff (from="${rama}", to=<tu rama>) y generate_migration: comprueba que los pasos de copia de datos están incluidos.\n` +
          `7. Resume qué cambió, qué forma normal se alcanza y qué hallazgos quedan.`,
      ),
  )

  server.registerPrompt(
    'revisar_triggers',
    {
      title: 'Revisar triggers',
      description: 'Revisa funciones y triggers de una rama (ciclos, condiciones, auditoría, updated_at) y propone o aplica mejoras.',
      argsSchema: { rama: z.string().describe('Rama a revisar') },
    },
    ({ rama }) =>
      text(
        `Revisa los triggers y funciones de la rama «${rama}» de DB Tracker con agent="Triggers":\n` +
          `1. session_status / session_open si hace falta; set_status("Revisando triggers de ${rama}", branch="${rama}").\n` +
          `2. get_schema(branch="${rama}") y get_sql para leer funciones y triggers.\n` +
          `3. Busca: cascadas o ciclos entre triggers, triggers sin condición WHEN que se disparan de más, funciones que escriben en tablas sin índice, vistas materializadas sin refresco, falta de updated_at/auditoría donde se necesita, y diferencias de dialecto.\n` +
          `4. Si conviene cambiar algo, crea un flujo (create_branch) y aplica los cambios con edit_schema (upsert_function, upsert_trigger, remove_trigger) en un único lote por idea; confirma con commit_version.\n` +
          `5. Entrega una lista de hallazgos con su gravedad y lo que cambiaste (diff y generate_migration).`,
      ),
  )

  server.registerPrompt(
    'comparar_flujos',
    {
      title: 'Comparar flujos',
      description: 'Compara los flujos del proyecto (saltos, agilidad y latencia) y recomienda uno.',
    },
    () =>
      text(
        `Compara los flujos (ramas) del proyecto de DB Tracker con agent="Revisor":\n` +
          `1. session_status / session_open si hace falta; get_project para ver ramas, cabezas y versiones.\n` +
          `2. compare_flows para las métricas por flujo. Si tienes una conexión de pruebas, mide cada rama con db_benchmark (solo lectura) para usar latencias reales.\n` +
          `3. Para los dos mejores candidatos, revisa diff entre sus cabezas y analyze_normalization de cada uno.\n` +
          `4. Recomienda un flujo justificando el equilibrio entre latencia, número de saltos (riesgo de migración) y calidad del diseño. Indica qué faltaría para fusionarlo.`,
      ),
  )
}
