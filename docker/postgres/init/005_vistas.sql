-- 005: vista normal y vista materializada.
CREATE VIEW v_resumen_pedidos_cliente AS
SELECT c.id        AS cliente_id,
       c.nombre,
       count(p.id) AS pedidos,
       coalesce(sum(p.total), 0) AS total_gastado,
       max(p.creado_en) AS ultimo_pedido
FROM clientes c
LEFT JOIN pedidos p ON p.cliente_id = c.id AND p.estado <> 'cancelado'
GROUP BY c.id, c.nombre;

CREATE MATERIALIZED VIEW mv_ventas_diarias AS
SELECT date_trunc('day', p.creado_en)::date AS dia,
       count(DISTINCT p.id)                 AS pedidos,
       sum(i.cantidad * i.precio_unit)      AS ventas
FROM pedidos p
JOIN pedido_items i ON i.pedido_id = p.id
WHERE p.estado IN ('pagado', 'enviado')
GROUP BY 1;

CREATE UNIQUE INDEX idx_mv_ventas_diarias_dia ON mv_ventas_diarias (dia);
INSERT INTO schema_migrations VALUES ('005', 'Vista de resumen y vista materializada de ventas');
