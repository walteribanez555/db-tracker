// Proyecto de ejemplo "tienda-online" (PostgreSQL): demuestra flujos de normalización (1FN → 2FN → 3FN)
// y un flujo de triggers de auditoría. IDs estables y legibles para que los diffs y benchmarks sean deterministas.
import { estimateVersionBenchmarks } from '@/lib/diff'
import type { QueryBenchmark } from '@/types/report'
import type { Branch, Column, DbFunction, Index, Project, Relation, Schema, Table, Trigger, Version, View } from '@/types/schema'

export const SAMPLE_PROJECT_ID = 'prj_tienda_online'

/* ------------------------------- Colores ------------------------------- */

const C = {
  pedidos: '#3b82f6',
  items: '#8b5cf6',
  productos: '#f59e0b',
  clientes: '#10b981',
  auditoria: '#f43f5e',
  telefonos: '#06b6d4',
  categorias: '#64748b',
  vistaResumen: '#14b8a6',
  vistaVentas: '#a855f7',
}

const BRANCH = {
  main: '#71717a',
  fn1: '#2a78d6',
  fn2: '#eb6834',
  fn3: '#1baf7a',
  triggers: '#7a6ad8',
}

/* ------------------------------- Builders ------------------------------ */

type ColOpts = Partial<Omit<Column, 'id' | 'name' | 'type'>>

const col = (id: string, name: string, type: string, o: ColOpts = {}): Column => ({
  id,
  name,
  type,
  pk: false,
  nullable: true,
  unique: false,
  autoIncrement: false,
  ...o,
})
const pk = (id: string, name: string, type = 'integer', o: ColOpts = {}): Column =>
  col(id, name, type, { pk: true, nullable: false, ...o })
const req = (id: string, name: string, type: string, o: ColOpts = {}): Column => col(id, name, type, { nullable: false, ...o })

const table = (
  id: string,
  name: string,
  color: string,
  x: number,
  y: number,
  columns: Column[],
  extra: { comment?: string; indexes?: Index[] } = {},
): Table => ({ id, name, color, columns, indexes: extra.indexes ?? [], position: { x, y }, comment: extra.comment })

const rel = (
  id: string,
  source: [string, string],
  target: [string, string],
  onDelete: Relation['onDelete'] = 'CASCADE',
  name?: string,
): Relation => ({
  id,
  name,
  sourceTableId: source[0],
  sourceColumnId: source[1],
  targetTableId: target[0],
  targetColumnId: target[1],
  cardinality: '1:N',
  onDelete,
  onUpdate: 'CASCADE',
})

const clone = <T,>(v: T): T => structuredClone(v)
const T = (s: Schema, id: string) => s.tables.find((t) => t.id === id)!
const dropCols = (t: Table, ...ids: string[]) => void (t.columns = t.columns.filter((c) => !ids.includes(c.id)))
const insertAfter = (t: Table, afterId: string, ...cols: Column[]) => {
  const i = t.columns.findIndex((c) => c.id === afterId)
  t.columns.splice(i + 1, 0, ...cols)
}

/* ----------------------------- Esquemas -------------------------------- */

// v1 main: todo en una tabla plana.
function schemaInicial(): Schema {
  return {
    dialect: 'postgresql',
    tables: [
      table(
        'tbl_pedidos',
        'pedidos',
        C.pedidos,
        80,
        80,
        [
          pk('col_ped_id', 'id', 'serial', { autoIncrement: true }),
          req('col_ped_fecha', 'fecha', 'timestamptz', { default: 'now()' }),
          req('col_ped_estado', 'estado', 'varchar(20)', { default: "'pendiente'" }),
          req('col_ped_cli_nombre', 'cliente_nombre', 'varchar(120)'),
          req('col_ped_cli_email', 'cliente_email', 'varchar(255)'),
          col('col_ped_cli_tels', 'cliente_telefonos', 'text', { comment: 'Lista separada por comas: "600111222, 911222333"' }),
          col('col_ped_direccion', 'direccion_envio', 'text'),
          req('col_ped_productos', 'productos', 'text', { comment: 'Ej.: "2x Teclado (49.90), 1x Ratón (19.90)"' }),
          req('col_ped_total', 'total', 'numeric(10,2)'),
        ],
        { comment: 'Esquema sin normalizar: grupos repetitivos y datos de cliente/producto duplicados.' },
      ),
    ],
    views: [],
    relations: [],
    enums: [],
    functions: [],
    triggers: [],
    notes: [
      {
        id: 'note_inicial',
        text: 'Punto de partida: una sola tabla. Cada flujo explora una forma normal.',
        color: '#fef3c7',
        position: { x: 420, y: 80 },
      },
    ],
  }
}

function mainMetodoPago(prev: Schema): Schema {
  const s = clone(prev)
  insertAfter(T(s, 'tbl_pedidos'), 'col_ped_total', col('col_ped_metodo_pago', 'metodo_pago', 'varchar(30)'))
  return s
}

// 1FN · paso 1: teléfonos a tabla propia (valores atómicos, sin listas).
function fn1Telefonos(prev: Schema): Schema {
  const s = clone(prev)
  dropCols(T(s, 'tbl_pedidos'), 'col_ped_cli_tels')
  s.tables.push(
    table('tbl_telefonos', 'telefonos_cliente', C.telefonos, 80, 480, [
      pk('col_tel_email', 'cliente_email', 'varchar(255)'),
      pk('col_tel_telefono', 'telefono', 'varchar(20)'),
      col('col_tel_tipo', 'tipo', 'varchar(10)', { default: "'movil'" }),
    ]),
  )
  s.notes = []
  return s
}

// 1FN · paso 2: líneas de pedido a pedido_items (PK compuesta).
function fn1Items(prev: Schema): Schema {
  const s = clone(prev)
  dropCols(T(s, 'tbl_pedidos'), 'col_ped_productos')
  s.tables.push(
    table('tbl_items', 'pedido_items', C.items, 440, 80, [
      pk('col_item_pedido', 'pedido_id', 'integer'),
      pk('col_item_prod_codigo', 'producto_codigo', 'varchar(20)'),
      req('col_item_prod_nombre', 'producto_nombre', 'varchar(120)'),
      req('col_item_prod_precio', 'producto_precio', 'numeric(10,2)'),
      col('col_item_categoria', 'categoria_nombre', 'varchar(60)'),
      req('col_item_cantidad', 'cantidad', 'integer', { default: '1' }),
    ]),
  )
  s.relations.push(rel('rel_pedido_items', ['tbl_pedidos', 'col_ped_id'], ['tbl_items', 'col_item_pedido'], 'CASCADE', 'fk_items_pedido'))
  return s
}

// 1FN · paso 3: dirección atómica.
function fn1Direccion(prev: Schema): Schema {
  const s = clone(prev)
  const p = T(s, 'tbl_pedidos')
  insertAfter(
    p,
    'col_ped_direccion',
    col('col_ped_dir_calle', 'envio_calle', 'varchar(160)'),
    col('col_ped_dir_ciudad', 'envio_ciudad', 'varchar(80)'),
    col('col_ped_dir_cp', 'envio_cp', 'varchar(10)'),
  )
  dropCols(p, 'col_ped_direccion')
  return s
}

// 2FN · paso 1: nombre/precio dependen solo de producto_codigo → tabla productos.
function fn2Productos(prev: Schema): Schema {
  const s = clone(prev)
  const items = T(s, 'tbl_items')
  dropCols(items, 'col_item_prod_nombre', 'col_item_categoria')
  const precio = items.columns.find((c) => c.id === 'col_item_prod_precio')!
  precio.name = 'precio_unitario'
  precio.comment = 'Precio en el momento de la venta (depende de la PK completa).'
  s.tables.push(
    table('tbl_productos', 'productos', C.productos, 800, 80, [
      pk('col_prod_codigo', 'codigo', 'varchar(20)'),
      req('col_prod_nombre', 'nombre', 'varchar(120)'),
      req('col_prod_precio', 'precio', 'numeric(10,2)'),
      col('col_prod_cat_nombre', 'categoria_nombre', 'varchar(60)'),
      col('col_prod_cat_desc', 'categoria_descripcion', 'text'),
    ]),
  )
  s.relations.push(
    rel('rel_producto_items', ['tbl_productos', 'col_prod_codigo'], ['tbl_items', 'col_item_prod_codigo'], 'RESTRICT', 'fk_items_producto'),
  )
  return s
}

// 2FN · paso 2: restricciones y tipos.
function fn2Restricciones(prev: Schema): Schema {
  const s = clone(prev)
  const items = T(s, 'tbl_items')
  const cant = items.columns.find((c) => c.id === 'col_item_cantidad')!
  cant.type = 'smallint'
  cant.comment = 'CHECK (cantidad > 0)'
  const prod = T(s, 'tbl_productos')
  prod.columns.find((c) => c.id === 'col_prod_nombre')!.unique = true
  const pr = prod.columns.find((c) => c.id === 'col_prod_precio')!
  pr.default = '0'
  insertAfter(prod, 'col_prod_precio', req('col_prod_activo', 'activo', 'boolean', { default: 'true' }))
  return s
}

// 3FN · paso 1: cliente_nombre depende de cliente_email (transitiva) → tabla clientes.
function fn3Clientes(prev: Schema): Schema {
  const s = clone(prev)
  const p = T(s, 'tbl_pedidos')
  dropCols(p, 'col_ped_cli_nombre', 'col_ped_cli_email')
  insertAfter(p, 'col_ped_id', req('col_ped_cliente_id', 'cliente_id', 'integer'))
  p.position = { x: 440, y: 80 }
  const items = T(s, 'tbl_items')
  items.position = { x: 800, y: 80 }
  const prod = T(s, 'tbl_productos')
  prod.position = { x: 1160, y: 80 }

  const tel = T(s, 'tbl_telefonos')
  dropCols(tel, 'col_tel_email')
  tel.columns.unshift(pk('col_tel_cliente_id', 'cliente_id', 'integer'))
  tel.position = { x: 80, y: 420 }

  s.tables.unshift(
    table('tbl_clientes', 'clientes', C.clientes, 80, 80, [
      pk('col_cli_id', 'id', 'serial', { autoIncrement: true }),
      req('col_cli_nombre', 'nombre', 'varchar(120)'),
      req('col_cli_email', 'email', 'varchar(255)', { unique: true }),
      req('col_cli_creado', 'creado_en', 'timestamptz', { default: 'now()' }),
    ]),
  )
  s.relations.push(
    rel('rel_cliente_pedidos', ['tbl_clientes', 'col_cli_id'], ['tbl_pedidos', 'col_ped_cliente_id'], 'RESTRICT', 'fk_pedidos_cliente'),
    rel('rel_cliente_telefonos', ['tbl_clientes', 'col_cli_id'], ['tbl_telefonos', 'col_tel_cliente_id'], 'CASCADE', 'fk_telefonos_cliente'),
  )
  return s
}

// 3FN · paso 2: categoria_descripcion depende de categoria_nombre → tabla categorias.
function fn3Categorias(prev: Schema): Schema {
  const s = clone(prev)
  const prod = T(s, 'tbl_productos')
  dropCols(prod, 'col_prod_cat_nombre', 'col_prod_cat_desc')
  prod.columns.push(col('col_prod_categoria_id', 'categoria_id', 'integer'))
  s.tables.push(
    table('tbl_categorias', 'categorias', C.categorias, 1160, 420, [
      pk('col_cat_id', 'id', 'serial', { autoIncrement: true }),
      req('col_cat_nombre', 'nombre', 'varchar(60)', { unique: true }),
      col('col_cat_desc', 'descripcion', 'text'),
    ]),
  )
  s.relations.push(
    rel('rel_categoria_productos', ['tbl_categorias', 'col_cat_id'], ['tbl_productos', 'col_prod_categoria_id'], 'SET NULL', 'fk_productos_categoria'),
  )
  return s
}

// 3FN · paso 3: índices en FKs y renombrado coherente.
function fn3Indices(prev: Schema): Schema {
  const s = clone(prev)
  T(s, 'tbl_pedidos').indexes.push({ id: 'idx_pedidos_cliente', name: 'idx_pedidos_cliente_id', columnIds: ['col_ped_cliente_id'], unique: false })
  T(s, 'tbl_items').indexes.push({ id: 'idx_items_producto', name: 'idx_pedido_items_producto', columnIds: ['col_item_prod_codigo'], unique: false })
  T(s, 'tbl_productos').indexes.push({ id: 'idx_productos_categoria', name: 'idx_productos_categoria_id', columnIds: ['col_prod_categoria_id'], unique: false })
  T(s, 'tbl_pedidos').indexes.push({ id: 'idx_pedidos_fecha', name: 'idx_pedidos_fecha', columnIds: ['col_ped_fecha'], unique: false })
  const tel = T(s, 'tbl_telefonos')
  tel.name = 'cliente_telefonos'
  tel.indexes.push({ id: 'idx_telefonos_numero', name: 'idx_cliente_telefonos_telefono', columnIds: ['col_tel_telefono'], unique: false })
  return s
}

// 3FN · paso 4: vista de consulta sobre el modelo normalizado.
function fn3VistaResumen(prev: Schema): Schema {
  const s = clone(prev)
  const view: View = {
    id: 'view_resumen_pedidos_cliente',
    name: 'v_resumen_pedidos_cliente',
    materialized: false,
    color: C.vistaResumen,
    comment: 'Total gastado y nº de pedidos por cliente (recupera la vista "plana" sin desnormalizar).',
    sourceIds: ['tbl_clientes', 'tbl_pedidos'],
    columns: [
      { name: 'cliente_id', type: 'integer' },
      { name: 'nombre', type: 'varchar(120)' },
      { name: 'email', type: 'varchar(255)' },
      { name: 'num_pedidos', type: 'bigint' },
      { name: 'total_gastado', type: 'numeric' },
      { name: 'ultimo_pedido', type: 'timestamptz' },
    ],
    definition: `SELECT c.id AS cliente_id,
       c.nombre,
       c.email,
       COUNT(p.id) AS num_pedidos,
       COALESCE(SUM(p.total), 0) AS total_gastado,
       MAX(p.fecha) AS ultimo_pedido
FROM clientes c
LEFT JOIN pedidos p ON p.cliente_id = c.id
GROUP BY c.id, c.nombre, c.email`,
    position: { x: 80, y: 640 },
  }
  s.views.push(view)
  return s
}

// Triggers · paso 5: vista materializada para informes de ventas.
function trgVistaVentas(prev: Schema): Schema {
  const s = clone(prev)
  s.views.push({
    id: 'view_mv_ventas_diarias',
    name: 'mv_ventas_diarias',
    materialized: true,
    color: C.vistaVentas,
    comment: 'Se refresca cada noche: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ventas_diarias.',
    sourceIds: ['tbl_pedidos', 'tbl_items'],
    columns: [
      { name: 'dia', type: 'date' },
      { name: 'pedidos', type: 'bigint' },
      { name: 'unidades', type: 'bigint' },
      { name: 'importe', type: 'numeric' },
    ],
    definition: `SELECT date_trunc('day', p.fecha)::date AS dia,
       COUNT(DISTINCT p.id) AS pedidos,
       SUM(i.cantidad) AS unidades,
       SUM(i.cantidad * i.precio_unitario) AS importe
FROM pedidos p
JOIN pedido_items i ON i.pedido_id = p.id
GROUP BY 1`,
    position: { x: 1520, y: 80 },
  })
  return s
}

const FN_AUDITORIA: DbFunction = {
  id: 'fn_registrar_auditoria',
  name: 'registrar_auditoria',
  language: 'plpgsql',
  args: '',
  returns: 'trigger',
  comment: 'Registra en auditoria cada INSERT/UPDATE/DELETE con la fila anterior y la nueva en JSONB.',
  position: { x: 800, y: 560 },
  body: `BEGIN
  INSERT INTO auditoria (tabla, operacion, registro_id, datos_anteriores, datos_nuevos, usuario)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(NEW.id, OLD.id)::text,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    current_user
  );
  RETURN COALESCE(NEW, OLD);
END;`,
}

const FN_TIMESTAMP: DbFunction = {
  id: 'fn_actualizar_timestamp',
  name: 'actualizar_timestamp',
  language: 'plpgsql',
  args: '',
  returns: 'trigger',
  comment: 'Mantiene actualizado_en al día en cada UPDATE.',
  position: { x: 1160, y: 760 },
  body: `BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;`,
}

// Triggers · paso 1: tabla de auditoría + función.
function trgTablaAuditoria(prev: Schema): Schema {
  const s = clone(prev)
  s.tables.push(
    table(
      'tbl_auditoria',
      'auditoria',
      C.auditoria,
      440,
      520,
      [
        pk('col_aud_id', 'id', 'bigserial', { autoIncrement: true }),
        req('col_aud_tabla', 'tabla', 'varchar(63)'),
        req('col_aud_operacion', 'operacion', 'varchar(10)'),
        col('col_aud_registro', 'registro_id', 'text'),
        col('col_aud_antes', 'datos_anteriores', 'jsonb'),
        col('col_aud_despues', 'datos_nuevos', 'jsonb'),
        req('col_aud_usuario', 'usuario', 'varchar(63)', { default: 'current_user' }),
        req('col_aud_creado', 'creado_en', 'timestamptz', { default: 'now()' }),
      ],
      {
        comment: 'Bitácora append-only alimentada por registrar_auditoria().',
        indexes: [{ id: 'idx_auditoria_tabla_reg', name: 'idx_auditoria_tabla_registro', columnIds: ['col_aud_tabla', 'col_aud_registro'], unique: false }],
      },
    ),
  )
  s.functions.push(clone(FN_AUDITORIA))
  return s
}

const trg = (id: string, name: string, tableId: string, functionId: string, timing: Trigger['timing'], events: Trigger['events'], x: number, y: number, condition?: string): Trigger => ({
  id,
  name,
  tableId,
  functionId,
  timing,
  events,
  level: 'ROW',
  condition,
  position: { x, y },
})

// Triggers · paso 2: AFTER INSERT/UPDATE/DELETE en pedidos.
function trgPedidos(prev: Schema): Schema {
  const s = clone(prev)
  s.triggers.push(
    trg('trg_pedidos_aud_ins', 'pedidos_auditoria_insert', 'tbl_pedidos', 'fn_registrar_auditoria', 'AFTER', ['INSERT'], 800, 760),
    trg('trg_pedidos_aud_upd', 'pedidos_auditoria_update', 'tbl_pedidos', 'fn_registrar_auditoria', 'AFTER', ['UPDATE'], 800, 860),
    trg('trg_pedidos_aud_del', 'pedidos_auditoria_delete', 'tbl_pedidos', 'fn_registrar_auditoria', 'AFTER', ['DELETE'], 800, 960),
  )
  return s
}

// Triggers · paso 3: BEFORE UPDATE actualizar_timestamp.
function trgTimestamp(prev: Schema): Schema {
  const s = clone(prev)
  T(s, 'tbl_pedidos').columns.push(col('col_ped_actualizado', 'actualizado_en', 'timestamptz', { default: 'now()' }))
  s.functions.push(clone(FN_TIMESTAMP))
  s.triggers.push(trg('trg_pedidos_timestamp', 'pedidos_actualizar_timestamp', 'tbl_pedidos', 'fn_actualizar_timestamp', 'BEFORE', ['UPDATE'], 1160, 960))
  return s
}

// Triggers · paso 4: auditoría también en clientes (solo cambios relevantes).
function trgClientes(prev: Schema): Schema {
  const s = clone(prev)
  s.triggers.push(
    trg('trg_clientes_aud', 'clientes_auditoria', 'tbl_clientes', 'fn_registrar_auditoria', 'AFTER', ['UPDATE', 'DELETE'], 440, 960, 'OLD.email IS DISTINCT FROM NEW.email OR TG_OP = \'DELETE\''),
  )
  return s
}

// main · integración del flujo final.
function mainIntegracion(prev: Schema): Schema {
  const s = clone(prev)
  insertAfter(T(s, 'tbl_pedidos'), 'col_ped_total', col('col_ped_metodo_pago', 'metodo_pago', 'varchar(30)'))
  return s
}

/* ------------------------------ Proyecto ------------------------------- */

interface Step {
  id: string
  branchId: string
  parentId: string | null
  message: string
  author: string
  createdAt: string
  build: (prev: Schema) => Schema
}

const STEPS: Step[] = [
  { id: 'ver_main_1', branchId: 'br_main', parentId: null, message: 'Esquema inicial sin normalizar', author: 'Ana Torres', createdAt: '2026-09-01T09:30:00+02:00', build: () => schemaInicial() },
  { id: 'ver_1fn_1', branchId: 'br_1fn', parentId: 'ver_main_1', message: 'Extrae teléfonos de cliente a telefonos_cliente', author: 'Luis Gómez', createdAt: '2026-09-02T10:15:00+02:00', build: fn1Telefonos },
  { id: 'ver_main_2', branchId: 'br_main', parentId: 'ver_main_1', message: 'Añade método de pago al pedido', author: 'Ana Torres', createdAt: '2026-09-03T12:05:00+02:00', build: mainMetodoPago },
  { id: 'ver_1fn_2', branchId: 'br_1fn', parentId: 'ver_1fn_1', message: 'Separa las líneas de pedido en pedido_items', author: 'Luis Gómez', createdAt: '2026-09-03T16:40:00+02:00', build: fn1Items },
  { id: 'ver_1fn_3', branchId: 'br_1fn', parentId: 'ver_1fn_2', message: 'Dirección de envío atómica (calle, ciudad, CP)', author: 'Marta Ruiz', createdAt: '2026-09-05T11:00:00+02:00', build: fn1Direccion },
  { id: 'ver_2fn_1', branchId: 'br_2fn', parentId: 'ver_1fn_3', message: 'Mueve nombre y precio del producto a productos', author: 'Marta Ruiz', createdAt: '2026-09-08T09:45:00+02:00', build: fn2Productos },
  { id: 'ver_2fn_2', branchId: 'br_2fn', parentId: 'ver_2fn_1', message: 'Restricciones: cantidad smallint, nombre único, productos.activo', author: 'Luis Gómez', createdAt: '2026-09-10T15:20:00+02:00', build: fn2Restricciones },
  { id: 'ver_3fn_1', branchId: 'br_3fn', parentId: 'ver_2fn_2', message: 'Extrae clientes (dependencia transitiva email → nombre)', author: 'Ana Torres', createdAt: '2026-09-14T10:00:00+02:00', build: fn3Clientes },
  { id: 'ver_3fn_2', branchId: 'br_3fn', parentId: 'ver_3fn_1', message: 'Extrae categorías de productos', author: 'Ana Torres', createdAt: '2026-09-16T12:30:00+02:00', build: fn3Categorias },
  { id: 'ver_3fn_3', branchId: 'br_3fn', parentId: 'ver_3fn_2', message: 'Índices en FKs y por teléfono; renombra a cliente_telefonos', author: 'Luis Gómez', createdAt: '2026-09-17T17:05:00+02:00', build: fn3Indices },
  { id: 'ver_3fn_4', branchId: 'br_3fn', parentId: 'ver_3fn_3', message: 'Vista v_resumen_pedidos_cliente (clientes ⋈ pedidos)', author: 'Marta Ruiz', createdAt: '2026-09-19T11:40:00+02:00', build: fn3VistaResumen },
  { id: 'ver_trg_1', branchId: 'br_triggers', parentId: 'ver_3fn_4', message: 'Tabla auditoria y función registrar_auditoria()', author: 'Marta Ruiz', createdAt: '2026-09-22T09:10:00+02:00', build: trgTablaAuditoria },
  { id: 'ver_trg_2', branchId: 'br_triggers', parentId: 'ver_trg_1', message: 'Triggers AFTER INSERT/UPDATE/DELETE en pedidos', author: 'Marta Ruiz', createdAt: '2026-09-22T15:45:00+02:00', build: trgPedidos },
  { id: 'ver_trg_3', branchId: 'br_triggers', parentId: 'ver_trg_2', message: 'Trigger BEFORE UPDATE actualizar_timestamp', author: 'Luis Gómez', createdAt: '2026-09-24T11:20:00+02:00', build: trgTimestamp },
  { id: 'ver_trg_4', branchId: 'br_triggers', parentId: 'ver_trg_3', message: 'Auditoría de cambios de email y bajas de clientes', author: 'Marta Ruiz', createdAt: '2026-10-06T10:30:00+02:00', build: trgClientes },
  { id: 'ver_trg_5', branchId: 'br_triggers', parentId: 'ver_trg_4', message: 'Vista materializada mv_ventas_diarias para informes', author: 'Luis Gómez', createdAt: '2026-10-08T16:10:00+02:00', build: trgVistaVentas },
  { id: 'ver_main_3', branchId: 'br_main', parentId: 'ver_main_2', message: 'Integra flujo/triggers-auditoria (3FN + auditoría) en main', author: 'Ana Torres', createdAt: '2026-10-13T13:00:00+02:00', build: () => mainIntegracion(SCHEMA_CACHE.get('ver_trg_5')!) },
]

// Esquemas construidos encadenando los pasos (se calcula una vez; luego se clona por proyecto).
const SCHEMA_CACHE = new Map<string, Schema>()
for (const step of STEPS) {
  const prev = step.parentId ? SCHEMA_CACHE.get(step.parentId)! : schemaInicial()
  SCHEMA_CACHE.set(step.id, step.build(prev))
}

const iso = (s: string) => new Date(s).toISOString()

const BRANCHES: Branch[] = [
  { id: 'br_main', name: 'main', color: BRANCH.main, description: 'Rama principal: esquema en producción.', forkedFromVersionId: null, headVersionId: 'ver_main_3', createdAt: iso('2026-09-01T09:00:00+02:00') },
  { id: 'br_1fn', name: 'flujo/1fn', color: BRANCH.fn1, description: 'Primera forma normal: valores atómicos y sin grupos repetitivos (teléfonos, líneas de pedido, dirección).', forkedFromVersionId: 'ver_main_1', headVersionId: 'ver_1fn_3', createdAt: iso('2026-09-02T09:50:00+02:00') },
  { id: 'br_2fn', name: 'flujo/2fn', color: BRANCH.fn2, description: 'Segunda forma normal: elimina dependencias parciales de la PK compuesta de pedido_items.', forkedFromVersionId: 'ver_1fn_3', headVersionId: 'ver_2fn_2', createdAt: iso('2026-09-08T09:15:00+02:00') },
  { id: 'br_3fn', name: 'flujo/3fn', color: BRANCH.fn3, description: 'Tercera forma normal: elimina dependencias transitivas (clientes, categorías), indexa las FKs y añade una vista de resumen.', forkedFromVersionId: 'ver_2fn_2', headVersionId: 'ver_3fn_4', createdAt: iso('2026-09-14T09:20:00+02:00') },
  { id: 'br_triggers', name: 'flujo/triggers-auditoria', color: BRANCH.triggers, description: 'Auditoría con triggers plpgsql (registrar_auditoria), marca de tiempo automática y vista materializada de ventas.', forkedFromVersionId: 'ver_3fn_4', headVersionId: 'ver_trg_5', createdAt: iso('2026-09-21T18:30:00+02:00') },
]

/** Proyecto de ejemplo listo para `loadProject()`. Cada llamada devuelve una copia independiente. */
export function createSampleProject(): Project {
  const versions: Version[] = STEPS.map((s) => ({
    id: s.id,
    branchId: s.branchId,
    parentId: s.parentId,
    message: s.message,
    author: s.author,
    createdAt: iso(s.createdAt),
    schema: clone(SCHEMA_CACHE.get(s.id)!),
  }))
  return {
    id: SAMPLE_PROJECT_ID,
    name: 'tienda-online',
    dialect: 'postgresql',
    branches: clone(BRANCHES),
    versions,
    currentBranchId: 'br_main',
    connections: [],
  }
}

/* ----------------------------- Benchmarks ------------------------------ */

/** Consultas de negocio equivalentes expresadas para cada etapa del modelo. */
const Q_INICIAL = [
  { label: 'Pedidos de un cliente', query: 'SELECT * FROM pedidos WHERE cliente_email = $1' },
  { label: 'Buscar cliente por teléfono', query: "SELECT cliente_nombre FROM pedidos WHERE cliente_telefonos LIKE '%600111222%'" },
  { label: 'Ventas de un producto', query: "SELECT SUM(total) FROM pedidos WHERE productos LIKE '%Teclado%'" },
  { label: 'Insertar pedido', query: 'INSERT INTO pedidos (cliente_nombre, cliente_email, productos, total) VALUES ($1, $2, $3, $4)' },
]

const Q_1FN = [
  { label: 'Pedidos de un cliente', query: 'SELECT * FROM pedidos WHERE cliente_email = $1' },
  { label: 'Buscar cliente por teléfono', query: 'SELECT p.cliente_nombre FROM telefonos_cliente t JOIN pedidos p ON p.cliente_email = t.cliente_email WHERE t.telefono = $1' },
  { label: 'Ventas de un producto', query: 'SELECT SUM(i.cantidad * i.producto_precio) FROM pedido_items i WHERE i.producto_codigo = $1' },
  { label: 'Insertar pedido', query: 'INSERT INTO pedidos (cliente_nombre, cliente_email, total) VALUES ($1, $2, $3)' },
]

const Q_2FN = [
  Q_1FN[0],
  Q_1FN[1],
  { label: 'Ventas de un producto', query: 'SELECT pr.nombre, SUM(i.cantidad * i.precio_unitario) FROM pedido_items i JOIN productos pr ON pr.codigo = i.producto_codigo WHERE i.producto_codigo = $1' },
  Q_1FN[3],
]

const Q_3FN = (tel: string) => [
  { label: 'Pedidos de un cliente', query: 'SELECT p.* FROM clientes c JOIN pedidos p ON p.cliente_id = c.id WHERE c.email = $1' },
  { label: 'Buscar cliente por teléfono', query: `SELECT c.nombre FROM ${tel} t JOIN clientes c ON c.id = t.cliente_id WHERE t.telefono = $1` },
  { label: 'Ventas de un producto', query: 'SELECT pr.nombre, SUM(i.cantidad * i.precio_unitario) FROM pedido_items i JOIN productos pr ON pr.codigo = i.producto_codigo WHERE i.producto_codigo = $1' },
  { label: 'Insertar pedido', query: 'INSERT INTO pedidos (cliente_id, total) VALUES ($1, $2)' },
]

const QUERIES_BY_VERSION: Record<string, { label: string; query: string }[]> = {
  ver_main_1: Q_INICIAL,
  ver_main_2: Q_INICIAL,
  ver_1fn_1: [Q_INICIAL[0], Q_1FN[1], Q_INICIAL[2], Q_1FN[3]],
  ver_1fn_2: Q_1FN,
  ver_1fn_3: Q_1FN,
  ver_2fn_1: Q_2FN,
  ver_2fn_2: Q_2FN,
  ver_3fn_1: Q_3FN('telefonos_cliente'),
  ver_3fn_2: Q_3FN('telefonos_cliente'),
  ver_3fn_3: Q_3FN('cliente_telefonos'),
  ver_trg_1: Q_3FN('cliente_telefonos'),
  ver_trg_2: Q_3FN('cliente_telefonos'),
  ver_trg_3: Q_3FN('cliente_telefonos'),
  ver_3fn_4: Q_3FN('cliente_telefonos'),
  ver_trg_4: Q_3FN('cliente_telefonos'),
  ver_trg_5: Q_3FN('cliente_telefonos'),
  ver_main_3: Q_3FN('cliente_telefonos'),
}

/** Benchmarks de ejemplo (estimaciones heurísticas con `estimateQueryCost`), uno por consulta y versión. */
export const sampleBenchmarks: QueryBenchmark[] = createSampleProject().versions.flatMap((v) =>
  estimateVersionBenchmarks(v, QUERIES_BY_VERSION[v.id], { defaultRows: 50_000 }),
)
