import { Copy, ExternalLink, Plus } from 'lucide-react'
import { useId } from 'react'
import { useNavigate } from 'react-router'

import { CodeEditor, sqlLanguageFor } from '@/components/code'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { generateFunctionSQL, generateSingleTriggerSQL } from '@/features/triggers/lib/sql'
import { newFunction } from '@/features/triggers/lib/templates'
import { useProjectStore } from '@/store/project'
import type { TriggerEvent, TriggerTiming } from '@/types/schema'

import { discrete } from '../../lib/actions'
import { copyText, updateTrigger } from '../../lib/canvasActions'
import { stopEditing } from '../../lib/editorStore'

const TIMINGS: TriggerTiming[] = ['BEFORE', 'AFTER', 'INSTEAD OF']
const EVENTS: TriggerEvent[] = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
const NEW_FN = '__new__'

/** Edición en línea de un trigger: momento, eventos, nivel, WHEN y función. */
export function TriggerEditPanel({ triggerId }: { triggerId: string }) {
  const draft = useProjectStore((s) => s.draft)
  const trigger = draft.triggers.find((t) => t.id === triggerId)
  const navigate = useNavigate()
  const id = useId()
  if (!trigger) return null
  const patch = (p: Parameters<typeof updateTrigger>[1]) => discrete(() => updateTrigger(trigger.id, p))

  const toggleEvent = (ev: TriggerEvent, on: boolean) => {
    const next = on ? [...trigger.events, ev] : trigger.events.filter((e) => e !== ev)
    patch({ events: EVENTS.filter((e) => next.includes(e)) })
  }

  const pickFunction = (value: string) => {
    if (value !== NEW_FN) return patch({ functionId: value })
    discrete(() => {
      const fn = newFunction(useProjectStore.getState().draft, { x: trigger.position.x + 320, y: trigger.position.y })
      useProjectStore.getState().upsertFunction(fn)
      updateTrigger(trigger.id, { functionId: fn.id })
    })
  }

  return (
    <div className="grid gap-3">
      <Input
        value={trigger.name}
        onChange={(e) => updateTrigger(trigger.id, { name: e.target.value })}
        aria-label="Nombre del trigger"
        className="h-7 font-mono text-xs md:text-xs max-md:h-11 max-md:text-base"
      />
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Momento</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={trigger.timing}
          onValueChange={(v) => v && patch({ timing: v as TriggerTiming })}
          className="w-full"
        >
          {TIMINGS.map((t) => (
            <ToggleGroupItem key={t} value={t} className="flex-1 font-mono text-[11px] max-md:h-10">
              {t}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Eventos</span>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-1.5 font-mono text-[11px] max-md:min-h-11 max-md:text-xs">
              <Checkbox checked={trigger.events.includes(ev)} onCheckedChange={(v) => toggleEvent(ev, v === true)} />
              {ev}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Nivel</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={trigger.level}
          onValueChange={(v) => v && patch({ level: v as 'ROW' | 'STATEMENT' })}
        >
          <ToggleGroupItem value="ROW" className="font-mono text-[11px] max-md:h-10">
            ROW
          </ToggleGroupItem>
          <ToggleGroupItem value="STATEMENT" className="font-mono text-[11px] max-md:h-10">
            STATEMENT
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-when`} className="text-xs font-normal text-muted-foreground">
          WHEN (opcional)
        </Label>
        <Input
          id={`${id}-when`}
          value={trigger.condition ?? ''}
          onChange={(e) => updateTrigger(trigger.id, { condition: e.target.value || undefined })}
          placeholder="OLD.estado IS DISTINCT FROM NEW.estado"
          className="h-7 font-mono text-xs md:text-xs max-md:h-11 max-md:text-base"
        />
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">Función</span>
        <Select value={trigger.functionId} onValueChange={pickFunction}>
          <SelectTrigger size="sm" className="w-full font-mono text-xs max-md:data-[size=sm]:h-11">
            <SelectValue placeholder="Sin función" />
          </SelectTrigger>
          <SelectContent position="popper">
            {draft.functions.map((f) => (
              <SelectItem key={f.id} value={f.id} className="font-mono text-xs">
                {f.name}()
              </SelectItem>
            ))}
            <SelectItem value={NEW_FN} className="text-xs">
              <Plus className="size-3.5" />
              Nueva función
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2.5">
        <Button variant="ghost" size="sm" className="max-md:h-11" onClick={() => navigate('/triggers')}>
          <ExternalLink />
          Abrir en Triggers
        </Button>
        <Button variant="ghost" size="sm" className="max-md:h-11" onClick={stopEditing}>
          Listo
        </Button>
      </div>
    </div>
  )
}

/** SQL del trigger (y de su función) con opción de copiar. */
export function TriggerSqlPanel({ triggerId }: { triggerId: string }) {
  const draft = useProjectStore((s) => s.draft)
  const trigger = draft.triggers.find((t) => t.id === triggerId)
  if (!trigger) return null
  const fn = draft.functions.find((f) => f.id === trigger.functionId)
  const sql = [fn ? generateFunctionSQL(fn, draft.dialect) : null, generateSingleTriggerSQL(trigger, draft, draft.dialect)]
    .filter(Boolean)
    .join('\n\n')

  return (
    <CodeEditor
      className="nokey"
      value={sql}
      readOnly
      language={sqlLanguageFor(draft.dialect)}
      filename={`${trigger.name}.sql`}
      height="auto"
      minHeight={120}
      maxHeight={420}
      statusBar
      actions={
        <Button variant="ghost" size="xs" onClick={() => copyText(sql, 'SQL copiado')}>
          <Copy />
          Copiar
        </Button>
      }
    />
  )
}
