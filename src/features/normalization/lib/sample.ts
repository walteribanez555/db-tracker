// Esquema de ejemplo con problemas de normalización típicos y algunos triggers.
// Se usa como demo cuando el borrador está vacío.
import { uid } from '@/lib/id'
import type { Column, Schema, Table } from '@/types/schema'

const col = (name: string, type: string, extra: Partial<Column> = {}): Column => ({
  id: uid('col_'),
  name,
  type,
  pk: false,
  nullable: true,
  unique: false,
  autoIncrement: false,
  ...extra,
})
const pk = (name = 'id', type = 'serial') => col(name, type, { pk: true, nullable: false, autoIncrement: type.includes('serial') })

const table = (name: string, color: string, x: number, y: number, columns: Column[]): Table => ({
  id: uid('tbl_'),
  name,
  color,
  columns,
  indexes: [],
  position: { x, y },
})

export function createSampleSchema(): Schema {
  const clientes = table('clientes', '#3b82f6', 80, 80, [
    pk(),
    col('nombre', 'varchar(120)', { nullable: false }),
    col('email', 'varchar(255)', { unique: true }),
    col('telefono1', 'varchar(20)'),
    col('telefono2', 'varchar(20)'),
    col('telefono3', 'varchar(20)'),
    col('fechaNacimiento', 'varchar(10)'),
  ])
  const pedidos = table('pedidos', '#8b5cf6', 420, 80, [
    pk(),
    col('cliente_id', 'integer', { nullable: false }),
    col('cliente_nombre', 'varchar(120)'),
    col('cliente_email', 'varchar(255)'),
    col('fecha', 'varchar(20)'),
    col('estado', 'varchar(20)', { default: "'pendiente'" }),
    col('total', 'float'),
    col('tags', 'text'),
    col('updated_at', 'timestamptz', { default: 'now()' }),
  ])
  const productos = table('productos', '#f59e0b', 420, 420, [
    pk(),
    col('nombre', 'varchar(120)', { nullable: false }),
    col('precio', 'numeric(10,2)', { nullable: false }),
    col('stock', 'integer', { default: '0' }),
  ])
  const items = table('pedido_items', '#10b981', 760, 260, [
    pk('pedido_id', 'integer'),
    pk('producto_id', 'integer'),
    col('producto_nombre', 'varchar(120)'),
    col('cantidad', 'integer', { nullable: false }),
    col('precio', 'numeric(10,2)'),
  ])
  const proveedor = table('proveedor', '#f43f5e', 80, 460, [
    col('nombre', 'varchar(120)'),
    col('contacto_nombre', 'varchar(120)'),
    col('contacto_email', 'varchar(255)'),
    col('productos', 'text'),
  ])
  const auditoria = table('auditoria', '#64748b', 1100, 80, [
    pk('id', 'bigserial'),
    col('tabla', 'text', { nullable: false }),
    col('operacion', 'text', { nullable: false }),
    col('datos_antes', 'jsonb'),
    col('datos_despues', 'jsonb'),
    col('usuario', 'text', { default: 'current_user' }),
    col('creado_en', 'timestamptz', { default: 'now()' }),
  ])

  const rel = (src: Table, srcCol: Column, tgt: Table, tgtCol: Column) => ({
    id: uid('rel_'),
    sourceTableId: src.id,
    sourceColumnId: srcCol.id,
    targetTableId: tgt.id,
    targetColumnId: tgtCol.id,
    cardinality: '1:N' as const,
    onDelete: 'CASCADE' as const,
    onUpdate: 'CASCADE' as const,
  })

  const fnTotal = {
    id: uid('fn_'),
    name: 'fn_recalcular_total',
    language: 'plpgsql' as const,
    args: '',
    returns: 'trigger',
    body: `BEGIN
  UPDATE pedidos
     SET total = (SELECT COALESCE(SUM(cantidad * precio), 0)
                    FROM pedido_items
                   WHERE pedido_id = COALESCE(NEW.pedido_id, OLD.pedido_id))
   WHERE id = COALESCE(NEW.pedido_id, OLD.pedido_id);
  RETURN NULL;
END;`,
    position: { x: 640, y: 40 },
  }
  const fnAudit = {
    id: uid('fn_'),
    name: 'fn_auditoria',
    language: 'plpgsql' as const,
    args: '',
    returns: 'trigger',
    body: `BEGIN
  INSERT INTO auditoria (tabla, operacion, datos_antes, datos_despues)
  VALUES (TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END;`,
    position: { x: 640, y: 260 },
  }
  const fnUpdated = {
    id: uid('fn_'),
    name: 'fn_set_updated_at',
    language: 'plpgsql' as const,
    args: '',
    returns: 'trigger',
    body: `BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;`,
    position: { x: 640, y: 460 },
  }

  const views = [
    {
      id: uid('view_'),
      name: 'mv_ventas_diarias',
      definition: `SELECT p.fecha::date AS dia, count(*) AS pedidos, sum(p.total) AS ventas
FROM pedidos p
GROUP BY p.fecha::date`,
      materialized: true,
      sourceIds: [pedidos.id],
      columns: [
        { name: 'dia', type: 'date' },
        { name: 'pedidos', type: 'bigint' },
        { name: 'ventas', type: 'numeric' },
      ],
      color: '#0891b2',
      position: { x: 760, y: 560 },
    },
    {
      id: uid('view_'),
      name: 'v_clientes_contacto',
      definition: `SELECT c.id, c.nombre, c.email, c.telefono
FROM clientes c`,
      materialized: false,
      sourceIds: [clientes.id],
      columns: [{ name: 'id' }, { name: 'nombre' }, { name: 'email' }, { name: 'telefono' }],
      color: '#0891b2',
      position: { x: 80, y: 760 },
    },
  ]

  return {
    dialect: 'postgresql',
    tables: [clientes, pedidos, productos, items, proveedor, auditoria],
    views,
    relations: [
      rel(clientes, clientes.columns[0], pedidos, pedidos.columns[1]),
      rel(pedidos, pedidos.columns[0], items, items.columns[0]),
      rel(productos, productos.columns[0], items, items.columns[1]),
    ],
    enums: [],
    functions: [fnTotal, fnAudit, fnUpdated],
    triggers: [
      {
        id: uid('trg_'),
        name: 'trg_pedido_items_total',
        tableId: items.id,
        functionId: fnTotal.id,
        timing: 'AFTER',
        events: ['INSERT', 'UPDATE', 'DELETE'],
        level: 'ROW',
        position: { x: 340, y: 40 },
      },
      {
        id: uid('trg_'),
        name: 'trg_pedidos_auditoria',
        tableId: pedidos.id,
        functionId: fnAudit.id,
        timing: 'AFTER',
        events: ['INSERT', 'UPDATE', 'DELETE'],
        level: 'ROW',
        position: { x: 340, y: 260 },
      },
      {
        id: uid('trg_'),
        name: 'trg_pedidos_updated_at',
        tableId: pedidos.id,
        functionId: fnUpdated.id,
        timing: 'BEFORE',
        events: ['UPDATE'],
        level: 'ROW',
        condition: 'OLD IS DISTINCT FROM NEW',
        position: { x: 340, y: 460 },
      },
    ],
    notes: [],
  }
}
