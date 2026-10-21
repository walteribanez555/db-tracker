# 2. Base de datos de ejemplo con Docker

[← Volver al README](../../README.md)

El repositorio trae una base PostgreSQL 16 lista para probar todo: tablas con relaciones, enums, índices, una vista, una vista materializada, funciones, triggers, un historial de migraciones y datos en volumen.

## Arrancar

```bash
npm run db:up        # crea y arranca el contenedor dbtracker-pg
```

| Dato | Valor |
|---|---|
| Host | `localhost` |
| Puerto | `5432` |
| Base de datos | `tienda` |
| Usuario | `dbtracker` |
| Contraseña | `dbtracker_local` (solo para esta base local) |

## Qué contiene

Los scripts de `docker/postgres/init/` se ejecutan en orden al crear el contenedor y quedan registrados en la tabla `schema_migrations`.

| Migración | Contenido |
|---|---|
| `001` | `pedidos_legacy`: tabla **sin normalizar** a propósito (teléfonos en una lista, productos en texto, dinero en `float`, fecha como texto). Es la que detecta el asesor de normalización. |
| `002` | `clientes`, `telefonos_cliente`, `categorias` (jerárquica) y `productos` |
| `003` | Enum `estado_pedido`, `pedidos` y `pedido_items` (clave primaria compuesta) |
| `004` | Índices en claves foráneas. Falta a propósito el de `pedido_items.producto_id`. |
| `005` | Vista `v_resumen_pedidos_cliente` y vista materializada `mv_ventas_diarias` |
| `006` | Tabla `auditoria`, 4 funciones y 5 triggers. `trg_refrescar_ventas` queda **desactivado**. |
| `900` | Datos: 2 000 clientes, 500 productos, 20 000 pedidos y ~50 000 ítems |

## Comandos útiles

```bash
npm run db:psql      # consola psql dentro del contenedor
npm run db:reset     # borra todo y recrea desde las migraciones
npm run db:down      # para el contenedor (los datos se conservan)
```

Usa `db:reset` después de aplicar migraciones de prueba desde la app para volver al estado inicial.

## Siguiente paso

Conéctala desde la app: [Conectar bases de datos remotas →](08-bases-remotas.md)
