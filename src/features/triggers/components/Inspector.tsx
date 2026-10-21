import { Eye, Play, Plus, SquareFunction, Table2, Trash2, Zap } from 'lucide-react'
import { useId, useMemo, type ReactNode } from 'react'

import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { SharedCodeEditor } from '@/components/code/shared-code-editor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useProjectStore } from '@/store/project'
import type { DbFunction, Table, Trigger, TriggerEvent, TriggerTiming, View } from '@/types/schema'

import { addTrigger, applyTemplate } from '../actions'
import { EVENTS, TIMINGS } from '../lib/constants'
import { detectRefreshes, detectWrites } from '../lib/graph'
import { dialectWarnings } from '../lib/sql'
import { newFunction } from '../lib/templates'
import { useCanvasUi, useSimStore } from '../store'


function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Heading({ icon, kind, name }: { icon: ReactNode; kind: string; name: string }) {
  return (
    <div className="border-b px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {kind}
      </p>
      <p className="truncate font-mono text-sm font-medium">{name}</p>
    </div>
  )
}

export function Inspector({ onSimulate }: { onSimulate: () => void }) {
  const draft = useProjectStore((s) => s.draft)
  const selection = useProjectStore((s) => s.selection)

  if (selection?.kind === 'trigger') {
    const t = draft.triggers.find((x) => x.id === selection.id)
    if (t) return <TriggerInspector key={t.id} trigger={t} />
  }
  if (selection?.kind === 'function') {
    const f = draft.functions.find((x) => x.id === selection.id)
    if (f) return <FunctionInspector key={f.id} fn={f} />
  }
  if (selection?.kind === 'table') {
    const t = draft.tables.find((x) => x.id === selection.id)
    if (t) return <RelationInspector key={t.id} table={t} onSimulate={onSimulate} />
  }
  if (selection?.kind === 'view') {
    const v = (draft.views ?? []).find((x) => x.id === selection.id)
    if (v) return <RelationInspector key={v.id} view={v} onSimulate={onSimulate} />
  }
  return (
    <div className="space-y-2 p-4 text-sm text-muted-foreground">
      <p>Selecciona una tabla, un trigger o una función en el lienzo para editarlo.</p>
      <p className="text-xs leading-relaxed">
        El flujo se lee de izquierda a derecha: una tabla <span className="text-foreground">dispara</span> triggers, cada trigger{' '}
        <span className="text-foreground">ejecuta</span> una función, y las líneas discontinuas muestran en qué tablas{' '}
        <span className="text-foreground">escribe</span> esa función (efectos en cascada).
      </p>
    </div>
  )
}

function TriggerInspector({ trigger }: { trigger: Trigger }) {
  const id = useId()
  const draft = useProjectStore((s) => s.draft)
  const upsertTrigger = useProjectStore((s) => s.upsertTrigger)
  const upsertFunction = useProjectStore((s) => s.upsertFunction)
  const removeTrigger = useProjectStore((s) => s.removeTrigger)
  const setSelection = useProjectStore((s) => s.setSelection)
  const update = (patch: Partial<Trigger>) => upsertTrigger({ ...trigger, ...patch })
  const warnings = useMemo(
    () => dialectWarnings({ ...draft, triggers: [trigger] }, 'postgresql').filter((w) => w.startsWith(`${trigger.name}:`)),
    [draft, trigger],
  )
  const views = draft.views ?? []
  const toggleEvent = (ev: TriggerEvent, on: boolean) =>
    update({ events: on ? EVENTS.filter((e) => e === ev || trigger.events.includes(e)) : trigger.events.filter((e) => e !== ev) })

  return (
    <div>
      <Heading icon={<Zap className="size-3.5 text-amber-600 dark:text-amber-400" />} kind="Trigger" name={trigger.name} />
      <div className="space-y-4 p-4">
        <Field label="Nombre" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} className="font-mono" value={trigger.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Tabla" htmlFor={`${id}-table`}>
          <Select value={trigger.tableId} onValueChange={(v) => update({ tableId: v })}>
            <SelectTrigger id={`${id}-table`} className="w-full">
              <SelectValue placeholder="Elige una tabla" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Tablas</SelectLabel>
                {draft.tables.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              {views.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Vistas (INSTEAD OF)</SelectLabel>
                  {views.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Función" htmlFor={`${id}-fn`}>
          <Select
            value={trigger.functionId}
            onValueChange={(v) => {
              if (v !== '__new') return update({ functionId: v })
              const fn = newFunction(draft, { x: trigger.position.x + 320, y: trigger.position.y })
              upsertFunction(fn)
              upsertTrigger({ ...trigger, functionId: fn.id })
            }}
          >
            <SelectTrigger id={`${id}-fn`} className="w-full font-mono">
              <SelectValue placeholder="Sin función" />
            </SelectTrigger>
            <SelectContent>
              {draft.functions.map((f) => (
                <SelectItem key={f.id} value={f.id} className="font-mono">
                  {f.name}()
                </SelectItem>
              ))}
              <SelectItem value="__new">+ Nueva función</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Momento" htmlFor={`${id}-timing`}>
            <Select value={trigger.timing} onValueChange={(v) => update({ timing: v as TriggerTiming })}>
              <SelectTrigger id={`${id}-timing`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMINGS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Nivel" htmlFor={`${id}-level`}>
            <Select value={trigger.level} onValueChange={(v) => update({ level: v as Trigger['level'] })}>
              <SelectTrigger id={`${id}-level`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ROW">ROW</SelectItem>
                <SelectItem value="STATEMENT">STATEMENT</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-xs text-muted-foreground">Eventos</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <Checkbox checked={trigger.events.includes(ev)} onCheckedChange={(c) => toggleEvent(ev, c === true)} />
                {ev}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center justify-between gap-2 text-sm" htmlFor={`${id}-enabled`}>
          <span>
            Activo en la BD
            {trigger.enabled === false && <span className="block text-xs text-muted-foreground">Desactivado: existe pero no se ejecuta.</span>}
          </span>
          <Switch id={`${id}-enabled`} checked={trigger.enabled !== false} onCheckedChange={(on) => update({ enabled: on })} />
        </label>
        <Field
          label="Condición WHEN (opcional)"
          htmlFor={`${id}-when`}
          hint="Expresión booleana con NEW y OLD. Si es falsa, la función no se ejecuta."
        >
          <Input
            id={`${id}-when`}
            className="font-mono text-xs"
            placeholder="OLD.estado IS DISTINCT FROM NEW.estado"
            value={trigger.condition ?? ''}
            onChange={(e) => update({ condition: e.target.value || undefined })}
          />
        </Field>
        {warnings.length > 0 && (
          <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400" role="status">
            {warnings.map((w) => (
              <li key={w}>{w.replace(`${trigger.name}: `, '')}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => useCanvasUi.getState().openFlowModal(trigger.id, 'simular')}
          >
            <Play />
            Ver flujo y simular
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              removeTrigger(trigger.id)
              setSelection(null)
            }}
          >
            <Trash2 />
            Eliminar trigger
          </Button>
        </div>
      </div>
    </div>
  )
}

function FunctionInspector({ fn }: { fn: DbFunction }) {
  const id = useId()
  const draft = useProjectStore((s) => s.draft)
  const upsertFunction = useProjectStore((s) => s.upsertFunction)
  const removeFunction = useProjectStore((s) => s.removeFunction)
  const setSelection = useProjectStore((s) => s.setSelection)
  const update = (patch: Partial<DbFunction>) => upsertFunction({ ...fn, ...patch })
  const writes = useMemo(() => detectWrites(fn, draft), [fn, draft])
  const refreshes = useMemo(() => detectRefreshes(fn, draft), [fn, draft])
  const usedBy = draft.triggers.filter((t) => t.functionId === fn.id)

  return (
    <div>
      <Heading icon={<SquareFunction className="size-3.5 text-violet-600 dark:text-violet-400" />} kind="Función" name={`${fn.name}()`} />
      <div className="space-y-4 p-4">
        <Field label="Nombre" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} className="font-mono" value={fn.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lenguaje" htmlFor={`${id}-lang`}>
            <Select value={fn.language} onValueChange={(v) => update({ language: v as DbFunction['language'] })}>
              <SelectTrigger id={`${id}-lang`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plpgsql">plpgsql</SelectItem>
                <SelectItem value="sql">sql</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Retorno" htmlFor={`${id}-ret`}>
            <Input id={`${id}-ret`} className="font-mono" value={fn.returns} onChange={(e) => update({ returns: e.target.value })} />
          </Field>
        </div>
        <Field label="Argumentos" htmlFor={`${id}-args`} hint="Las funciones de trigger no reciben argumentos declarados (usa TG_ARGV).">
          <Input id={`${id}-args`} className="font-mono" placeholder="(ninguno)" value={fn.args} onChange={(e) => update({ args: e.target.value })} />
        </Field>
        <Field
          label="Cuerpo"
          htmlFor={`${id}-body`}
          hint="Disponibles: NEW, OLD, TG_OP, TG_TABLE_NAME, TG_WHEN. En BEFORE devuelve NEW (o NULL para cancelar); en AFTER el retorno se ignora."
        >
          <SharedCodeEditor
            shared={{ kind: 'function-body', id: fn.id }}
            value={fn.body}
            onChange={(body) => update({ body })}
            language="pgsql"
            height="auto"
            minHeight={180}
            maxHeight={440}
            filename={`${fn.name}.sql`}
            schema={draft}
            lineNumbers
            ariaLabel={`Cuerpo de ${fn.name}`}
          />
        </Field>
        <Field label="Comentario" htmlFor={`${id}-comment`}>
          <Textarea id={`${id}-comment`} rows={2} value={fn.comment ?? ''} onChange={(e) => update({ comment: e.target.value || undefined })} />
        </Field>
        <CollapsibleSection title="Efectos y uso" storageKey="triggers-inspector-efectos" className="-mx-1.5 border-t pt-3">
          <dl className="space-y-2 px-1.5 pt-1 text-xs">
            <div>
              <dt className="text-muted-foreground">Escribe en</dt>
              <dd>{writes.length ? writes.map((w) => `${w.tableName} (${w.event})`).join(', ') : 'ninguna tabla'}</dd>
            </div>
            {refreshes.length > 0 && (
              <div>
                <dt className="text-muted-foreground">Refresca</dt>
                <dd>{refreshes.map((v) => v.name).join(', ')}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Usada por</dt>
              <dd className="flex flex-wrap gap-x-2">
                {usedBy.length
                  ? usedBy.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="font-mono underline-offset-2 hover:underline"
                        onClick={() => setSelection({ kind: 'trigger', id: t.id })}
                      >
                        {t.name}
                      </button>
                    ))
                  : 'ningún trigger'}
              </dd>
            </div>
          </dl>
        </CollapsibleSection>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            removeFunction(fn.id)
            setSelection(null)
          }}
        >
          <Trash2 />
          {usedBy.length ? `Eliminar función y ${usedBy.length} trigger${usedBy.length > 1 ? 's' : ''}` : 'Eliminar función'}
        </Button>
      </div>
    </div>
  )
}

const TIMING_ORDER: Record<TriggerTiming, number> = { BEFORE: 0, 'INSTEAD OF': 1, AFTER: 2 }

function RelationInspector({ table, view, onSimulate }: { table?: Table; view?: View; onSimulate: () => void }) {
  const draft = useProjectStore((s) => s.draft)
  const setSelection = useProjectStore((s) => s.setSelection)
  const setTarget = useSimStore((s) => s.setTarget)
  const relId = (table ?? view)!.id
  const name = (table ?? view)!.name
  const triggers = draft.triggers
    .filter((t) => t.tableId === relId)
    .sort((a, b) => TIMING_ORDER[a.timing] - TIMING_ORDER[b.timing] || a.name.localeCompare(b.name))
  const refreshedBy = view ? draft.functions.filter((f) => detectRefreshes(f, draft).some((v) => v.id === view.id)) : []
  const sources = view ? view.sourceIds.map((id) => draft.tables.find((t) => t.id === id) ?? (draft.views ?? []).find((v) => v.id === id)) : []

  return (
    <div>
      <Heading
        icon={view ? <Eye className="size-3.5 text-cyan-600 dark:text-cyan-400" /> : <Table2 className="size-3.5" />}
        kind={view ? (view.materialized ? 'Vista materializada' : 'Vista') : 'Tabla'}
        name={name}
      />
      <div className="space-y-4 p-4 text-sm">
        {table && (
          <p className="text-xs text-muted-foreground">
            {table.columns.length} columnas. Las columnas se editan en el Diagrama; aquí defines lo que ocurre cuando cambian sus filas.
          </p>
        )}
        {view && (
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Lee de</dt>
              <dd>{sources.map((s) => s?.name ?? '(eliminada)').join(', ') || '—'}</dd>
            </div>
            {view.materialized && (
              <div>
                <dt className="text-muted-foreground">Refresco</dt>
                <dd className={refreshedBy.length ? undefined : 'text-amber-700 dark:text-amber-400'}>
                  {refreshedBy.length
                    ? `por ${refreshedBy.map((f) => `${f.name}()`).join(', ')}`
                    : 'Sin refresco automático: sus datos se quedan congelados hasta un REFRESH manual.'}
                </dd>
              </div>
            )}
          </dl>
        )}
        <CollapsibleSection title="Triggers" meta={triggers.length} storageKey="triggers-inspector-lista" className="-mx-1.5" contentClassName="px-1.5 pt-1">
          {triggers.length ? (
            <ul className="divide-y border-y">
              {triggers.map((t, i) => (
                <li
                  key={t.id}
                  className="animate-in fade-in slide-in-from-top-1 fill-mode-both motion-reduce:animate-none"
                  style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                >
                  <button
                    type="button"
                    className="w-full py-1.5 text-left transition-colors hover:bg-muted/50"
                    onClick={() => setSelection({ kind: 'trigger', id: t.id })}
                  >
                    <span className="block font-mono text-xs">{t.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.timing} · {t.events.join(', ')} · {t.level}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Ninguno.</p>
          )}
        </CollapsibleSection>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" size="sm" onClick={() => addTrigger(relId)}>
            <Plus />
            Trigger
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTarget(relId, 'UPDATE')
              onSimulate()
            }}
          >
            <Play />
            Simular
          </Button>
          {view?.materialized && !refreshedBy.length && sources.some((s) => s && draft.tables.some((t) => t.id === s.id)) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const src = sources.find((s) => s && draft.tables.some((t) => t.id === s.id))!
                applyTemplate('refrescar-vista', src.id)
              }}
            >
              Crear trigger de refresco
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
