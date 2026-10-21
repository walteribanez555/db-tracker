// Edición en línea (popover sobre el nodo) de triggers, funciones y vistas.
import { useId, type ReactNode, type SyntheticEvent } from 'react'

import { SharedCodeEditor } from '@/components/code/shared-code-editor'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { AdaptivePopoverContent } from '@/features/editor/components/AdaptivePopoverContent'
import { parseViewSources } from '@/features/normalization/lib/views'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { DbFunction, Trigger, TriggerEvent, TriggerTiming, View } from '@/types/schema'

import { EVENTS, TIMINGS } from '../lib/constants'
import { newFunction } from '../lib/templates'
import { useCanvasUi } from '../store'


/** Evita que los eventos del popover lleguen al nodo de React Flow (los portales propagan eventos React). */
const stop = (e: SyntheticEvent) => e.stopPropagation()

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

/** Envuelve un nodo con el popover de edición en línea; se abre con doble clic (estado en useCanvasUi). */
export function InlineEditor({
  kind,
  id,
  title,
  width = 'w-80',
  children,
  editor,
}: {
  kind: 'trigger' | 'function' | 'view'
  id: string
  title: string
  width?: string
  children: ReactNode
  editor: () => ReactNode
}) {
  const open = useCanvasUi((s) => s.editing?.kind === kind && s.editing.id === id)
  const setEditing = useCanvasUi((s) => s.setEditing)
  // Móvil: hoja inferior (trigger) o pantalla completa (función y vista, con editor SQL).
  const isMobile = useIsMobile()
  return (
    <Popover open={open} onOpenChange={(o) => !o && setEditing(null)}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      {open && (
        <AdaptivePopoverContent
          title={title}
          onClose={() => setEditing(null)}
          mobileLayout={kind === 'trigger' ? 'sheet' : 'full'}
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className={cn('nodrag nopan nowheel max-h-[min(80vh,640px)] overflow-y-auto', width)}
          onClick={stop}
          onDoubleClick={stop}
          onContextMenu={stop}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') setEditing(null)
          }}
          aria-label={title}
        >
          {!isMobile && <p className="text-xs text-muted-foreground">{title}</p>}
          {editor()}
          <p className="text-[11px] text-muted-foreground max-md:pt-3">
            Los cambios se guardan al momento en el borrador.{isMobile ? '' : ' Esc para cerrar.'}
          </p>
        </AdaptivePopoverContent>
      )}
    </Popover>
  )
}

export function TriggerQuickEdit({ trigger }: { trigger: Trigger }) {
  const id = useId()
  const functions = useProjectStore((s) => s.draft.functions)
  const upsertTrigger = useProjectStore((s) => s.upsertTrigger)
  const upsertFunction = useProjectStore((s) => s.upsertFunction)
  const update = (patch: Partial<Trigger>) => upsertTrigger({ ...trigger, ...patch })
  const toggle = (ev: TriggerEvent, on: boolean) =>
    update({ events: on ? EVENTS.filter((e) => e === ev || trigger.events.includes(e)) : trigger.events.filter((e) => e !== ev) })

  return (
    <div className="space-y-3">
      <Input aria-label="Nombre del trigger" className="h-8 font-mono text-sm" value={trigger.name} onChange={(e) => update({ name: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Row label="Momento" htmlFor={`${id}-t`}>
          <Select value={trigger.timing} onValueChange={(v) => update({ timing: v as TriggerTiming })}>
            <SelectTrigger id={`${id}-t`} size="sm" className="w-full">
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
        </Row>
        <Row label="Nivel" htmlFor={`${id}-l`}>
          <Select value={trigger.level} onValueChange={(v) => update({ level: v as Trigger['level'] })}>
            <SelectTrigger id={`${id}-l`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ROW">ROW</SelectItem>
              <SelectItem value="STATEMENT">STATEMENT</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">Eventos</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-xs">
              <Checkbox checked={trigger.events.includes(ev)} onCheckedChange={(c) => toggle(ev, c === true)} />
              {ev}
            </label>
          ))}
        </div>
      </fieldset>
      <Row label="Condición WHEN" htmlFor={`${id}-w`}>
        <Input
          id={`${id}-w`}
          className="h-8 font-mono text-xs"
          placeholder="OLD.estado IS DISTINCT FROM NEW.estado"
          value={trigger.condition ?? ''}
          onChange={(e) => update({ condition: e.target.value || undefined })}
        />
      </Row>
      <Row label="Función" htmlFor={`${id}-f`}>
        <Select
          value={trigger.functionId}
          onValueChange={(v) => {
            if (v !== '__new') return update({ functionId: v })
            const fn = newFunction(useProjectStore.getState().draft, { x: trigger.position.x + 320, y: trigger.position.y })
            upsertFunction(fn)
            upsertTrigger({ ...trigger, functionId: fn.id })
          }}
        >
          <SelectTrigger id={`${id}-f`} size="sm" className="w-full font-mono">
            <SelectValue placeholder="Sin función" />
          </SelectTrigger>
          <SelectContent>
            {functions.map((f) => (
              <SelectItem key={f.id} value={f.id} className="font-mono">
                {f.name}()
              </SelectItem>
            ))}
            <SelectItem value="__new">+ Nueva función</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </div>
  )
}

export function FunctionQuickEdit({ fn }: { fn: DbFunction }) {
  const id = useId()
  const draft = useProjectStore((s) => s.draft)
  const upsertFunction = useProjectStore((s) => s.upsertFunction)
  const update = (patch: Partial<DbFunction>) => upsertFunction({ ...fn, ...patch })
  return (
    <div className="space-y-3">
      <Input aria-label="Nombre de la función" className="h-8 font-mono text-sm" value={fn.name} onChange={(e) => update({ name: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Row label="Argumentos" htmlFor={`${id}-a`}>
          <Input id={`${id}-a`} className="h-8 font-mono text-xs" placeholder="(ninguno)" value={fn.args} onChange={(e) => update({ args: e.target.value })} />
        </Row>
        <Row label="Retorno" htmlFor={`${id}-r`}>
          <Input id={`${id}-r`} className="h-8 font-mono text-xs" value={fn.returns} onChange={(e) => update({ returns: e.target.value })} />
        </Row>
      </div>
      <Row label="Cuerpo" htmlFor={`${id}-b`}>
        <SharedCodeEditor
            shared={{ kind: 'function-body', id: fn.id }}
          value={fn.body}
          onChange={(body) => update({ body })}
          language="pgsql"
          height={260}
          filename={`${fn.name}.sql`}
          schema={draft}
          statusBar={false}
          ariaLabel={`Cuerpo de ${fn.name}`}
        />
      </Row>
    </div>
  )
}

export function ViewQuickEdit({ view }: { view: View }) {
  const id = useId()
  const draft = useProjectStore((s) => s.draft)
  const upsertView = useProjectStore((s) => s.upsertView)
  const update = (patch: Partial<View>) => {
    const next = { ...view, ...patch }
    if (patch.definition !== undefined) {
      // Los orígenes se recalculan del SQL para que las aristas "alimenta" sigan al día.
      const parsed = parseViewSources(patch.definition, useProjectStore.getState().draft, view.id)
      if (parsed.length) next.sourceIds = parsed
    }
    upsertView(next)
  }
  return (
    <div className="space-y-3">
      <Input aria-label="Nombre de la vista" className="h-8 font-mono text-sm" value={view.name} onChange={(e) => update({ name: e.target.value })} />
      <label className="flex items-center justify-between gap-2 text-xs" htmlFor={`${id}-m`}>
        Vista materializada
        <Switch id={`${id}-m`} checked={view.materialized} onCheckedChange={(materialized) => update({ materialized })} />
      </label>
      <Row label="Definición (SELECT)" htmlFor={`${id}-d`}>
        <SharedCodeEditor
            shared={{ kind: 'view-definition', id: view.id }}
          value={view.definition}
          onChange={(definition) => update({ definition })}
          language="pgsql"
          height={230}
          filename={`${view.name}.sql`}
          schema={draft}
          statusBar={false}
          ariaLabel={`Definición de ${view.name}`}
        />
      </Row>
    </div>
  )
}
