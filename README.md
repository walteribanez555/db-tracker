# DB Tracker

Gestor visual de bases de datos con **versiones por flujo**. Cada rama es un *flujo* (normalizar a 3FN, añadir auditoría con triggers, probar un índice…) y cada versión queda en una línea de tiempo. Así se compara qué flujo responde mejor, cuánto tardó y cuántos cambios estructurales (*saltos*) introdujo.

Funciona en el navegador con un pequeño servidor local (Node + Hono) para conectarse a bases remotas y a GitHub. No necesita base de datos propia: el proyecto vive en tu navegador.

## Qué puedes hacer

| Área | Qué incluye |
|---|---|
| **Diagrama** | Tablas, columnas, relaciones (arrastrando entre columnas), vistas, triggers y notas en un lienzo React Flow. Edición en línea, menú de acciones con <kbd>Ctrl</kbd> + clic derecho, capas, orden automático y exportación a PNG o SVG. |
| **Triggers y funciones** | Flujo tabla → trigger → función → efectos, plantillas (auditoría, `updated_at`, borrado lógico…) y un modal por trigger con simulador paso a paso. |
| **Normalización** | Asesor de 1FN a BCNF y buenas prácticas. Cada consejo se aplica en el borrador o como un flujo nuevo, con el SQL que copia los datos. |
| **Versiones y flujos** | Ramas, confirmación de versiones, línea de tiempo, diff estructural y de SQL lado a lado, y cambios en vivo del borrador. |
| **Informes** | Tiempo de respuesta (medido o estimado), agilidad, saltos, recomendación e **informe PDF** de todos los flujos. |
| **Importar / exportar** | SQL (PostgreSQL, MySQL, SQLite, SQL Server), DBML, Prisma, Mermaid, Markdown y JSON, más migraciones entre versiones. |
| **Bases remotas** | PostgreSQL y MySQL: leer el esquema, comparar, validar en seco, aplicar migraciones y medir el rendimiento de consultas. |
| **GitHub** | Subir el proyecto a un repositorio (una rama por flujo, un commit por versión) y bajarlo. La conexión dura solo la sesión. |
| **Colaboración en red** | Un equipo comparte su proyecto en la red local y otros se unen desde el escritorio, el navegador o el móvil (enlace, QR o código). Edición en tiempo real, cursores y selección de cada persona, roles y aprobación de invitados. |
| **Interfaz** | Tema claro u oscuro (estilo Telegram, con transición circular), paneles plegables, editor de código estilo VS Code (Monaco) y un dock de operaciones paso a paso. |

## Inicio rápido

Requisitos: Node 22 o superior. Docker es opcional, solo para la base de ejemplo.

```bash
npm install
npm run dev          # web en http://localhost:5173 + API en :8787
```

Para tener datos reales con los que probar:

```bash
npm run db:up        # PostgreSQL de ejemplo en localhost:5432
```

Después, en la app, ve a **Importar / Exportar → Bases de datos remotas** y conecta a `localhost:5432`, base `tienda`, usuario `dbtracker`, contraseña `dbtracker_local`. Son credenciales solo para la base de ejemplo local.

## Tutoriales

1. [Instalación y puesta en marcha](docs/tutoriales/01-instalacion.md)
2. [Base de datos de ejemplo con Docker](docs/tutoriales/02-base-de-ejemplo.md)
3. [Diseñar el diagrama: tablas, columnas y relaciones](docs/tutoriales/03-diagrama.md)
4. [Vistas y triggers: flujo visual y simulador](docs/tutoriales/04-vistas-y-triggers.md)
5. [Asesor de normalización](docs/tutoriales/05-normalizacion.md)
6. [Versiones, flujos y cambios en vivo](docs/tutoriales/06-versiones-y-flujos.md)
7. [Importar y exportar](docs/tutoriales/07-importar-exportar.md)
8. [Conectar bases de datos remotas](docs/tutoriales/08-bases-remotas.md)
9. [Informes y PDF](docs/tutoriales/09-informes-y-pdf.md)
10. [Subir y bajar con GitHub](docs/tutoriales/10-github.md)
11. [Tema, paneles y atajos](docs/tutoriales/11-tema-y-atajos.md)
12. [Aplicación de escritorio](docs/tutoriales/12-escritorio.md)
13. [Colaborar en la red local](docs/tutoriales/13-colaboracion.md)

Diseño técnico: [Colaboración en red: una app de escritorio como servidor](docs/arquitectura/colaboracion-en-red.md).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Vite y la API local en modo desarrollo |
| `npm run build` | Compila el frontend y empaqueta el servidor |
| `npm start` | Sirve la app compilada y la API desde un solo proceso |
| `npm run typecheck` | Comprobación de tipos (frontend y servidor) |
| `npm run lint` | oxlint |
| `npm run db:up` / `db:down` | Arranca o para la base de ejemplo |
| `npm run db:reset` | Borra la base de ejemplo y la recrea desde las migraciones |
| `npm run db:psql` | Abre `psql` dentro del contenedor |

## Estructura

```
src/
  features/        una carpeta por sección: editor, triggers, normalization,
                   versions, reports, io, github
  components/      piezas comunes: ui (shadcn), layout, theme, code (Monaco),
                   flow (menú de acciones), operation-flow (dock de operaciones)
  lib/             exporters, importers, diff
  collab/          cliente de colaboración (Yjs, WebSocket, presencia)
  store/           estado del proyecto (zustand, persistido en el navegador)
  types/           modelo de dominio compartido
server/            API Hono: /api/db (bases remotas), /api/github y /api/collab + /sync (colaboración)
docker/            PostgreSQL de ejemplo con migraciones y datos
electron/          proceso principal de escritorio (embebe la misma API)
```

## Stack

React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, React Flow (`@xyflow/react`), zustand, Monaco, Recharts, `@react-pdf/renderer`, Hono, `pg`, `mysql2`, Octokit, Yjs y `ws`.

## Privacidad

- El proyecto se guarda en el `localStorage` de tu navegador.
- Las contraseñas de las bases remotas quedan en memoria (o en `sessionStorage` si lo eliges); nunca en el proyecto ni en las exportaciones.
- El token de GitHub vive solo en la memoria del servidor local y se descarta al desconectar o reiniciar.
