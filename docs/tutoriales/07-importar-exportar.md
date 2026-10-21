# 7. Importar y exportar

[← Volver al README](../../README.md)

Sección **Importar / Exportar** (`/datos`).

## Exportar

1. Elige el **origen**: el borrador actual o cualquier versión.
2. Elige el **formato**:

| Formato | Uso |
|---|---|
| SQL (DDL) | PostgreSQL, MySQL, SQLite o SQL Server. Incluye tablas, índices, FKs con ON DELETE/UPDATE, enums, vistas (ordenadas por dependencias), funciones, triggers y su estado activo o desactivado |
| DBML | dbdiagram.io y herramientas DBML |
| Prisma | `schema.prisma` |
| Mermaid | `erDiagram` para Markdown o GitHub |
| Markdown | Diccionario de datos |
| JSON | Esquema de DB Tracker (reimportable) o copia completa del proyecto con ramas y versiones |

3. Revisa la vista previa en el editor de código y usa **Copiar** o **Descargar**.

**Migración entre versiones** genera el SQL `ALTER` para pasar de una versión a otra, incluidos los pasos de copia de datos de la normalización.

## Importar

1. Arrastra un archivo o pégalo en el editor. El formato (SQL, DBML o JSON) se detecta solo.
2. Revisa la vista previa: tablas, relaciones, vistas y triggers.
3. Elige si importas **como borrador actual** o **como rama nueva**.

Una copia JSON del proyecto completo restaura todas las ramas y versiones, previa confirmación.

Siguiente: [Conectar bases de datos remotas →](08-bases-remotas.md)
