// Acciones de la vista de triggers que combinan el store del proyecto y el layout local.
import { toast } from 'sonner'

import { runOperation, type RunnableStep } from '@/components/operation-flow'
import { uid } from '@/lib/id'
import { useProjectStore } from '@/store/project'
import type { Position, Schema, TriggerTiming } from '@/types/schema'

import { relationName } from './lib/graph'
import { autoLayout, COL_X, involvedTableIds } from './lib/layout'
import { generateFunctionSQL, generateSingleTriggerSQL, generateViewSQL } from './lib/sql'
import { freeSpot, newFunction, newTrigger, TEMPLATES, type TemplateId } from './lib/templates'
import { useTriggerLayout } from './store'

/** Posición (en el lienzo de triggers) de una tabla o vista. */
function relPosition(schema: Schema, id: string): Position {
  const saved = useTriggerLayout.getState().tablePositions[id]
  if (saved) return saved
  return autoLayout(schema, schema.tables, schema.views ?? []).tablePos[id] ?? { x: 0, y: 0 }
}

/** Tabla o vista "en contexto" según la selección actual. */
export function contextRelationId(): string | undefined {
  const { draft, selection } = useProjectStore.getState()
  if (selection?.kind === 'table' || selection?.kind === 'view') return selection.id
  if (selection?.kind === 'trigger') return draft.triggers.find((t) => t.id === selection.id)?.tableId
  if (selection?.kind === 'function') return draft.triggers.find((t) => t.functionId === selection.id)?.tableId
  return draft.tables[0]?.id
}

/** Crea un trigger (y una función nueva si no hay una función seleccionada). `at` fija la posición en el lienzo. */
export function addTrigger(relId = contextRelationId(), at?: Position) {
  const st = useProjectStore.getState()
  const d = st.draft
  if (!relId) {
    toast.error('Primero crea una tabla en el Diagrama')
    return
  }
  const anchor = relPosition(d, relId)
  let fnId = st.selection?.kind === 'function' ? st.selection.id : undefined
  if (!fnId) {
    const fn = newFunction(d, at ? { x: at.x + 320, y: at.y } : freeSpot(d, { x: COL_X.fn, y: anchor.y }))
    st.upsertFunction(fn)
    fnId = fn.id
  }
  const trg = newTrigger(useProjectStore.getState().draft, relId, fnId, at ?? freeSpot(d, { x: COL_X.trigger, y: anchor.y }))
  st.upsertTrigger(trg)
  st.setSelection({ kind: 'trigger', id: trg.id })
}

export function addFunction(at?: Position) {
  const st = useProjectStore.getState()
  const d = st.draft
  const sel = !at && st.selection?.kind === 'trigger' ? d.triggers.find((t) => t.id === st.selection!.id) : undefined
  const fn = newFunction(d, at ?? freeSpot(d, { x: COL_X.fn, y: sel?.position.y ?? 0 }))
  st.upsertFunction(fn)
  if (sel) st.upsertTrigger({ ...sel, functionId: fn.id })
  st.setSelection({ kind: 'function', id: fn.id })
}

export function applyTemplate(id: TemplateId, tableId: string) {
  const st = useProjectStore.getState()
  const tpl = TEMPLATES.find((t) => t.id === id)
  if (!tpl) return
  const reason = tpl.unavailable(st.draft, tableId)
  if (reason) {
    toast.error(reason)
    return
  }
  const before = st.draft
  const anchor = relPosition(before, tableId)
  const result = tpl.apply(before, tableId, { x: COL_X.trigger - 310, y: anchor.y })
  const steps = templateSteps(before, result.schema, result.functionId, result.triggerId)
  void runOperation(`Plantilla ${tpl.name} · ${relationName(before, tableId)}`, steps).then((r) => {
    if (!r.ok) {
      toast.error('La plantilla no se completó', { action: { label: 'Restaurar', onClick: () => useProjectStore.getState().replaceDraft(before) } })
      return
    }
    useProjectStore.getState().setSelection({ kind: 'trigger', id: result.triggerId })
    toast.success(result.message, { action: { label: 'Deshacer', onClick: () => useProjectStore.getState().replaceDraft(before) } })
  })
}

/**
 * Convierte el resultado de una plantilla en los pasos reales que lo producen, en orden de dependencia:
 * tablas nuevas → columnas añadidas → función → trigger. Cada paso publica el cambio en el borrador.
 */
function templateSteps(before: Schema, after: Schema, functionId: string, triggerId: string): RunnableStep[] {
  const steps: RunnableStep[] = []
  const publish = (recipe: (d: Schema) => void) => () => useProjectStore.getState().mutate(recipe)

  for (const t of after.tables.filter((x) => !before.tables.some((b) => b.id === x.id)))
    steps.push({
      id: `table-${t.id}`,
      kind: 'table',
      label: 'Crear tabla',
      detail: `${t.name} (${t.columns.length} columnas)`,
      run: publish((d) => void d.tables.push(structuredClone(t))),
    })

  for (const t of after.tables) {
    const old = before.tables.find((b) => b.id === t.id)
    if (!old) continue
    for (const c of t.columns.filter((x) => !old.columns.some((o) => o.id === x.id)))
      steps.push({
        id: `col-${c.id}`,
        kind: 'column',
        label: 'Añadir columna',
        detail: `${t.name}.${c.name} ${c.type}`,
        run: publish((d) => void d.tables.find((x) => x.id === t.id)?.columns.push(structuredClone(c))),
      })
  }

  const fn = after.functions.find((f) => f.id === functionId)
  const reused = before.functions.some((f) => f.id === functionId)
  if (fn && !reused)
    steps.push({
      id: `fn-${fn.id}`,
      kind: 'function',
      label: 'Crear función',
      detail: `${fn.name}() ${fn.language}`,
      run: publish((d) => void d.functions.push(structuredClone(fn))),
    })

  const trg = after.triggers.find((t) => t.id === triggerId)
  if (trg)
    steps.push({
      id: `trg-${trg.id}`,
      kind: 'trigger',
      label: 'Crear trigger',
      detail: `${trg.name}: ${trg.timing} ${trg.events.join(', ')} ON ${relationName(after, trg.tableId)}${reused && fn ? ` · usa ${fn.name}()` : ''}`,
      run: publish((d) => void d.triggers.push(structuredClone(trg))),
    })
  return steps
}

/** Reordena el lienzo en columnas: tablas → triggers → funciones → vistas. */
export function arrangeCanvas() {
  const st = useProjectStore.getState()
  const d = st.draft
  const { onlyInvolved, setTablePositions } = useTriggerLayout.getState()
  const involved = involvedTableIds(d)
  const tables = onlyInvolved && involved.size ? d.tables.filter((t) => involved.has(t.id)) : d.tables
  const ids = new Set(tables.map((t) => t.id))
  const views = (d.views ?? []).filter((v) => !onlyInvolved || !involved.size || involved.has(v.id) || v.sourceIds.some((s) => ids.has(s)))
  const { tablePos, triggerPos, fnPos } = autoLayout(d, tables, views)
  setTablePositions(tablePos)
  st.mutate((draft) => {
    for (const t of draft.triggers) if (triggerPos[t.id]) t.position = triggerPos[t.id]
    for (const f of draft.functions) if (fnPos[f.id]) f.position = fnPos[f.id]
  })
}

export function duplicateTrigger(id: string): string | undefined {
  const st = useProjectStore.getState()
  const t = st.draft.triggers.find((x) => x.id === id)
  if (!t) return undefined
  let name = `${t.name}_copia`
  for (let i = 2; st.draft.triggers.some((x) => x.name === name); i++) name = `${t.name}_copia_${i}`
  const copy = { ...structuredClone(t), id: uid('trg_'), name, position: freeSpot(st.draft, { x: t.position.x, y: t.position.y + 200 }) }
  st.upsertTrigger(copy)
  st.setSelection({ kind: 'trigger', id: copy.id })
  toast.success(`Trigger duplicado como ${name}`)
  return copy.id
}

/** Activa o desactiva el trigger en la base de datos (`enabled`; sin valor = activo). */
export function toggleTriggerEnabled(id: string) {
  const st = useProjectStore.getState()
  const t = st.draft.triggers.find((x) => x.id === id)
  if (!t) return
  const enabled = t.enabled === false
  st.upsertTrigger({ ...t, enabled })
  toast(`${t.name} ${enabled ? 'activado' : 'desactivado'} en la BD`, {
    description: `ALTER TABLE … ${enabled ? 'ENABLE' : 'DISABLE'} TRIGGER ${t.name}`,
  })
}

export function setTriggerTiming(id: string, timing: TriggerTiming) {
  const st = useProjectStore.getState()
  const t = st.draft.triggers.find((x) => x.id === id)
  if (t) st.upsertTrigger({ ...t, timing })
}

export async function copyText(text: string, what = 'SQL') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copiado al portapapeles`)
  } catch {
    toast.error('No se pudo copiar')
  }
}

export function copyTriggerSQL(id: string) {
  const d = useProjectStore.getState().draft
  const t = d.triggers.find((x) => x.id === id)
  if (!t) return
  const fn = d.functions.find((f) => f.id === t.functionId)
  void copyText([fn ? generateFunctionSQL(fn) : null, generateSingleTriggerSQL(t, d)].filter(Boolean).join('\n\n'))
}

export function copyFunctionSQL(id: string) {
  const fn = useProjectStore.getState().draft.functions.find((f) => f.id === id)
  if (fn) void copyText(generateFunctionSQL(fn))
}

export function copyViewSQL(id: string) {
  const v = (useProjectStore.getState().draft.views ?? []).find((x) => x.id === id)
  if (v) void copyText(generateViewSQL(v))
}

export function deleteTrigger(id: string) {
  const st = useProjectStore.getState()
  const t = st.draft.triggers.find((x) => x.id === id)
  if (!t) return
  const before = st.draft
  st.removeTrigger(id)
  st.setSelection(null)
  toast(`Trigger ${t.name} eliminado`, { action: { label: 'Deshacer', onClick: () => useProjectStore.getState().replaceDraft(before) } })
}

/** Elimina la función (y los triggers que la usan) con opción de deshacer. */
export function deleteFunction(id: string) {
  const st = useProjectStore.getState()
  const fn = st.draft.functions.find((x) => x.id === id)
  if (!fn) return
  const users = st.draft.triggers.filter((t) => t.functionId === id)
  const before = st.draft
  st.setSelection(null)
  // Eliminación en cascada como operación: primero los triggers que la usan, luego la función.
  const steps: RunnableStep[] = [
    ...users.map((t) => ({
      id: `trg-${t.id}`,
      kind: 'trigger' as const,
      label: 'Eliminar trigger',
      detail: `${t.name} (${relationName(before, t.tableId)})`,
      run: () => useProjectStore.getState().removeTrigger(t.id),
    })),
    { id: `fn-${fn.id}`, kind: 'function', label: 'Eliminar función', detail: `${fn.name}()`, run: () => useProjectStore.getState().removeFunction(fn.id) },
  ]
  void runOperation(`Eliminar ${fn.name}()${users.length ? ` y ${users.length} trigger(s)` : ''}`, steps).then(() =>
    toast(users.length ? `${fn.name}() y ${users.length} trigger(s) eliminados` : `${fn.name}() eliminada`, {
      action: { label: 'Deshacer', onClick: () => useProjectStore.getState().replaceDraft(before) },
    }),
  )
}

export function deleteView(id: string) {
  const st = useProjectStore.getState()
  const v = (st.draft.views ?? []).find((x) => x.id === id)
  if (!v) return
  const before = st.draft
  st.mutate((d) => void (d.triggers = d.triggers.filter((t) => t.tableId !== id)))
  st.removeView(id)
  st.setSelection(null)
  toast(`Vista ${v.name} eliminada`, { action: { label: 'Deshacer', onClick: () => useProjectStore.getState().replaceDraft(before) } })
}

export function toggleMaterialized(id: string) {
  const st = useProjectStore.getState()
  const v = (st.draft.views ?? []).find((x) => x.id === id)
  if (v) st.upsertView({ ...v, materialized: !v.materialized })
}

/** Crea un trigger que usa una función existente, en la tabla de contexto. */
export function addTriggerForFunction(fnId: string) {
  const st = useProjectStore.getState()
  st.setSelection({ kind: 'function', id: fnId })
  addTrigger(st.draft.triggers.find((t) => t.functionId === fnId)?.tableId ?? st.draft.tables[0]?.id)
}

/**
 * Elimina el vínculo representado por una arista:
 *  - tabla → trigger o trigger → función: elimina el trigger (un trigger no existe sin tabla ni función);
 *  - función → tabla (escribe en): quita del cuerpo las sentencias que escriben en esa tabla (comentándolas);
 *  - tabla → vista: quita la tabla de los orígenes de la vista.
 */
export function deleteEdgeLink(edgeId: string) {
  const st = useProjectStore.getState()
  const [, kind, a, b] = edgeId.split(':')
  const before = st.draft
  const undo = { action: { label: 'Deshacer', onClick: () => useProjectStore.getState().replaceDraft(before) } }
  if (kind === 'fires' || kind === 'exec') {
    const t = st.draft.triggers.find((x) => x.id === a)
    if (!t) return
    st.removeTrigger(a)
    toast(`Vínculo eliminado: trigger ${t.name} borrado`, undo)
    return
  }
  if (kind === 'writes' || kind === 'refresh') {
    const fn = st.draft.functions.find((f) => f.id === a)
    const target = st.draft.tables.find((t) => t.id === b) ?? (st.draft.views ?? []).find((v) => v.id === b)
    if (!fn || !target) return
    const re =
      kind === 'writes'
        ? new RegExp(`^(\\s*)((?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:ONLY\\s+)?"?${target.name}"?\\b)`, 'gim')
        : new RegExp(`^(\\s*)(REFRESH\\s+MATERIALIZED\\s+VIEW\\s+(?:CONCURRENTLY\\s+)?"?${target.name}"?\\b)`, 'gim')
    st.upsertFunction({ ...fn, body: fn.body.replace(re, '$1-- (desvinculado) $2') })
    toast(`Se comentó en ${fn.name}() la sentencia sobre ${target.name}: revisa el cuerpo`, undo)
    return
  }
  if (kind === 'feeds') {
    const v = (st.draft.views ?? []).find((x) => x.id === b)
    if (!v) return
    st.upsertView({ ...v, sourceIds: v.sourceIds.filter((s) => s !== a) })
    toast(`${v.name} ya no lee de esa tabla (revisa su SQL)`, undo)
  }
}
