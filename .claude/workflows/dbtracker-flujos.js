export const meta = {
  name: 'dbtracker-flujos',
  description: 'Varios agentes trabajan en paralelo en flujos de DB Tracker (normalización, rendimiento, triggers) por MCP, en vivo en la app, con revisión crítica y recomendación final',
  whenToUse: 'Cuando quieras que agentes exploren varias mejoras del esquema a la vez, cada una en su rama de DB Tracker, y comparar resultados',
  phases: [
    { title: 'Preparar', detail: 'sesión MCP, proyecto y plan de flujos' },
    { title: 'Flujos', detail: 'un especialista por flujo, en su propia rama' },
    { title: 'Revisar', detail: 'revisión crítica de cada flujo y una corrección si hace falta' },
    { title: 'Comparar', detail: 'métricas de los flujos y recomendación' },
  ],
}

// args admite un texto ("normalizar y auditar pedidos") o un objeto:
//   { objetivo, rama?: 'main', especialistas?: ['normalizacion','rendimiento','triggers'], conexion?: {...}, documentar?: true }
const opts = typeof args === 'string' ? { objetivo: args } : args || {}
const objetivo = opts.objetivo || 'mejorar el diseño del esquema actual'
const ramaBase = opts.rama || null
const conexion = opts.conexion || null

const ESPECIALISTAS = {
  normalizacion: { agentType: 'dbt-normalizador', nombre: 'Normalizador', foco: 'normalización (1FN a BCNF) sin pérdida de datos' },
  rendimiento: { agentType: 'dbt-rendimiento', nombre: 'Rendimiento', foco: 'índices, tipos y vistas para mejorar el tiempo de respuesta' },
  triggers: { agentType: 'dbt-triggers', nombre: 'Triggers', foco: 'auditoría, updated_at, integridad y refresco de vistas con triggers' },
}

const MCP_NOTA =
  'Usa las herramientas MCP del servidor "dbtracker" (mcp__dbtracker__*; cárgalas con ToolSearch si hace falta). ' +
  'Tus cambios se ven en vivo en la app de DB Tracker de las personas conectadas.'

const PLAN = {
  type: 'object',
  required: ['ramaBase', 'resumen', 'flujos'],
  properties: {
    ramaBase: { type: 'string', description: 'Rama desde la que nacen los flujos' },
    resumen: { type: 'string', description: 'Estado actual del esquema en 3-5 líneas' },
    flujos: {
      type: 'array',
      items: {
        type: 'object',
        required: ['especialista', 'rama', 'objetivo'],
        properties: {
          especialista: { type: 'string', enum: ['normalizacion', 'rendimiento', 'triggers'] },
          rama: { type: 'string', description: 'Nombre del flujo a crear, p. ej. flujo/normalizacion-pedidos' },
          objetivo: { type: 'string' },
        },
      },
    },
  },
}

const RESULTADO = {
  type: 'object',
  required: ['rama', 'versiones', 'resumen', 'riesgos'],
  properties: {
    rama: { type: 'string' },
    versiones: { type: 'array', items: { type: 'string' }, description: 'Mensajes de las versiones confirmadas' },
    resumen: { type: 'string' },
    riesgos: { type: 'array', items: { type: 'string' } },
  },
}

const VEREDICTO = {
  type: 'object',
  required: ['aprobado', 'problemas'],
  properties: {
    aprobado: { type: 'boolean' },
    problemas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severidad', 'descripcion'],
        properties: {
          severidad: { type: 'string', enum: ['alta', 'media', 'baja'] },
          descripcion: { type: 'string' },
          evidencia: { type: 'string' },
        },
      },
    },
  },
}

const COMPARACION = {
  type: 'object',
  required: ['recomendacion', 'tabla'],
  properties: {
    recomendacion: { type: 'string', description: 'Qué flujo integrar y por qué (2-4 líneas)' },
    tabla: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rama', 'saltos', 'latencia', 'veredicto'],
        properties: {
          rama: { type: 'string' },
          saltos: { type: 'number' },
          latencia: { type: 'string', description: 'p95 con su fuente (medido/estimado) o "sin datos"' },
          veredicto: { type: 'string' },
        },
      },
    },
  },
}

/* ───────── Preparar ───────── */
phase('Preparar')
const pedidos = (opts.especialistas || Object.keys(ESPECIALISTAS)).filter((e) => ESPECIALISTAS[e])
const plan = await agent(
  `${MCP_NOTA}\n\nObjetivo del usuario: "${objetivo}".\n` +
    '1. Llama a session_status. Si no hay sesión, llama a session_open; si falla porque la app no está abierta, devuélvelo en "resumen" y deja "flujos" vacío.\n' +
    `2. get_project y get_schema de la rama ${ramaBase ? `"${ramaBase}"` : 'principal (main o la que más versiones tenga)'}.\n` +
    `3. Propón como máximo un flujo por especialista entre: ${pedidos.join(', ')}. Incluye solo los que tengan trabajo real según el esquema y el objetivo.\n` +
    'Ramas con nombre "flujo/<especialista>-<tema corto>", sin repetir ramas existentes. No crees nada todavía.',
  { label: 'Plan de flujos', phase: 'Preparar', schema: PLAN, agentType: 'dbt-revisor' },
)

if (!plan || !plan.flujos.length) {
  log(plan ? `Sin flujos que lanzar: ${plan.resumen}` : 'No se pudo preparar el plan.')
  return { plan, flujos: [], recomendacion: null }
}
log(`Base: ${plan.ramaBase} · ${plan.flujos.length} flujo(s): ${plan.flujos.map((f) => f.rama).join(', ')}`)

/* ───────── Flujos → Revisar (pipeline: cada flujo se revisa en cuanto termina) ───────── */
const resultados = await pipeline(
  plan.flujos,
  (flujo) => {
    const esp = ESPECIALISTAS[flujo.especialista]
    return agent(
      `${MCP_NOTA}\n\nObjetivo general: "${objetivo}". Tu parte: ${esp.foco}.\n` +
        `Crea tu flujo "${flujo.rama}" desde "${plan.ramaBase}" (create_branch) con la descripción: "${flujo.objetivo}".\n` +
        `Trabaja solo en esa rama, con agent: "${esp.nombre}", y confirma versiones pequeñas.` +
        (conexion && flujo.especialista === 'rendimiento'
          ? `\nPuedes medir con db_benchmark usando esta conexión: ${JSON.stringify(conexion)}`
          : ''),
      { label: `${esp.nombre}: ${flujo.rama}`, phase: 'Flujos', schema: RESULTADO, agentType: esp.agentType },
    )
  },
  async (resultado, flujo) => {
    if (!resultado) return null
    const revisar = () =>
      agent(
        `${MCP_NOTA}\n\nRevisa de forma crítica el flujo "${resultado.rama}" (nació de "${plan.ramaBase}"). ` +
          'Haz diff y generate_migration desde su origen y analyze_normalization en su cabeza. ' +
          'Marca como alta cualquier pérdida de datos posible, ciclo de triggers o regresión de normalización. Ante la duda, márcalo.',
        { label: `Revisión: ${resultado.rama}`, phase: 'Revisar', schema: VEREDICTO, agentType: 'dbt-revisor' },
      )
    let veredicto = await revisar()
    const altos = (veredicto?.problemas || []).filter((p) => p.severidad === 'alta')
    if (veredicto && !veredicto.aprobado && altos.length) {
      const esp = ESPECIALISTAS[flujo.especialista]
      log(`${resultado.rama}: ${altos.length} problema(s) alto(s), una ronda de corrección`)
      await agent(
        `${MCP_NOTA}\n\nEl revisor encontró estos problemas en tu flujo "${resultado.rama}":\n` +
          altos.map((p) => `- ${p.descripcion}${p.evidencia ? ` (${p.evidencia})` : ''}`).join('\n') +
          `\nCorrígelos en la misma rama con agent: "${esp.nombre}" y confirma una versión "Correcciones de revisión".`,
        { label: `Corrección: ${resultado.rama}`, phase: 'Revisar', agentType: esp.agentType },
      )
      veredicto = await revisar()
    }
    return { ...resultado, especialista: flujo.especialista, veredicto }
  },
)

const flujos = resultados.filter(Boolean)
const omitidos = plan.flujos.length - flujos.length
if (omitidos) log(`${omitidos} flujo(s) no terminaron y quedan fuera de la comparación`)

/* ───────── Comparar ───────── */
phase('Comparar')
const comparacion = await agent(
  `${MCP_NOTA}\n\nCompara estos flujos con compare_flows y con los veredictos de revisión:\n` +
    flujos
      .map((f) => `- ${f.rama} (${f.especialista}): ${f.veredicto?.aprobado ? 'aprobado' : 'no aprobado'}; ${f.resumen}`)
      .join('\n') +
    '\nRecomienda qué integrar (pueden ser varios si son compatibles) y en qué orden. No compares latencias estimadas contra medidas como si fueran iguales.',
  { label: 'Comparar y recomendar', phase: 'Comparar', schema: COMPARACION, agentType: 'dbt-revisor' },
)

if (opts.documentar) {
  await agent(
    `${MCP_NOTA}\n\nDocumenta los flujos ${flujos.map((f) => f.rama).join(', ')} y la recomendación:\n${comparacion?.recomendacion ?? ''}`,
    { label: 'Documentar', phase: 'Comparar', agentType: 'dbt-documentador' },
  )
}

return { base: plan.ramaBase, flujos, recomendacion: comparacion }
