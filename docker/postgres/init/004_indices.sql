-- 004: índices en claves foráneas y filtros frecuentes.
-- pedido_items.producto_id queda SIN índice a propósito (lo detecta el asesor).
CREATE INDEX idx_pedidos_cliente_id ON pedidos (cliente_id);
CREATE INDEX idx_pedidos_estado_creado ON pedidos (estado, creado_en DESC);
CREATE INDEX idx_productos_categoria_id ON productos (categoria_id);
CREATE INDEX idx_telefonos_cliente_id ON telefonos_cliente (cliente_id);
INSERT INTO schema_migrations VALUES ('004', 'Índices en claves foráneas');
