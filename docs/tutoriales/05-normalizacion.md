# 5. Asesor de normalización

[← Volver al README](../../README.md)

Sección **Normalización** (`/normalizacion`). Analiza el borrador y agrupa los hallazgos por nivel: **1FN**, **2FN**, **3FN**, **BCNF** y **buenas prácticas**. Arriba se ve qué forma normal alcanza el esquema.

## Qué detecta

| Nivel | Reglas |
|---|---|
| 1FN | Tabla sin clave primaria, columna multivaluada (listas en texto, arrays, JSON), grupos repetitivos (`telefono1`, `telefono2`…) |
| 2FN | Dependencia parcial en claves compuestas |
| 3FN | Dependencia transitiva (p. ej. `cliente_nombre` junto a `cliente_id`) |
| BCNF | Claves candidatas superpuestas |
| Buenas prácticas | FK sin índice, columnas duplicadas, nombres inconsistentes, singular/plural, palabras reservadas, dinero en `float`, fecha o booleano como texto, vistas rotas, sin uso o sin refresco |

## Aplicar un consejo

Cada hallazgo explica **por qué importa** y **qué hacer**, con un **antes y después** visual y el plan de pasos. Tienes dos opciones:

- **Aplicar en el borrador**: transforma el esquema actual (con Deshacer).
- **Aplicar en un flujo nuevo**: crea una rama `flujo/normalizacion-…`, aplica la corrección y la confirma como versión. Así puedes comparar el esquema normalizado con el original en **Versiones** e **Informes**.

Los pasos (crear tabla → añadir columnas → **copiar datos** → quitar columnas → relación → índice → rama → versión) se animan en el dock de operaciones.

## Sin pérdida de datos

Cada corrección guarda el SQL que preserva los datos. Por ejemplo, convertir `'a, b, c'` en filas con `unnest(string_to_array(...))`, o una fecha `DD/MM/YYYY` en `date` con `USING to_date(...)`. La migración que generan **Importar / Exportar** y **Bases remotas** ejecuta ese paso después de crear las tablas nuevas y **antes** de borrar las columnas originales.

## Probarlo con la base de ejemplo

1. Arranca la [base de ejemplo](02-base-de-ejemplo.md) e impórtala ([tutorial 8](08-bases-remotas.md)).
2. En **Normalización** aparecen los problemas de `pedidos_legacy`.
3. Aplica «columna multivaluada» en un flujo nuevo.
4. En **Bases remotas**, compara con el borrador, valida en seco y aplica.

Siguiente: [Versiones, flujos y cambios en vivo →](06-versiones-y-flujos.md)
