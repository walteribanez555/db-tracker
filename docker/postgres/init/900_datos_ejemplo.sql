-- 900: datos de ejemplo en volumen (para medir rendimiento). Valores deterministas.
SELECT setseed(0.42);

-- Triggers de fila desactivados durante la carga; se reactivan al final.
ALTER TABLE pedidos DISABLE TRIGGER trg_auditoria_pedidos;
ALTER TABLE pedido_items DISABLE TRIGGER trg_recalcular_total;

INSERT INTO categorias (nombre) VALUES ('Electrónica'), ('Hogar'), ('Deportes'), ('Libros'), ('Ropa');
INSERT INTO categorias (nombre, padre_id)
SELECT c.nombre || ' · ' || s.sub, c.id
FROM categorias c CROSS JOIN (VALUES ('Ofertas'), ('Novedades')) AS s(sub);

INSERT INTO clientes (email, nombre, creado_en)
SELECT 'cliente' || g || '@ejemplo.test', 'Cliente ' || g, now() - (random() * interval '365 days')
FROM generate_series(1, 2000) g;

INSERT INTO telefonos_cliente (cliente_id, numero, tipo)
SELECT id, '+591 7' || lpad((floor(random() * 10000000))::text, 7, '0'), (ARRAY['movil', 'casa', 'trabajo'])[1 + floor(random() * 3)::int]
FROM clientes, generate_series(1, 2) WHERE random() < 0.7;

INSERT INTO productos (sku, nombre, precio, categoria_id)
SELECT 'SKU-' || lpad(g::text, 5, '0'), 'Producto ' || g, round((5 + random() * 495)::numeric, 2), 1 + floor(random() * 15)::int
FROM generate_series(1, 500) g;

INSERT INTO pedidos (cliente_id, estado, creado_en)
SELECT (SELECT id FROM clientes OFFSET floor(random() * 2000)::int LIMIT 1),
       (ARRAY['pendiente', 'pagado', 'pagado', 'enviado', 'enviado', 'cancelado']::estado_pedido[])[1 + floor(random() * 6)::int],
       now() - (random() * interval '180 days')
FROM generate_series(1, 20000);

INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unit)
SELECT DISTINCT ON (p.id, pr.id) p.id, pr.id, 1 + floor(random() * 4)::int, pr.precio
FROM pedidos p
CROSS JOIN LATERAL (SELECT id, precio FROM productos ORDER BY random() + (p.id::text < '8')::int LIMIT (1 + floor(random() * 4)::int)) pr;

UPDATE pedidos p SET total = s.total
FROM (SELECT pedido_id, sum(cantidad * precio_unit) AS total FROM pedido_items GROUP BY pedido_id) s
WHERE s.pedido_id = p.id;

INSERT INTO pedidos_legacy (cliente_nombre, cliente_email, cliente_telefonos, productos, categoria, total, fecha)
SELECT 'Cliente ' || g, 'cliente' || g || '@ejemplo.test', '+591 70000' || g || ', +591 4000' || g,
       'SKU-00001:2;SKU-00042:1', 'Electrónica', round((20 + random() * 300)::numeric, 2), to_char(now() - g * interval '1 day', 'DD/MM/YYYY')
FROM generate_series(1, 300) g;

ALTER TABLE pedidos ENABLE TRIGGER trg_auditoria_pedidos;
ALTER TABLE pedido_items ENABLE TRIGGER trg_recalcular_total;

REFRESH MATERIALIZED VIEW mv_ventas_diarias;
ANALYZE;

INSERT INTO schema_migrations VALUES ('900', 'Datos de ejemplo');
