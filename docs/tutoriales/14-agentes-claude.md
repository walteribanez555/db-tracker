# 14. Agentes de Claude Code por MCP

[← Volver al README](../../README.md) · Diseño técnico: [agentes por MCP](../arquitectura/agentes-mcp.md)

DB Tracker trae un **servidor MCP** dentro de su API local. Claude Code (CLI, IDE o escritorio) se conecta a él y sus agentes trabajan sobre el mismo proyecto que ves en la app. Cada agente aparece como un participante más:

- con su nombre e icono de robot en la cabecera;
- con un borde de su color y «está editando…» en el lienzo;
- con sus acciones en la pestaña **Actividad** del dock.

## 1. Activar los agentes en la app

1. Abre DB Tracker (escritorio o `npm run dev`) y carga tu proyecto.
2. Pulsa **Conectar agentes** (icono de robot; en móvil, en **Más**).
3. Activa **Permitir agentes de Claude Code**. Se abre una sesión **solo para este equipo** (sin red) que la app comparte con los agentes. Con **Aprobar cada agente nuevo** decides quién entra.
4. El diálogo muestra la **URL MCP**, el **token** (oculto, con Copiar y Regenerar) y las instrucciones listas para copiar.

La URL efectiva también queda en `~/.dbtracker/server.json`:

- `http://127.0.0.1:8787/mcp` normalmente;
- el siguiente puerto libre si el 8787 está ocupado (p. ej. con `npm run dev` y Electron abiertos a la vez).

## 2. Conectar Claude Code

**CLI**, en cualquier carpeta:

```bash
claude mcp add --transport http dbtracker http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer <token>"
```

En macOS con la app de escritorio, el token está en `~/Library/Application Support/db-tracker/mcp-token`. Con `npm run dev`, en `.dbtracker-data/mcp-token`.

**Dentro de este repositorio**, el `.mcp.json` ya registra `dbtracker`. Basta con exportar el token (y la URL si no es la de por defecto):

```bash
export DBTRACKER_MCP_TOKEN=<token>
export DBTRACKER_MCP_URL=http://127.0.0.1:8787/mcp   # opcional
claude
```

En Claude, `/mcp` debe mostrar `dbtracker` conectado.

**Claude Desktop** usa el puente stdio. Compílalo con `node scripts/build-node.mjs mcp` y añade a `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):

```json
{ "mcpServers": { "dbtracker": { "command": "node", "args": ["<ruta del repo>/dist-mcp/stdio.mjs"] } } }
```

El puente encuentra la URL y el token solo y espera a que abras la app.

## 3. Pedir trabajo

Ejemplos:

- «Con dbtracker, crea un flujo y normaliza `pedidos_legacy` sin perder datos».
- «Revisa los triggers de `pedidos` y añade auditoría en una rama nueva».
- «Compara los flujos y dime cuál integrar».

Las herramientas se llaman `mcp__dbtracker__<herramienta>`. Las 16 disponibles son:

- **Sesión y lectura:** `session_status`, `session_open`, `get_project`, `get_schema`, `get_sql`.
- **Flujos y edición:** `create_branch`, `edit_schema`, `commit_version`.
- **Comparación:** `diff`, `generate_migration`, `compare_flows`.
- **Normalización:** `analyze_normalization`, `apply_normalization_fix`.
- **Base de datos real:** `db_introspect`, `db_benchmark`.
- **Presencia:** `set_status`.

## 4. Varios agentes a la vez

El repositorio trae subagentes especializados en `.claude/agents/`. Cada uno solo tiene las herramientas MCP que necesita:

| Subagente | Qué hace |
|---|---|
| `dbt-normalizador` | 1FN a BCNF en su propio flujo, con copia de datos |
| `dbt-rendimiento` | Índices, tipos y vistas materializadas; mide con `db_benchmark` si le das una conexión |
| `dbt-triggers` | Auditoría, `updated_at`, integridad y refresco de vistas, sin ciclos |
| `dbt-revisor` | Revisión crítica de solo lectura: diff, migración y normalización; recomienda |
| `dbt-documentador` | Escribe en Markdown la historia de los flujos |

Y el **workflow multiagente** `.claude/workflows/dbtracker-flujos.js`:

```
/dbtracker-flujos "normalizar y auditar pedidos"
```

1. **Preparar:** abre la sesión, lee el proyecto y propone un flujo por especialista.
2. **Flujos:** cada especialista trabaja **en paralelo** en su rama. Lo ves en vivo en la app.
3. **Revisar:** el revisor busca pérdida de datos, ciclos y regresiones. Si encuentra algo grave, hay una ronda de corrección.
4. **Comparar:** métricas de cada flujo y recomendación (y documentación, si se pide).

## Seguridad

- `/mcp` solo existe en `127.0.0.1`, con token y comprobación de origen. Nunca está en el listener de red.
- Los agentes no reciben tu token de GitHub ni las contraseñas guardadas. Para una base real, la contraseña va en la llamada y no se guarda.
- Puedes expulsar a un agente como a cualquier participante y regenerar el token cuando quieras.

[← Volver al README](../../README.md)
