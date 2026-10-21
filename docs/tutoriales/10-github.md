# 10. Subir y bajar con GitHub

[← Volver al README](../../README.md)

Sección **GitHub** (`/github`). La conexión y el vínculo con el repositorio **duran solo la sesión**. El token vive en la memoria del servidor local (el navegador solo recibe una cookie `httpOnly`) y nada se sincroniza en segundo plano: tú decides cuándo **subir** y cuándo **bajar**.

## Conectar

- **Token personal**: crea uno en [github.com/settings/tokens](https://github.com/settings/tokens).
  - Classic: con el scope `repo`.
  - Fine-grained: con permisos *Contents: Read and write*, *Metadata: Read* y, para crear repositorios, *Administration: Read and write*.
  - Pégalo en la app; se valida contra la API antes de guardarse.
- **Inicio con dispositivo**: arranca el servidor con `GITHUB_CLIENT_ID=<id de tu OAuth App> npm run dev` y sigue el código que muestra la app.

## Crear o vincular un repositorio

- **Crear repositorio**: el nombre sugerido es `<proyecto>-db` y es privado por defecto. Se crea y se sube enseguida.
- **Vincular**: elige uno de tus repositorios.

## Subir

Cada **flujo** se convierte en una **rama** con el mismo nombre, y cada **versión** en un **commit** con su fecha original. Cada commit incluye:

```
.dbtracker/project.json   nombres, colores y descripción de los flujos
README.md                 resumen del flujo, tablas, vistas, triggers y diagrama Mermaid
schema.sql  schema.dbml  schema.json  diagram.mmd
migrations/NNN_<mensaje>.sql
```

- Volver a subir es idempotente: las versiones que ya existen se saltan.
- Si alguien subió cambios desde otra sesión, la app avisa y propone **Bajar primero**, **Subir de todos modos** o forzar.
- El progreso se ve por versión en la vista y en el dock.

## Bajar

**Bajar** (o **Bajar de un repositorio** con `propietario/repo`) lee las ramas y los commits de DB Tracker, reconstruye el proyecto con sus versiones, padres y fechas, y lo carga tras mostrar una vista previa. Si tienes cambios locales que no están en el repositorio, ofrece exportar antes una copia JSON.

## Informe del repositorio

Por rama: commits, adiciones, eliminaciones, archivos, adelante/atrás y lead time, más un enlace al grafo de red de GitHub.

Siguiente: [Tema, paneles y atajos →](11-tema-y-atajos.md)
