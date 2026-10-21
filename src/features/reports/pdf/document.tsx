// Documento PDF del informe de flujos (@react-pdf/renderer). Se carga con import dinámico.
// Fuentes estándar (Helvetica / Courier): sin descargas remotas. Estilo plano: títulos, reglas finas y tablas.
import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import type { FlowRow } from '../lib'
import { GLOSSARY, type FlowSection, type QueryItem, type ReportData, type VersionSection } from './data'

/* ----------------------------- Texto seguro ----------------------------- */

// Las fuentes estándar usan WinAnsi: se sustituyen los caracteres fuera de ese juego.
const REPLACE: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '−': '-',
  '∅': '(vacío)',
  '⋈': 'JOIN',
  '≥': '>=',
  '≤': '<=',
  '★': '*',
  '✓': 'ok',
  '●': '•',
  '○': 'o',
  ' ': ' ',
}
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const pdfText = (s: string | number | null | undefined): string =>
  String(s ?? '')
    .replace(/[→←−∅⋈≥≤★✓●○ ]/g, (c) => REPLACE[c] ?? c)
    .replace(/[^\n\t\x20-\x7e\xa0-\xff]/g, (c) => (WINANSI_EXTRA.has(c) ? c : '?'))

/** SQL/código: conserva la sangría inicial (react-pdf recorta los espacios de inicio de línea). */
const codeText = (sql: string) => pdfText(sql).replace(/^ +/gm, (m) => '\u00a0'.repeat(m.length))

// Sin guionado automático (rompía nombres como flujo/triggers-auditoria).
Font.registerHyphenationCallback((word) => [word])

/* -------------------------------- Estilos -------------------------------- */

const INK = '#111111'
const MUTED = '#5b5b5b'
const RULE = '#d4d4d4'
const ADD = '#166534'
const DEL = '#b91c1c'
const CHG = '#92400e'

const s = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 48, paddingHorizontal: 44, fontFamily: 'Helvetica', fontSize: 9, color: INK, lineHeight: 1.35 },
  header: { position: 'absolute', top: 20, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: MUTED, borderBottomWidth: 0.5, borderBottomColor: RULE, paddingBottom: 4 },
  footer: { position: 'absolute', top: 806, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: MUTED, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 4 },
  h1: { fontSize: 24, fontFamily: 'Helvetica', fontWeight: 'bold', lineHeight: 1.15, marginBottom: 10 },
  h2: { fontSize: 14, fontFamily: 'Helvetica', fontWeight: 'bold', marginTop: 4, marginBottom: 6, paddingBottom: 3, borderBottomWidth: 0.75, borderBottomColor: INK },
  h3: { fontSize: 10.5, fontFamily: 'Helvetica', fontWeight: 'bold', marginTop: 10, marginBottom: 4 },
  h4: { fontSize: 9, fontFamily: 'Helvetica', fontWeight: 'bold', marginTop: 6, marginBottom: 2 },
  muted: { color: MUTED },
  small: { fontSize: 7.5 },
  p: { marginBottom: 4 },
  rule: { borderBottomWidth: 0.5, borderBottomColor: RULE, marginVertical: 6 },
  kv: { flexDirection: 'row', marginBottom: 2 },
  kvKey: { width: 120, color: MUTED },
  kvVal: { flex: 1 },
  table: { borderTopWidth: 0.75, borderTopColor: INK, marginBottom: 6 },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 2.5 },
  th: { fontFamily: 'Helvetica', fontWeight: 'bold', fontSize: 7.5 },
  td: { fontSize: 8, paddingRight: 4 },
  mono: { fontFamily: 'Courier', fontSize: 7.5 },
  code: { fontFamily: 'Courier', fontSize: 7, lineHeight: 1.3, borderLeftWidth: 1, borderLeftColor: RULE, paddingLeft: 6, marginVertical: 3 },
  action: { fontFamily: 'Courier', fontSize: 7.5, marginBottom: 1 },
})

/* ------------------------------- Piezas ------------------------------- */

function Chrome({ project }: { project: string }) {
  return (
    <>
      <View style={s.header} fixed>
        <Text>{pdfText(`DB Tracker · Informe de flujos`)}</Text>
        <Text>{pdfText(project)}</Text>
      </View>
      <View style={s.footer} fixed>
        <Text>{pdfText(project)}</Text>
        <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
      </View>
    </>
  )
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv} wrap={false}>
      <Text style={s.kvKey}>{pdfText(k)}</Text>
      <Text style={s.kvVal}>{pdfText(v)}</Text>
    </View>
  )
}

interface Col<T> {
  title: string
  width: number | string
  align?: 'left' | 'right'
  mono?: boolean
  value: (row: T) => string
  color?: (row: T) => string | undefined
}

function DataTable<T>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  return (
    <View style={s.table}>
      <View style={s.tr} wrap={false}>
        {cols.map((c) => (
          <Text key={c.title} style={[s.th, s.td, { width: c.width, textAlign: c.align ?? 'left' }]}>
            {pdfText(c.title)}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {cols.map((c) => (
            <Text key={c.title} style={[s.td, c.mono ? s.mono : {}, { width: c.width, textAlign: c.align ?? 'left', color: c.color?.(r) ?? INK }]}>
              {pdfText(c.value(r))}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

const ms = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('es', { maximumFractionDigits: 2 })} ms`)
const num = (n: number, d = 1) => n.toLocaleString('es', { maximumFractionDigits: d })

const actionColor = (a: string) => (a.startsWith('+') ? ADD : a.startsWith('-') ? DEL : CHG)

function SummaryTable({ rows }: { rows: FlowRow[] }) {
  return (
    <DataTable<FlowRow>
      rows={rows}
      cols={[
        { title: 'Flujo', width: '22%', mono: true, value: (r) => r.branchName },
        { title: 'Vers.', width: '7%', align: 'right', value: (r) => String(r.versions) },
        { title: 'h entre v.', width: '10%', align: 'right', value: (r) => (r.versions ? num(r.avgHoursBetweenVersions) : '—') },
        { title: 'Vers./día', width: '9%', align: 'right', value: (r) => (r.versions ? num(r.versionsPerDay, 2) : '—') },
        { title: 'Saltos', width: '8%', align: 'right', value: (r) => String(r.totalJumps) },
        { title: 'Mayor', width: '8%', align: 'right', value: (r) => String(r.maxJump) },
        { title: 'Lat. media', width: '11%', align: 'right', value: (r) => ms(r.avgQueryMs) },
        { title: 'p95', width: '11%', align: 'right', value: (r) => ms(r.p95QueryMs) },
        { title: 'Fuente', width: '7%', value: (r) => (r.latencySource === 'remote' ? 'medida' : r.latencySource === 'estimate' ? 'estimada' : '—') },
        { title: 'Punt.', width: '7%', align: 'right', value: (r) => (r.score !== null ? num(r.score, 2) : r.scoreNote ? 'sin medir' : '—') },
      ]}
    />
  )
}

function SchemaBlock({ flow }: { flow: FlowSection }) {
  const schema = flow.schema
  if (!schema) return null
  return (
    <View>
      <Text style={s.h3}>{pdfText(`Esquema final · ${flow.schemaLabel}`)}</Text>
      {schema.tables.map((t) => (
        <View key={t.id} wrap={false} style={{ marginBottom: 4 }}>
          <Text style={s.h4}>{pdfText(`${t.name}${t.comment ? ` — ${t.comment}` : ''}`)}</Text>
          <DataTable
            rows={t.columns}
            cols={[
              { title: 'Columna', width: '30%', mono: true, value: (c) => c.name },
              { title: 'Tipo', width: '25%', mono: true, value: (c) => c.type },
              {
                title: 'Restricciones',
                width: '45%',
                value: (c) => [c.pk && 'PK', !c.nullable && 'NOT NULL', c.unique && 'UNIQUE', c.autoIncrement && 'AUTOINC', c.default && `DEFAULT ${c.default}`].filter(Boolean).join(' · '),
              },
            ]}
          />
          {t.indexes.length > 0 && (
            <Text style={[s.small, s.muted]}>
              {pdfText(
                `Índices: ${t.indexes.map((i) => `${i.name} (${i.columnIds.map((id) => t.columns.find((c) => c.id === id)?.name ?? '?').join(', ')})${i.unique ? ' único' : ''}`).join('; ')}`,
              )}
            </Text>
          )}
        </View>
      ))}
      {(schema.views ?? []).length > 0 && <Text style={s.h4}>Vistas</Text>}
      {(schema.views ?? []).map((v) => (
        <View key={v.id} style={{ marginBottom: 4 }}>
          <Text wrap={false}>{pdfText(`${v.name}${v.materialized ? ' (materializada)' : ''} — columnas: ${v.columns.map((c) => c.name).join(', ')}`)}</Text>
          <Text style={s.code}>{codeText(v.definition)}</Text>
        </View>
      ))}
      {schema.triggers.length > 0 && (
        <>
          <Text style={s.h4}>Triggers</Text>
          <DataTable
            rows={schema.triggers}
            cols={[
              { title: 'Trigger', width: '30%', mono: true, value: (t) => t.name },
              { title: 'Momento / eventos', width: '25%', value: (t) => `${t.timing} ${t.events.join('/')} · ${t.level}` },
              { title: 'Tabla', width: '18%', mono: true, value: (t) => schema.tables.find((x) => x.id === t.tableId)?.name ?? '?' },
              { title: 'Función / condición', width: '27%', value: (t) => `${schema.functions.find((f) => f.id === t.functionId)?.name ?? '?'}()${t.condition ? ` WHEN ${t.condition}` : ''}` },
            ]}
          />
        </>
      )}
      {schema.functions.length > 0 && <Text style={s.h4}>Funciones</Text>}
      {schema.functions.map((f) => (
        <View key={f.id} style={{ marginBottom: 4 }}>
          <Text wrap={false}>{pdfText(`${f.name}(${f.args}) RETURNS ${f.returns} · ${f.language}${f.comment ? ` — ${f.comment}` : ''}`)}</Text>
          <Text style={s.code}>{codeText(f.body)}</Text>
        </View>
      ))}
    </View>
  )
}

function VersionBlock({ v, showSql }: { v: VersionSection; showSql: boolean }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <View wrap={false}>
        <Text style={s.h4}>{pdfText(v.message)}</Text>
        <Text style={[s.small, s.muted]}>
          {pdfText(`${v.date} · ${v.author} · ${v.jumps} ${v.jumps === 1 ? 'salto' : 'saltos'}${v.parentLabel ? ` · desde «${v.parentLabel}»` : ' · primera versión'}${v.sha ? ` · SHA ${v.sha.slice(0, 10)}` : ''}`)}
        </Text>
      </View>
      <View style={{ marginTop: 3 }}>
        {v.actions.length === 0 && <Text style={[s.small, s.muted]}>Sin cambios estructurales.</Text>}
        {v.actions.map((a, i) => (
          <Text key={i} style={[s.action, { color: actionColor(a) }]}>
            {pdfText(a)}
          </Text>
        ))}
      </View>
      {v.dataSteps.length > 0 && (
        <View>
          <Text style={[s.small, s.muted, { marginTop: 3 }]}>Pasos de datos</Text>
          {v.dataSteps.map((d, i) => (
            <View key={i}>
              <Text style={[s.action, { color: ADD }]}>{pdfText(`+ ${d.description}`)}</Text>
              <Text style={s.code}>{codeText(d.sql)}</Text>
            </View>
          ))}
        </View>
      )}
      {showSql && v.migrationSql !== null && (
        <View>
          <Text style={[s.small, s.muted, { marginTop: 3 }]}>SQL de migración desde la versión padre</Text>
          <Text style={s.code}>{codeText(v.migrationSql.trim() || '-- sin sentencias')}</Text>
        </View>
      )}
    </View>
  )
}

function QueryBlock({ q }: { q: QueryItem }) {
  const stats = [
    `runs ${q.runs}`,
    `media ${ms(q.avgMs)}`,
    `p95 ${ms(q.p95Ms)}`,
    q.minMs !== undefined && `mín ${ms(q.minMs)}`,
    q.maxMs !== undefined && `máx ${ms(q.maxMs)}`,
    q.medianMs !== undefined && `mediana ${ms(q.medianMs)}`,
    q.rows !== undefined && q.rows !== null && `filas ${q.rows}`,
  ].filter(Boolean)
  return (
    <View style={{ marginBottom: 6 }}>
      <View wrap={false}>
        <Text style={s.h4}>{pdfText(q.label)}</Text>
        <Text style={[s.small, s.muted]}>
          {pdfText(`${q.source === 'remote' ? `Medición remota${q.measuredAt ? ` (${q.measuredAt})` : ''}` : 'Estimación heurística'} · ${q.versionLabel}`)}
        </Text>
        <Text style={s.small}>{pdfText(stats.join(' · '))}</Text>
      </View>
      <Text style={s.code}>{codeText(q.sql)}</Text>
      {q.plan && (
        <>
          <Text style={[s.small, s.muted]}>Plan (EXPLAIN, resumido)</Text>
          <Text style={s.code}>{codeText(q.plan.split('\n').slice(0, 14).join('\n'))}</Text>
        </>
      )}
      {q.notes.map((n, i) => (
        <Text key={i} style={[s.small, s.muted]}>
          {pdfText(`· ${n}`)}
        </Text>
      ))}
    </View>
  )
}

function FlowPage({ flow, data }: { flow: FlowSection; data: ReportData }) {
  const m = flow.metrics
  return (
    <Page size="A4" style={s.page}>
      <Chrome project={data.projectName} />
      <Text style={s.h2}>{pdfText(`Flujo ${flow.name}`)}</Text>
      {flow.description && <Text style={s.p}>{pdfText(flow.description)}</Text>}
      <KV k="Origen" v={flow.origin} />
      <KV k="Duración" v={flow.duration} />
      {m && (
        <KV
          k="Métricas"
          v={`${m.versions} versiones · ${num(m.avgHoursBetweenVersions)} h entre versiones · ${num(m.versionsPerDay, 2)} versiones/día · ${m.totalJumps} saltos (mayor ${m.maxJump}) · latencia ${ms(m.avgQueryMs)} / p95 ${ms(m.p95QueryMs)}`}
        />
      )}

      {data.sections.schemas && <SchemaBlock flow={flow} />}

      <Text style={s.h3}>Versiones y acciones</Text>
      {flow.versions.length === 0 && <Text style={s.muted}>No hay versiones de esta rama en el periodo.</Text>}
      {flow.versions.map((v) => (
        <VersionBlock key={v.id} v={v} showSql={data.sections.migrations} />
      ))}

      {data.sections.queries && (
        <>
          <Text style={s.h3}>{flow.queriesEstimated ? 'Consultas (estimación: sin mediciones remotas)' : 'Consultas medidas'}</Text>
          {flow.queries.length === 0 && <Text style={s.muted}>Sin consultas.</Text>}
          {flow.queries.map((q, i) => (
            <QueryBlock key={i} q={q} />
          ))}
        </>
      )}
    </Page>
  )
}

/* ------------------------------ Documento ------------------------------ */

export function FlowReportDocument({ data }: { data: ReportData }) {
  return (
    <Document title={pdfText(`Informe de flujos · ${data.projectName}`)} author="DB Tracker" creator="DB Tracker" producer="DB Tracker">
      {/* Portada */}
      <Page size="A4" style={s.page}>
        <Chrome project={data.projectName} />
        <View style={{ marginTop: 120 }}>
          <Text style={[s.muted, { fontSize: 10, marginBottom: 6 }]}>DB Tracker</Text>
          <Text style={s.h1}>Informe de flujos</Text>
          <Text style={{ fontSize: 14, marginBottom: 24 }}>{pdfText(data.projectName)}</Text>
          <View style={s.rule} />
          <KV k="Proyecto" v={data.projectName} />
          <KV k="Dialecto" v={data.dialect} />
          <KV k="Generado" v={data.generatedAt} />
          <KV k="Periodo" v={data.period} />
          <KV k="Flujos incluidos" v={String(data.flowsCount)} />
          <KV k="Versiones en el periodo" v={String(data.versionsCount)} />
          {data.github && <KV k="Repositorio GitHub" v={data.github} />}
          <View style={s.rule} />
          <Text style={[s.small, s.muted]}>
            {pdfText(
              `Secciones: resumen ejecutivo, un capítulo por flujo${data.sections.schemas ? ' (con esquema final)' : ''}${data.sections.migrations ? ', SQL de migración' : ''}${data.sections.queries ? ', consultas' : ''}${data.sections.session ? ', registro de acciones de la sesión' : ''} y glosario.`,
            )}
          </Text>
        </View>
      </Page>

      {/* Resumen ejecutivo */}
      <Page size="A4" style={s.page}>
        <Chrome project={data.projectName} />
        <Text style={s.h2}>Resumen ejecutivo</Text>
        <Text style={[s.small, s.muted, s.p]}>{pdfText(data.latencySourceNote)}</Text>
        <SummaryTable rows={data.rows} />
        <Text style={s.h3}>Recomendación</Text>
        <Text style={s.p}>{pdfText(data.recommendation ?? 'No hay ramas con versiones y latencia en el periodo elegido.')}</Text>
        {data.excludedNotes.map((n, i) => (
          <Text key={i} style={[s.small, { color: CHG }]}>
            {pdfText(`! ${n}`)}
          </Text>
        ))}
      </Page>

      {data.flows.map((f) => (
        <FlowPage key={f.id} flow={f} data={data} />
      ))}

      {data.sections.session && (
        <Page size="A4" style={s.page}>
          <Chrome project={data.projectName} />
          <Text style={s.h2}>Registro de acciones de la sesión</Text>
          {data.operations.length === 0 && <Text style={s.muted}>No hay operaciones registradas en esta sesión.</Text>}
          {data.operations.map((op, i) => (
            <View key={i} style={{ marginBottom: 8 }}>
              <View wrap={false}>
                <Text style={s.h4}>{pdfText(op.title)}</Text>
                <Text style={[s.small, s.muted]}>
                  {pdfText(
                    `${op.status === 'done' ? 'completada' : op.status === 'error' ? `con error: ${op.error ?? ''}` : 'en curso'} · ${new Date(op.startedAt).toLocaleString('es')} · ${op.finishedAt ? `${op.finishedAt - op.startedAt} ms` : '—'}`,
                  )}
                </Text>
              </View>
              <DataTable
                rows={op.steps}
                cols={[
                  { title: 'Paso', width: '24%', value: (st) => st.label },
                  { title: 'Detalle', width: '52%', value: (st) => st.detail ?? '' },
                  { title: 'ms', width: '10%', align: 'right', value: (st) => (st.ms === undefined ? '—' : String(st.ms)) },
                  { title: 'Estado', width: '14%', value: (st) => ({ done: 'hecho', error: 'error', running: 'en curso', pending: 'pendiente', skipped: 'omitido' })[st.status] ?? st.status },
                ]}
              />
            </View>
          ))}
        </Page>
      )}

      {/* Anexo */}
      <Page size="A4" style={s.page}>
        <Chrome project={data.projectName} />
        <Text style={s.h2}>Anexo · Glosario de métricas</Text>
        {GLOSSARY.map((g) => (
          <View key={g.term} wrap={false} style={{ marginBottom: 6 }}>
            <Text style={s.h4}>{pdfText(g.term)}</Text>
            <Text>{pdfText(g.text)}</Text>
          </View>
        ))}
      </Page>
    </Document>
  )
}
