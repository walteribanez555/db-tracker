-- 006: auditoría, updated_at automático y total del pedido mantenido por trigger.
CREATE TABLE auditoria (
  id         bigserial PRIMARY KEY,
  tabla      text NOT NULL,
  operacion  text NOT NULL,
  registro   jsonb,
  anterior   jsonb,
  usuario    text NOT NULL DEFAULT current_user,
  ocurrido_en timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION registrar_auditoria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auditoria (tabla, operacion, registro, anterior)
  VALUES (TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION actualizar_timestamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION recalcular_total_pedido() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pid uuid := COALESCE(NEW.pedido_id, OLD.pedido_id);
BEGIN
  UPDATE pedidos
     SET total = (SELECT coalesce(sum(cantidad * precio_unit), 0) FROM pedido_items WHERE pedido_id = pid)
   WHERE id = pid;
  RETURN NULL;
END;
$$;

CREATE FUNCTION refrescar_mv_ventas() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ventas_diarias;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_actualizar_timestamp
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION actualizar_timestamp();

CREATE TRIGGER trg_auditoria_pedidos
  AFTER INSERT OR UPDATE OR DELETE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

CREATE TRIGGER trg_auditoria_clientes
  AFTER UPDATE OR DELETE ON clientes
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

CREATE TRIGGER trg_recalcular_total
  AFTER INSERT OR UPDATE OR DELETE ON pedido_items
  FOR EACH ROW EXECUTE FUNCTION recalcular_total_pedido();

-- Se crea desactivado: con la carga masiva de datos refrescaría la vista miles de veces.
CREATE TRIGGER trg_refrescar_ventas
  AFTER INSERT OR UPDATE OF estado ON pedidos
  FOR EACH STATEMENT EXECUTE FUNCTION refrescar_mv_ventas();
ALTER TABLE pedidos DISABLE TRIGGER trg_refrescar_ventas;

INSERT INTO schema_migrations VALUES ('006', 'Auditoría, updated_at, total por trigger y refresco de ventas');
