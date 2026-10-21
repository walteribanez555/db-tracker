# Agentes por MCP: Claude Code trabajando en DB Tracker

[← Volver al README](../../README.md) · Relacionado: [colaboración en red](colaboracion-en-red.md)

## Idea

DB Tracker expone un **servidor MCP** dentro de su propia API local. Claude Code (CLI, IDE o escritorio) se conecta a él y sus agentes trabajan sobre el **mismo documento compartido** de la colaboración en red. Para la app, cada agente es **un participante más**: aparece en la cabecera con su nombre, sus ediciones llegan en tiempo real, lo que edita se marca en el lienzo y sus acciones salen en **Actividad**. Varias personas y varios agentes pueden trabajar a la vez, cada uno en su flujo (rama).

```
 Claude Code ──MCP (HTTP)──►  DB Tracker local (127.0.0.1:8787/mcp)
   ├─ agente normalizador        │  herramientas MCP → transacciones Yjs (origin "agent:<nombre>")
   ├─ agente rendimiento         ▼
   └─ agente revisor         Sala Yjs de la sesión ◄──WS──► ventana(s) de la app, invitados de la red
```

## Conexión

- **Transporte:** Streamable HTTP en `POST /mcp`, montado **solo en el listener local** (`127.0.0.1`, `createApp`). Nunca está en el listener de red (allí `/mcp` y `/api/mcp/*` responden 404) y conserva las protecciones de `Host`/`Origin` (`isTrustedLocalRequest`: socket de loopback, `Host` local y `Origin` local o ausente → si no, 403).
- **Sin estado:** no hay `Mcp-Session-Id`. Cada `POST` crea un servidor MCP y responde en JSON; `GET` y `DELETE` devuelven 405. Motivos: en desarrollo `tsx watch` reinicia el proceso a menudo y un cliente con un id de sesión caducado tendría que reinicializar; la identidad del agente va en el parámetro `agent` (no en la conexión) y todo el estado vive en la sala Yjs. Tampoco hay notificaciones espontáneas que necesiten el stream SSE.
- **Autenticación:** `Authorization: Bearer <token>`. El token (`dbt_…`) se crea al arrancar si no existe, se guarda en `<dataDir>/mcp-token` (permisos 600) y se muestra en la app («Conectar agentes»). Se puede regenerar. Sin token o con uno incorrecto → 401.
- **API para la UI** (solo loopback con `Host`/`Origin` locales):
  - `GET /api/mcp/info` → `{ url, mcpUrl, tokenHint, token, connectedAgents (nº de agentes activos), agents[], repoDir?, stdio?, dataDir, session }`.
  - `GET /api/mcp/token` → `{ token, tokenHint }`.
  - `POST /api/mcp/token/rotate` → `{ token, tokenHint }`. El token anterior deja de valer al instante.
- **Puerto estable:** web usa `PORT` o `8787`; Electron (desarrollo y empaquetado) intenta `8787` y, si está ocupado, el siguiente libre. La URL efectiva se publica en `<dataDir>/server.json` (`{ url, mcpUrl, pid, dataDir, tokenFile, runtime }`) y en un puntero global `~/.dbtracker/server.json` con el mismo contenido (así el puente stdio encuentra `dataDir` sin configuración). Se borran al salir si son de ese proceso.
- **`dataDir`:** web → `DBTRACKER_DATA_DIR` o `<cwd>/.dbtracker-data`; Electron → `app.getPath('userData')` (en macOS, `~/Library/Application Support/<nombre de la app>`; en desarrollo, `db-tracker`). El puntero global evita tener que saberlo.
- **Puente stdio** (clientes sin HTTP, p. ej. Claude Desktop): `node scripts/build-node.mjs mcp` genera `dist-mcp/stdio.mjs`. Configuración: `{ "command": "node", "args": ["<repo>/dist-mcp/stdio.mjs"] }`. Lee `DBTRACKER_MCP_URL` + `DBTRACKER_MCP_TOKEN` o, si faltan, `server.json` de `DBTRACKER_DATA_DIR`, de `~/.dbtracker` o de `./.dbtracker-data` (con su `mcp-token`). Responde `initialize` él mismo, así que arranca aunque la app esté cerrada; reintenta 30 s (`DBTRACKER_MCP_WAIT_MS`) releyendo `server.json` (puerto o token nuevos), avisa con `list_changed` cuando la app aparece y guarda la lista de herramientas en `~/.dbtracker/tools-cache.json` para ofrecerla con la app cerrada.
- **Sesión:** las herramientas trabajan sobre la sesión colaborativa activa.
  - Si no hay ninguna, `session_open` crea una sesión **local** (`network: 'local'`: sin listener de red ni mDNS; `port: 0`, `qrSvg: ''`, `joinUrl` por el listener local con el secreto) y espera a que la ventana de la app se una como anfitriona y siembre el proyecto (la app lo hace sola si está abierta).
  - Sin `projectName`, la sala nace con nombre **provisional** (`SessionInfo.provisional: true`): adopta el nombre real cuando la app repite `POST /share` con su proyecto o cuando siembra `meta.name`.
  - Si la app no está abierta, la herramienta lo explica (error con la URL de la app).
  - `SessionInfo` incluye además `autoApproveAgents` (por defecto `true` en `local`; en `lan`, `false` salvo que se indique). Un `/share` repetido **sin** `network` no cambia el modo; `network: 'lan'` sobre una sesión local abre el listener de red sin cerrar la sala, y `network: 'local'` sobre una de red lo cierra.
- **Identidad:** cada herramienta que modifica acepta `agent` (nombre visible, p. ej. «Normalizador»). El servidor crea un **participante virtual** por nombre (`kind: 'agent'`, color estable por nombre, `address: 'MCP (este equipo)'`) con su propio `Awareness` sobre un `Y.Doc` auxiliar (clientID propio). Su estado se difunde como el de cualquier cliente: `user {id = id del participante, kind 'agent', role}`, `branchId` (rama en la que trabaja), `editing {kind, id, label}` con la entidad real (tabla, vista, función, trigger, rama o versión; se borra a los 30 s salvo con `set_status`) y `status` (texto de `set_status`). Un agente sin llamadas durante 15 min sale de la sala y vuelve a entrar (sin aprobación) con su siguiente llamada.
- **Ediciones:** transacciones Yjs sobre el documento de la sala con origin `agent:<nombre>` y el formato de `src/collab/doc.ts` (`writeDraft`, `writeVersions`, `writeBranches`): los clientes las reciben como cambios remotos.
- **Actividad:** cada herramienta que modifica difunde `{t:'activity', entry}` (verbos: «creó la rama», «editó el esquema», «confirmó la versión», «aplicó normalización», «midió consultas», «está», «se unió a la sesión», «fue expulsado de la sesión»).

## Herramientas

Los nombres van en inglés (`snake_case`, convención MCP); las descripciones y los mensajes, en español. Los identificadores de rama aceptan **id o nombre** (`flujo/3fn`). Las respuestas son JSON compacto con un texto resumen.

| Herramienta | Parámetros | Qué hace |
|---|---|---|
| `session_status` | — | Sesión activa, participantes (personas y agentes), actividad reciente y URL de la app |
| `session_open` | `projectName?` | Abre la sesión local para agentes si no existe y espera a la app (máx. 20 s) |
| `get_project` | — | Proyecto: dialecto, ramas (descripción, origen, cabeza, nº versiones) y últimas versiones |
| `get_schema` | `branch`, `version?`, `full?` | Esquema (borrador de la rama o una versión) por nombres: tablas, columnas, relaciones, vistas, funciones, triggers, enums. `full: true` devuelve el JSON completo con ids y posiciones |
| `get_sql` | `branch`, `version?`, `dialect?` | DDL generado |
| `create_branch` | `agent`, `name`, `description`, `from?` (rama o versión) | Crea un flujo nuevo (y su borrador compartido) desde la cabeza de otra rama o una versión; por defecto, la cabeza de `main` |
| `edit_schema` | `agent`, `branch`, `operations[]`, `note?` | Aplica un lote de operaciones al borrador compartido de la rama (ver abajo) |
| `commit_version` | `agent`, `branch`, `message` | Confirma el borrador como versión (autor = agente, `parentId` = cabeza o versión de origen, mueve `headVersionId` y el `baseVersionId` del borrador). Falla si no hay cambios |
| `diff` | `from`, `to` (rama = su cabeza, `rama@draft`, `rama@head` o versión por id o prefijo) | Diff estructural (saltos) y lista de acciones |
| `generate_migration` | `from`, `to`, `dialect?` | SQL de migración, incluidos los pasos de copia de datos |
| `analyze_normalization` | `branch`, `version?` | Hallazgos de 1FN a BCNF y buenas prácticas, con id y plan de corrección, y forma normal alcanzada |
| `apply_normalization_fix` | `agent`, `branch`, `finding_id` | Aplica la corrección (incluye el paso de copia de datos) al borrador |
| `compare_flows` | `branches?`, `latency_weight?` (0–1) | Métricas por flujo: agilidad, saltos y latencia (medida con `db_benchmark` o estimada) con recomendación |
| `db_introspect` | `connection`, `schema_name?` | Lee el esquema de una BD real (PostgreSQL/MySQL) |
| `db_benchmark` | `agent`, `branch`, `connection`, `queries?`, `runs?`, `explain?` | Mide consultas reales (transacción de solo lectura con ROLLBACK) sobre la cabeza de la rama y guarda los resultados en el documento (Y `benchmarks`: JSON de `QueryBenchmark` + `id`, `branchId`, `agent`, `detail`) para que Informes los muestre. Sin `queries`, usa consultas de ejemplo del esquema |
| `set_status` | `agent`, `text`, `editing?` `{kind,id,label}`, `branch?` | Publica qué está haciendo el agente («Revisando triggers de pedidos») en `status` y, si no se da `editing`, también como `editing.label` |

`connection` = `{ dialect, host, port, database, user, password?, ssl? }`. La contraseña nunca se guarda ni se registra.

### Operaciones de `edit_schema`

`add_table`, `update_table`, `remove_table`, `add_column`, `update_column`, `remove_column`, `move_column`, `add_index`, `remove_index`, `add_relation`, `update_relation`, `remove_relation`, `upsert_enum`, `remove_enum`, `upsert_view`, `remove_view`, `upsert_function`, `remove_function`, `upsert_trigger`, `remove_trigger`, `add_note`.

- Referencias por **nombre**: `{ "op": "add_column", "table": "pedidos", "column": { "name": "actualizado_en", "type": "timestamptz", "nullable": false, "default": "now()" } }`.
- Forma de cada operación (`?` = opcional; el esquema JSON completo está en `tools/list`):
  - `add_table { table: { name, columns?[], color?, comment?, position?, near? } }` (sin `columns`, crea `id` como PK) · `update_table { table, set: { name?, color?, comment?, position? } }` · `remove_table { table }`
  - `add_column { table, column: { name, type, pk?, nullable?, unique?, autoIncrement?, default?, comment? }, after? }` · `update_column { table, column, set }` (`default`/`comment` a `null` los quitan) · `remove_column { table, column }` · `move_column { table, column, to? | after? }`
  - `add_index { table, index: { columns[], name?, unique? } }` · `remove_index { table, index }`
  - `add_relation { relation: { source: {table, column}, target: {table, column}, name?, cardinality?, onDelete?, onUpdate?, createColumn? } }` (source = lado «uno», target = FK; `createColumn` crea la FK con el tipo de la PK) · `update_relation { relation, set }` · `remove_relation { relation }` (por nombre, id, `tabla.fk` o `origen.col->destino.col`)
  - `upsert_enum { enum: { name, values[], rename? } }` · `remove_enum { enum }` (falla si alguna columna lo usa)
  - `upsert_view { view: { name, definition, materialized?, sources?, columns?, comment?, color?, rename? } }` (orígenes y columnas se deducen del SQL) · `remove_view { view }`
  - `upsert_function { function: { name, body, language?, args?, returns?, comment?, rename? } }` · `remove_function { function }` (borra sus triggers)
  - `upsert_trigger { trigger: { name, table, function, timing, events[], level?, condition?, enabled? } }` · `remove_trigger { trigger, table? }`
  - `add_note { note: { text, color?, near? } }`
- `note?` de `edit_schema` es el resumen del lote que sale en Actividad (para notas del lienzo, `add_note`).
- Los ids nuevos y las posiciones en el lienzo los asigna el servidor (tablas nuevas cerca de sus relacionadas).
- Todo el lote es **una transacción**: o se aplica entero o nada. Devuelve un error claro por operación inválida.
- Cada lote genera una entrada de **Actividad** y el destello de «cambio en vivo» en la app.

## Recursos y prompts MCP

- **Recursos:** `dbtracker://project` (resumen) y `dbtracker://branch/{rama}/schema.sql` (DDL del borrador; el nombre de la rama va codificado con `encodeURIComponent`, p. ej. `flujo%2F3fn`).
- **Prompts:** `normalizar_flujo` (rama), `revisar_triggers` (rama) y `comparar_flujos`.

## Claude Code

- `.mcp.json` del repo registra `dbtracker` por HTTP con el token desde `${DBTRACKER_MCP_TOKEN}`.
- `.claude/agents/`: subagentes especializados que usan solo las herramientas `mcp__dbtracker__*` que necesitan:
  - `dbt-normalizador`
  - `dbt-rendimiento`
  - `dbt-triggers`
  - `dbt-revisor`
  - `dbt-documentador`
- `.claude/workflows/dbtracker-flujos.js`: workflow multiagente. Explora el proyecto, lanza un agente por flujo en paralelo (cada uno en su rama, visible en la app), mide si hay conexión, revisa de forma adversarial y compara para recomendar.

## Seguridad

- `/mcp` solo existe en loopback, con token, y se rechaza si `Origin` o `Host` no son locales.
- Los agentes nunca reciben el token de GitHub ni las contraseñas guardadas en la app. Para usar una BD real, la contraseña se pasa en la llamada y no se persiste.
- El anfitrión puede expulsar a un agente como a cualquier participante (`POST /api/collab/participants/:id`): ese nombre queda bloqueado en la sesión. Con «aprobar agentes» (`autoApproveAgents: false`), cada nombre nuevo de agente queda `pending` y sus herramientas responden «esperando aprobación en la app»; con rol `viewer`, sus herramientas de escritura fallan.

## Implementación

- `server/mcp/`: `server.ts` (fábrica `McpServer`, `/mcp` y `/api/mcp`), `tools.ts`, `operations.ts` (operaciones de `edit_schema`, validación y posiciones), `project.ts` (lectura y escritura del `Y.Doc`), `resources.ts` (recursos y prompts), `service.ts` (token, URL, info), `discovery.ts` (token y `server.json`), `stdio.ts` (puente) y `meta.ts`.
- Participantes virtuales, actividad y nombre provisional: `server/collab/room.ts` (`room.agent(nombre)`, `room.activity(...)`); sesiones `local`: `server/collab/manager.ts`.
- Reutiliza la lógica pura de la app: `src/collab/doc.ts`, `src/lib/diff.ts`, `src/lib/exporters/{sql,migration}.ts`, `src/features/normalization/lib/*`, `src/features/reports/lib.ts` y `server/lib/db/*` (las mismas funciones que `/api/db`). `BRANCH_COLORS`, `TABLE_COLORS` y `emptySchema` están copiados en `server/mcp` porque `src/store/project.ts` crea el store de zustand al importarse.
