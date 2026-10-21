# 9. Informes y PDF

[← Volver al README](../../README.md)

Sección **Informes** (`/informes`). Compara los flujos en tres ejes:

| Métrica | Qué mide |
|---|---|
| **Tiempo de respuesta** | Latencia media y p95 de las consultas de prueba en la última versión medida de cada flujo. Indica si el valor es **medido** (base real) o **estimado** (heurística sobre el esquema). |
| **Agilidad** | Horas medias entre versiones y versiones por día |
| **Saltos** | Cambios estructurales por versión: tablas, columnas, índices, relaciones, vistas y triggers |

## Recomendación

La puntuación combina el p95 y los saltos totales; el control **Peso de la latencia** decide cuánto pesa cada uno. Si hay flujos con mediciones reales, los que solo tienen estimaciones no compiten y se indica el motivo, por ejemplo «sin medir: mide su versión en Importar / Exportar».

Filtra por periodo (preset o fechas desde y hasta). Cada bloque es plegable. Si el proyecto está vinculado a GitHub, al final aparecen commits, adiciones y eliminaciones por rama.

## Informe PDF

**Descargar informe PDF** abre un diálogo donde eliges las secciones (esquemas finales, SQL de migración, consultas y registro de la sesión) y los flujos. El PDF se genera en tu navegador y contiene:

- **Portada:** proyecto, dialecto, periodo, flujos y versiones.
- **Resumen ejecutivo:** tabla comparativa con la fuente de cada latencia y la recomendación.
- **Por flujo:** su esquema final y, para cada versión, la **lista de acciones** (+ / − / ~), los pasos de copia de datos y el SQL de migración desde su padre.
- **Consultas:** SQL completo, repeticiones, media, p95, mín./máx./mediana, fuente y plan.
- **Registro de acciones** de la sesión, paso a paso.
- **Glosario** de las métricas.

El archivo se llama `informe-flujos-<proyecto>-<fecha>.pdf`.

Siguiente: [Subir y bajar con GitHub →](10-github.md)
