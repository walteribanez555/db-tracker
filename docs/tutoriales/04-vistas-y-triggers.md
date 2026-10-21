# 4. Vistas y triggers: flujo visual y simulador

[← Volver al README](../../README.md)

## Vistas

- **Crear:** **+ Vista** en la barra del diagrama, o <kbd>Ctrl</kbd> + clic derecho sobre una tabla → **Crear vista desde esta tabla**.
- **Editar:** doble clic sobre la vista abre su SQL en el editor de código, con autocompletado de tablas y columnas. **Detectar columnas y orígenes** lee el `SELECT` y conecta la vista con sus tablas.
- **Materializada:** un interruptor en el inspector o en el menú.
- En el lienzo, las vistas tienen borde discontinuo y icono de ojo, y se unen a sus tablas de origen con líneas discontinuas.

## Triggers y funciones

Sección **Triggers** (`/triggers`). El lienzo se lee de izquierda a derecha: **tabla → dispara → trigger → ejecuta → función → escribe en / refresca → efectos**.

- **+ Trigger** y **+ Función** en la paleta izquierda.
- **Plantillas**: auditoría, `updated_at` automático, borrado lógico, validación, contador y refrescar vista materializada. Crean la función, el trigger y, si hace falta, la tabla de auditoría. Cada paso se ve en el dock.
- **Solo tablas implicadas** oculta las tablas que no tienen triggers.
- Un trigger desactivado en la base se muestra atenuado con el texto «desactivado». Se activa o desactiva desde su menú.

## Modal del trigger

Seleccionar un trigger, en **Triggers** o en el **Diagrama**, abre un modal con:

- **Encabezado:** momento, eventos, nivel, función, tabla y estado en la base, más Editar, Duplicar, Activar/Desactivar y Eliminar.
- **Flujo:** la tabla, los triggers del mismo momento en su orden real (el actual resaltado), la función, sus efectos y la cascada hasta 2 niveles.
- **Pestañas:**
  - **Simular:** elige INSERT, UPDATE o DELETE y pulsa **Reproducir** o avanza paso a paso. El paso actual se ilumina en la lista y en el flujo; los triggers desactivados aparecen como omitidos y los ciclos se marcan en rojo.
  - **Detalles:** edición en línea y cuerpo de la función.
  - **SQL:** `CREATE FUNCTION` + `CREATE TRIGGER`, listo para copiar.
  - **Efectos:** tablas y vistas afectadas.
  - **Historial:** versiones en las que cambió el trigger.

Siguiente: [Asesor de normalización →](05-normalizacion.md)
