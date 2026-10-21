# 8. Conectar bases de datos remotas

[← Volver al README](../../README.md)

Sección **Importar / Exportar → Bases de datos remotas**. Admite PostgreSQL y MySQL. Las consultas las hace el servidor local (`/api/db`), no el navegador.

## 1. Crear la conexión

Rellena nombre, motor, host, puerto, base, usuario y contraseña (y SSL si hace falta). Pulsa **Probar conexión**: verás la versión del servidor y la latencia. Después, **Guardar conexión**.

La contraseña no se guarda con el proyecto: queda en memoria o, si marcas la casilla, en `sessionStorage` de esa pestaña.

## 2. Leer el esquema

**Importar esquema (introspección)** lee tablas, columnas, claves, relaciones, índices, enums, vistas, funciones y triggers. Cada fase aparece con su tiempo real en el dock. Revisa los objetos (con las filas estimadas por tabla) y pulsa **Importar al proyecto**: se crea la rama `remoto/<nombre>` con una versión confirmada.

## 3. Comparar y migrar

En **Migración**, elige con qué comparar la base: el borrador o cualquier versión. Verás:

- el DDL remoto frente al DDL elegido, lado a lado;
- el SQL de migración, con avisos de pérdida de datos;
- los pasos que se ejecutarán.

Después:

- **Validar sin aplicar** (solo PostgreSQL): ejecuta todo en una transacción que termina en `ROLLBACK`.
- **Aplicar**: pide escribir el nombre de la base para confirmar y ejecuta en una transacción con `COMMIT`. Si una sentencia falla, se revierte todo y ese paso queda en rojo.

## 4. Medir el rendimiento

En **Rendimiento**:

1. **Sugerir consultas** propone joins por FK, filtros indexados, lecturas de vistas y conteos. También puedes escribir tus propias consultas con autocompletado.
2. Elige las repeticiones y, si quieres, **EXPLAIN ANALYZE**.
3. Elige a qué versión atribuir la medición y pulsa **Medir**.

Cada consulta se ejecuta en una transacción de solo lectura. Los resultados (media, p95, mín./máx./mediana y plan) alimentan [Informes](09-informes-y-pdf.md).

Siguiente: [Informes y PDF →](09-informes-y-pdf.md)
