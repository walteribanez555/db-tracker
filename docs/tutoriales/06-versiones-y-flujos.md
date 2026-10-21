# 6. Versiones, flujos y cambios en vivo

[← Volver al README](../../README.md)

## Conceptos

- **Borrador**: el esquema que editas. Se guarda solo en tu navegador.
- **Versión**: una instantánea confirmada del esquema (equivale a un commit).
- **Flujo**: una rama. Representa un camino de diseño: `flujo/3fn`, `flujo/triggers-auditoria`, `remoto/local-docker`…

## Confirmar una versión

El selector de rama de la cabecera muestra un punto ámbar cuando hay cambios sin confirmar. Pulsa **Confirmar**, escribe el mensaje y revisa el resumen del diff. La operación se ve en el dock: calcular diff → validar → crear versión → mover la cabeza de la rama.

## Crear un flujo

- **Versiones → Nueva** (o el selector de rama → **Nueva rama…**): nombre `flujo/…`, descripción y versión de origen.
- Desde una versión de la línea de tiempo: **Crear rama desde aquí**.
- El asesor de normalización y la importación remota también crean flujos.

## Línea de tiempo

Sección **Versiones** (`/versiones`):

- Un carril por flujo sobre fechas reales, con escala **Día** o **Semana**.
- Cada punto es una versión; su tamaño y su número indican los saltos respecto a la anterior. Debajo aparecen marcas como «+1 vista» o «+2 triggers».
- Las bifurcaciones salen de la versión de origen.
- El punto **borrador** late mientras haya cambios sin confirmar.

Al hacer clic en una versión se ve su autor, su fecha, el tiempo desde la anterior, los saltos y el diff (+ / − / ~). La sección **SQL** muestra el DDL de la versión y la migración desde su padre. Las acciones disponibles son **Abrir en editor**, **Crear rama desde aquí** y **Comparar con…** (diff estructural y diff de SQL lado a lado).

## Cambios en vivo

El dock inferior **Flujo → Cambios en vivo** muestra al instante lo que cambió en el borrador respecto a su versión base: un nodo por cada objeto modificado, entre la versión base y el borrador. Desde ahí puedes **Confirmar versión**, **Descartar** o **Ver SQL** (diff base → borrador).

## Dock de operaciones

**Flujo → Operaciones** guarda el historial de la sesión. Cada operación compuesta se ve como una fila de pasos que pasa de pendiente a en curso y a hecha o error, con su detalle y su tiempo. El historial también entra en el [informe PDF](09-informes-y-pdf.md).

Siguiente: [Importar y exportar →](07-importar-exportar.md)
