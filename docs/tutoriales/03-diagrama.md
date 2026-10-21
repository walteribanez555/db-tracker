# 3. Diseñar el diagrama: tablas, columnas y relaciones

[← Volver al README](../../README.md)

Sección **Diagrama** (`/editor`). Todo se edita dentro del mismo lienzo; el inspector de la derecha es opcional.

## Crear una tabla

- Pulsa <kbd>T</kbd>, el botón de tabla de la barra flotante o **+ Nueva tabla** en la barra lateral.
- Con <kbd>Ctrl</kbd> + clic derecho sobre el lienzo vacío → **Nueva tabla aquí** la crea donde está el cursor.

Cada tabla nueva nace con una columna `id uuid` como clave primaria.

## Columnas

- **Añadir:** pulsa **+ columna** al pie del nodo. <kbd>Enter</kbd> crea otra y <kbd>Esc</kbd> termina.
- **Renombrar:** doble clic en el nombre (o <kbd>F2</kbd>).
- **Tipo:** clic en el tipo. Se abre un buscador con los tipos del dialecto y los enums del esquema.
- **PK, Not null y Unique:** desde el menú de la columna (<kbd>Ctrl</kbd> + clic derecho sobre la fila) o desde el inspector.

## Relaciones

Arrastra desde el borde de una columna hasta otra columna. Se abre **Nueva relación** con:

- cardinalidad 1:1, 1:N o N:M;
- `ON DELETE` y `ON UPDATE`;
- un aviso si los tipos no son compatibles, con la opción de igualar el tipo de la FK al de la PK.

El lado «uno» siempre queda en la clave primaria.

## Menú de acciones (<kbd>Ctrl</kbd> + clic derecho)

En macOS también vale <kbd>⌘</kbd> + clic derecho. Con un elemento seleccionado, <kbd>Shift</kbd> + <kbd>F10</kbd> abre el mismo menú.

| Sobre… | Acciones |
|---|---|
| Tabla | Renombrar, añadir columna, duplicar, color, crear vista desde la tabla, añadir trigger (plantillas), revisar normalización, copiar SQL, eliminar |
| Columna | Renombrar, tipo, PK / Not null / Unique, relacionar con…, mover, eliminar |
| Relación | Cardinalidad, ON DELETE / ON UPDATE, invertir, eliminar |
| Lienzo vacío | Tabla, vista o nota aquí, pegar, orden automático, ajustar vista, exportar imagen |

## Capas y cambios sin confirmar

La sección **Capas** muestra u oculta tablas, vistas, triggers y notas. **Resaltar cambios sin confirmar** marca lo que difiere de la última versión:

- elemento nuevo: borde punteado;
- elemento modificado: punto lateral;
- columnas: `+` o `~`.

## Orden automático y exportar imagen

- **Orden automático** coloca las tablas por niveles de dependencia; las vistas van a la derecha y los triggers debajo de su tabla. Los pasos se ven en el dock de operaciones.
- **Exportar imagen ▸ PNG / SVG** encuadra los nodos visibles y descarga la imagen sin minimapa ni controles.

## Deshacer

<kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd> deshace y <kbd>⇧</kbd> + <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Z</kbd> rehace. Las operaciones compuestas, como aplicar una corrección o el orden automático, se deshacen de una vez.

Siguiente: [Vistas y triggers →](04-vistas-y-triggers.md)
