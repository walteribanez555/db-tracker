-- 003: pedidos con estado como enum e ítems con PK compuesta.
CREATE TYPE estado_pedido AS ENUM ('pendiente', 'pagado', 'enviado', 'cancelado');

CREATE TABLE pedidos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id     uuid NOT NULL REFERENCES clientes (id) ON DELETE RESTRICT,
  estado         estado_pedido NOT NULL DEFAULT 'pendiente',
  total          numeric(10,2) NOT NULL DEFAULT 0,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pedido_items (
  pedido_id   uuid NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES productos (id) ON DELETE RESTRICT,
  cantidad    int NOT NULL CHECK (cantidad > 0),
  precio_unit numeric(10,2) NOT NULL,
  PRIMARY KEY (pedido_id, producto_id)
);
INSERT INTO schema_migrations VALUES ('003', 'Pedidos, enum de estado e ítems');
