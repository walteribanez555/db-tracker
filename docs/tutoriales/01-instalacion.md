# 1. Instalación y puesta en marcha

[← Volver al README](../../README.md)

## Requisitos

- Node.js 22 o superior.
- Docker, solo si quieres la [base de ejemplo](02-base-de-ejemplo.md).

## Desarrollo

```bash
git clone https://github.com/walteribanez555/db-tracker.git
cd db-tracker
npm install
npm run dev
```

`npm run dev` arranca dos procesos:

- **web**: Vite en http://localhost:5173.
- **api**: el servidor Hono en http://localhost:8787. Vite le reenvía todo lo que empieza por `/api`.

Abre http://localhost:5173. La primera vez el proyecto está vacío. Para ver algo enseguida, ve a **Versiones → Cargar proyecto de ejemplo**: crea una tienda online con cinco flujos (`main`, `flujo/1fn`, `flujo/2fn`, `flujo/3fn` y `flujo/triggers-auditoria`).

## Producción (un solo proceso)

```bash
npm run build
npm start            # http://localhost:8787
```

`npm start` sirve el frontend compilado (`dist/`) y la API desde el mismo proceso.

Variables opcionales:

| Variable | Uso |
|---|---|
| `PORT` | Puerto del servidor (por defecto 8787) |
| `HOST` | Interfaz de escucha (por defecto 127.0.0.1) |
| `GITHUB_CLIENT_ID` | Activa el inicio de sesión de GitHub con dispositivo (ver [tutorial 10](10-github.md)) |

## Comprobaciones

```bash
npm run typecheck
npm run lint
```

Siguiente: [Base de datos de ejemplo con Docker →](02-base-de-ejemplo.md)
