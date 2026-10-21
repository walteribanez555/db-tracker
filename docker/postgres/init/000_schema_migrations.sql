-- Registro de migraciones aplicadas (los scripts se ejecutan en orden alfabético al crear el contenedor).
CREATE TABLE schema_migrations (
  version     text PRIMARY KEY,
  descripcion text NOT NULL,
  aplicada_en timestamptz NOT NULL DEFAULT now()
);
