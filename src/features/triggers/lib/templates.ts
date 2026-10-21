// Plantillas de triggers habituales. Funciones puras: devuelven un esquema nuevo.
import { uid } from '@/lib/id'
import type { Column, DbFunction, Position, Schema, Table, Trigger } from '@/types/schema'

import { dependentMaterializedViews } from './graph'

export type TemplateId = 'auditoria' | 'updated-at' | 'soft-delete' | 'validacion' | 'contador' | 'refrescar-vista'

export interface TemplateResult {
  schema: Schema
  triggerId: string
  functionId: string
  /** Tablas creadas o modificadas (columnas añadidas). */
  touchedTableIds: string[]
  message: string
}

export interface TriggerTemplate {
  id: TemplateId
  name: string
  description: string
  /** Motivo por el que no se puede aplicar a la tabla, o null si se puede. */
  unavailable: (schema: Schema, tableId: string) => string | null
  apply: (schema: Schema, tableId: string, anchor: Position) => TemplateResult
}

const col = (partial: Partial<Column>): Column => ({
  id: uid('col_'),
  name: 'columna',
  type: 'text',
  pk: false,
  nullable: true,
  unique: false,
  autoIncrement: false,
  ...partial,
})

const ts = (s: Schema) => (s.dialect === 'mysql' ? 'datetime' : s.dialect === 'sqlserver' ? 'datetime2' : 'timestamptz')
const getTable = (s: Schema, id: string) => s.tables.find((t) => t.id === id)!
const pkOf = (t: Table) => t.columns.filter((c) => c.pk)
const NUMERIC = /int|numeric|decimal|real|float|double|money|serial/i

function ensureColumn(t: Table, partial: Partial<Column> & { name: string }): boolean {
  if (t.columns.some((c) => c.name === partial.name)) return false
  t.columns.push(col(partial))
  return true
}

function upsertFn(s: Schema, fn: Omit<DbFunction, 'id'>, reuse: boolean): DbFunction {
  const existing = reuse ? s.functions.find((f) => f.name === fn.name) : undefined
  if (existing) return existing
  let name = fn.name
  for (let i = 2; s.functions.some((f) => f.name === name); i++) name = `${fn.name}_${i}`
  const created = { ...fn, name, id: uid('fn_') }
  s.functions.push(created)
  return created
}

function addTrigger(s: Schema, t: Omit<Trigger, 'id' | 'name'> & { name: string }): Trigger {
  let name = t.name
  for (let i = 2; s.triggers.some((x) => x.name === name); i++) name = `${t.name}_${i}`
  const created = { ...t, name, id: uid('trg_') }
  s.triggers.push(created)
  return created
}

const at = (anchor: Position, dx: number, dy = 0) => ({ x: anchor.x + dx, y: anchor.y + dy })

/** Desplaza hacia abajo hasta encontrar hueco entre triggers/funciones. */
export function freeSpot(s: Schema, p: Position): Position {
  const nodes = [...s.triggers, ...s.functions].map((n) => n.position)
  let y = p.y
  for (let i = 0; i < 40 && nodes.some((n) => Math.abs(n.x - p.x) < 240 && Math.abs(n.y - y) < 190); i++) y += 200
  return { x: p.x, y }
}

export const TEMPLATES: TriggerTemplate[] = [
  {
    id: 'auditoria',
    name: 'Auditoría',
    description: 'Guarda cada INSERT/UPDATE/DELETE en la tabla auditoria (crea la tabla si no existe).',
    unavailable: () => null,
    apply(input, tableId, anchor) {
      const s = structuredClone(input)
      const t = getTable(s, tableId)
      const touched = [t.id]
      let audit = s.tables.find((x) => x.name === 'auditoria')
      if (!audit) {
        audit = {
          id: uid('tbl_'),
          name: 'auditoria',
          color: '#64748b',
          comment: 'Registro de cambios generado por triggers de auditoría.',
          columns: [
            col({ name: 'id', type: s.dialect === 'mysql' ? 'bigint' : 'bigserial', pk: true, nullable: false, autoIncrement: true }),
            col({ name: 'tabla', nullable: false }),
            col({ name: 'operacion', type: 'varchar(10)', nullable: false }),
            col({ name: 'datos_antes', type: s.dialect === 'mysql' ? 'json' : 'jsonb' }),
            col({ name: 'datos_despues', type: s.dialect === 'mysql' ? 'json' : 'jsonb' }),
            col({ name: 'usuario', default: 'current_user' }),
            col({ name: 'creado_en', type: ts(s), nullable: false, default: 'now()' }),
          ],
          indexes: [],
          position: { x: t.position.x + 380, y: t.position.y },
        }
        s.tables.push(audit)
        touched.push(audit.id)
      }
      const fn = upsertFn(
        s,
        {
          name: 'fn_auditoria',
          language: 'plpgsql',
          args: '',
          returns: 'trigger',
          comment: 'Auditoría genérica: sirve para cualquier tabla.',
          body: `BEGIN
  INSERT INTO auditoria (tabla, operacion, datos_antes, datos_despues)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;`,
          position: freeSpot(s, at(anchor, 620)),
        },
        true,
      )
      const trg = addTrigger(s, {
        name: `trg_${t.name}_auditoria`,
        tableId: t.id,
        functionId: fn.id,
        timing: 'AFTER',
        events: ['INSERT', 'UPDATE', 'DELETE'],
        level: 'ROW',
        position: freeSpot(s, at(anchor, 310)),
      })
      return { schema: s, triggerId: trg.id, functionId: fn.id, touchedTableIds: touched, message: `Auditoría activada en ${t.name}` }
    },
  },
  {
    id: 'updated-at',
    name: 'updated_at automático',
    description: 'Actualiza la columna updated_at en cada UPDATE (la añade si falta).',
    unavailable: () => null,
    apply(input, tableId, anchor) {
      const s = structuredClone(input)
      const t = getTable(s, tableId)
      ensureColumn(t, { name: 'updated_at', type: ts(s), nullable: false, default: 'now()' })
      const fn = upsertFn(
        s,
        {
          name: 'fn_set_updated_at',
          language: 'plpgsql',
          args: '',
          returns: 'trigger',
          body: `BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;`,
          position: freeSpot(s, at(anchor, 620)),
        },
        true,
      )
      const trg = addTrigger(s, {
        name: `trg_${t.name}_updated_at`,
        tableId: t.id,
        functionId: fn.id,
        timing: 'BEFORE',
        events: ['UPDATE'],
        level: 'ROW',
        condition: 'OLD IS DISTINCT FROM NEW',
        position: freeSpot(s, at(anchor, 310)),
      })
      return { schema: s, triggerId: trg.id, functionId: fn.id, touchedTableIds: [t.id], message: `updated_at automático en ${t.name}` }
    },
  },
  {
    id: 'soft-delete',
    name: 'Soft delete',
    description: 'Convierte el DELETE en un UPDATE de deleted_at; la fila no se borra físicamente.',
    unavailable: (s, id) => (pkOf(getTable(s, id)).length === 1 ? null : 'La tabla necesita una clave primaria simple.'),
    apply(input, tableId, anchor) {
      const s = structuredClone(input)
      const t = getTable(s, tableId)
      const pk = pkOf(t)[0]
      ensureColumn(t, { name: 'deleted_at', type: ts(s) })
      const fn = upsertFn(
        s,
        {
          name: `fn_${t.name}_soft_delete`,
          language: 'plpgsql',
          args: '',
          returns: 'trigger',
          comment: 'Devuelve NULL para cancelar el borrado físico.',
          body: `BEGIN
  UPDATE ${t.name}
     SET deleted_at = now()
   WHERE ${pk.name} = OLD.${pk.name};
  RETURN NULL; -- cancela el DELETE original
END;`,
          position: freeSpot(s, at(anchor, 620)),
        },
        false,
      )
      const trg = addTrigger(s, {
        name: `trg_${t.name}_soft_delete`,
        tableId: t.id,
        functionId: fn.id,
        timing: 'BEFORE',
        events: ['DELETE'],
        level: 'ROW',
        position: freeSpot(s, at(anchor, 310)),
      })
      return { schema: s, triggerId: trg.id, functionId: fn.id, touchedTableIds: [t.id], message: `Soft delete en ${t.name}` }
    },
  },
  {
    id: 'validacion',
    name: 'Validación',
    description: 'Rechaza filas inválidas con RAISE EXCEPTION antes de guardarlas.',
    unavailable: (s, id) => (getTable(s, id).columns.some((c) => !c.pk) ? null : 'La tabla no tiene columnas que validar.'),
    apply(input, tableId, anchor) {
      const s = structuredClone(input)
      const t = getTable(s, tableId)
      const fks = new Set(s.relations.filter((r) => r.targetTableId === t.id).map((r) => r.targetColumnId))
      const candidates = t.columns.filter((c) => !c.pk && !fks.has(c.id))
      const num = candidates.find((c) => NUMERIC.test(c.type))
      const text = candidates.find((c) => /char|text/i.test(c.type))
      const check = num
        ? `  IF NEW.${num.name} IS NULL OR NEW.${num.name} < 0 THEN
    RAISE EXCEPTION '${t.name}.${num.name} no puede ser negativo (valor: %)', NEW.${num.name};
  END IF;`
        : text
          ? `  IF NEW.${text.name} IS NULL OR btrim(NEW.${text.name}) = '' THEN
    RAISE EXCEPTION '${t.name}.${text.name} es obligatorio';
  END IF;`
          : `  -- Escribe aquí tus comprobaciones sobre NEW
  IF false THEN
    RAISE EXCEPTION 'Fila inválida en %', TG_TABLE_NAME;
  END IF;`
      const fn = upsertFn(
        s,
        {
          name: `fn_${t.name}_validar`,
          language: 'plpgsql',
          args: '',
          returns: 'trigger',
          body: `BEGIN
${check}
  RETURN NEW;
END;`,
          position: freeSpot(s, at(anchor, 620)),
        },
        false,
      )
      const trg = addTrigger(s, {
        name: `trg_${t.name}_validar`,
        tableId: t.id,
        functionId: fn.id,
        timing: 'BEFORE',
        events: ['INSERT', 'UPDATE'],
        level: 'ROW',
        position: freeSpot(s, at(anchor, 310)),
      })
      return { schema: s, triggerId: trg.id, functionId: fn.id, touchedTableIds: [t.id], message: `Validación en ${t.name}` }
    },
  },
  {
    id: 'contador',
    name: 'Contador (denormalización)',
    description: 'Mantiene en la tabla padre un contador de filas hijas (num_…) con INSERT/DELETE.',
    unavailable: (s, id) => (s.relations.some((r) => r.targetTableId === id && r.sourceTableId !== id) ? null : 'La tabla necesita una FK hacia una tabla padre.'),
    apply(input, tableId, anchor) {
      const s = structuredClone(input)
      const child = getTable(s, tableId)
      const rel = s.relations.find((r) => r.targetTableId === tableId && r.sourceTableId !== tableId)!
      const parent = getTable(s, rel.sourceTableId)
      const fk = child.columns.find((c) => c.id === rel.targetColumnId)!
      const pk = parent.columns.find((c) => c.id === rel.sourceColumnId)!
      const counter = `num_${child.name}`
      ensureColumn(parent, { name: counter, type: 'integer', nullable: false, default: '0', comment: `Contador mantenido por trigger sobre ${child.name}.` })
      const fn = upsertFn(
        s,
        {
          name: `fn_${child.name}_contador`,
          language: 'plpgsql',
          args: '',
          returns: 'trigger',
          comment: `Denormalización: ${parent.name}.${counter} = número de filas en ${child.name}.`,
          body: `BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE ${parent.name} SET ${counter} = ${counter} + 1 WHERE ${pk.name} = NEW.${fk.name};
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE ${parent.name} SET ${counter} = ${counter} - 1 WHERE ${pk.name} = OLD.${fk.name};
  END IF;
  RETURN NULL;
END;`,
          position: freeSpot(s, at(anchor, 620)),
        },
        false,
      )
      const trg = addTrigger(s, {
        name: `trg_${child.name}_contador`,
        tableId: child.id,
        functionId: fn.id,
        timing: 'AFTER',
        events: ['INSERT', 'DELETE'],
        level: 'ROW',
        position: freeSpot(s, at(anchor, 310)),
      })
      return {
        schema: s,
        triggerId: trg.id,
        functionId: fn.id,
        touchedTableIds: [child.id, parent.id],
        message: `Contador ${parent.name}.${counter} mantenido desde ${child.name}`,
      }
    },
  },
  {
    id: 'refrescar-vista',
    name: 'Refrescar vista materializada',
    description: 'Tras cada sentencia que modifique la tabla, ejecuta REFRESH MATERIALIZED VIEW de las vistas que dependen de ella.',
    unavailable: (s, id) => (dependentMaterializedViews(s, id).length ? null : 'Ninguna vista materializada lee de esta tabla.'),
    apply(input, tableId, anchor) {
      const s = structuredClone(input)
      const t = getTable(s, tableId)
      const views = dependentMaterializedViews(s, tableId)
      const main = views[0]
      const fn = upsertFn(
        s,
        {
          name: views.length === 1 ? `fn_refrescar_${main.name}` : `fn_refrescar_vistas_${t.name}`,
          language: 'plpgsql',
          args: '',
          returns: 'trigger',
          comment: 'Refresco completo: en tablas con mucha escritura valora un refresco programado o CONCURRENTLY (requiere índice único).',
          body: `BEGIN
${views.map((v) => `  REFRESH MATERIALIZED VIEW ${v.name};`).join('\n')}
  RETURN NULL;
END;`,
          position: freeSpot(s, at(anchor, 620)),
        },
        true,
      )
      const trg = addTrigger(s, {
        name: `trg_${t.name}_refrescar_vistas`,
        tableId: t.id,
        functionId: fn.id,
        timing: 'AFTER',
        events: ['INSERT', 'UPDATE', 'DELETE'],
        level: 'STATEMENT',
        position: freeSpot(s, at(anchor, 310)),
      })
      return {
        schema: s,
        triggerId: trg.id,
        functionId: fn.id,
        touchedTableIds: [t.id],
        message: `${views.map((v) => v.name).join(', ')} se refresca tras cada cambio en ${t.name}`,
      }
    },
  },
]

export const newFunction = (s: Schema, position: Position): DbFunction => {
  let i = s.functions.length + 1
  while (s.functions.some((f) => f.name === `fn_nueva_${i}`)) i++
  return {
    id: uid('fn_'),
    name: `fn_nueva_${i}`,
    language: 'plpgsql',
    args: '',
    returns: 'trigger',
    body: `BEGIN
  -- NEW: fila nueva (INSERT/UPDATE) · OLD: fila anterior (UPDATE/DELETE)
  RETURN NEW;
END;`,
    position,
  }
}

export const newTrigger = (s: Schema, tableId: string, functionId: string, position: Position): Trigger => {
  const table = s.tables.find((t) => t.id === tableId)
  const base = `trg_${table?.name ?? 'tabla'}`
  let name = base
  for (let i = 2; s.triggers.some((t) => t.name === name); i++) name = `${base}_${i}`
  return { id: uid('trg_'), name, tableId, functionId, timing: 'BEFORE', events: ['INSERT'], level: 'ROW', position }
}
