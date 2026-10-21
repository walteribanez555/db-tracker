-- 001: tabla legada sin normalizar (sirve para probar el asesor de normalización).
CREATE TABLE pedidos_legacy (
  id                serial PRIMARY KEY,
  cliente_nombre    varchar(120) NOT NULL,
  cliente_email     varchar(255) NOT NULL,
  cliente_telefonos text,                -- lista separada por comas (viola 1FN)
  productos         text NOT NULL,       -- "sku:cantidad;sku:cantidad"
  categoria         varchar(80),
  total             float,               -- dinero en float
  fecha             varchar(20)          -- fecha guardada como texto
);
INSERT INTO schema_migrations VALUES ('001', 'Esquema inicial sin normalizar');
