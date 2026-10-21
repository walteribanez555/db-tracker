-- 002: clientes, categorías (jerárquicas) y productos.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE clientes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email     varchar(255) NOT NULL UNIQUE,
  nombre    varchar(120) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE clientes IS 'Clientes de la tienda';

CREATE TABLE telefonos_cliente (
  id         serial PRIMARY KEY,
  cliente_id uuid NOT NULL REFERENCES clientes (id) ON DELETE CASCADE,
  numero     varchar(30) NOT NULL,
  tipo       varchar(20) NOT NULL DEFAULT 'movil'
);

CREATE TABLE categorias (
  id       serial PRIMARY KEY,
  nombre   varchar(80) NOT NULL UNIQUE,
  padre_id int REFERENCES categorias (id) ON DELETE SET NULL
);

CREATE TABLE productos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          varchar(32) NOT NULL UNIQUE,
  nombre       varchar(160) NOT NULL,
  precio       numeric(10,2) NOT NULL CHECK (precio >= 0),
  categoria_id int REFERENCES categorias (id) ON DELETE RESTRICT
);
INSERT INTO schema_migrations VALUES ('002', 'Clientes, teléfonos, categorías y productos');
