import { Pause, Play, RotateCcw, StepForward } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useProjectStore } from '@/store/project'

import { STEP_MS } from '../lib/constants'
import { findCycles, relationName, type DmlEvent } from '../lib/graph'
import { useSimOperation } from '../lib/simOperation'
import { useSimStore, useSimulation } from '../store'
import { SimStepList } from './SimStepList'

const EVENTS: DmlEvent[] = ['INSERT', 'UPDATE', 'DELETE']

export function Simulator() {
  const draft = useProjectStore((s) => s.draft)
  const { tableId, event, current, playing, setTarget, setCurrent, setPlaying, reset } = useSimStore()
  const sim = useSimulation()
  const steps = sim?.steps ?? []
  useSimOperation(sim, current, playing, draft)
  const listRef = useRef<HTMLOListElement>(null)

  // Tabla por defecto: la primera con triggers.
  useEffect(() => {
    if (!tableId && draft.tables.length) setTarget(draft.triggers[0]?.tableId ?? draft.tables[0].id)
  }, [tableId, draft.tables, draft.triggers, setTarget])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      const { current: c } = useSimStore.getState()
      if (c >= steps.length - 1) {
        setPlaying(false)
        return
      }
      setCurrent(c + 1)
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [playing, steps.length, setCurrent, setPlaying])

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current])

  const play = () => {
    if (current >= steps.length - 1 || current < 0) setCurrent(0)
    setPlaying(true)
  }
  const step = () => {
    setPlaying(false)
    setCurrent(Math.min(current + 1, steps.length - 1))
  }

  const triggersFired = steps.filter((s) => s.kind === 'trigger').length
  const affected = [...new Set(steps.filter((s) => s.kind === 'operation').map((s) => relationName(draft, s.tableId)))]
  const stale = [...new Set(steps.filter((s) => s.kind === 'stale-view' && s.viewId).map((s) => relationName(draft, s.viewId!)))]
  const allCycles = findCycles(draft)
  const views = draft.views ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Elige una operación y observa el orden real de ejecución: triggers BEFORE, la operación, triggers AFTER y las escrituras en cascada.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="sim-table" className="text-xs text-muted-foreground">
            Tabla
          </Label>
          <Select value={tableId ?? ''} onValueChange={(v) => setTarget(v)}>
            <SelectTrigger id="sim-table" className="w-full">
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
                  <SelectLabel>Vistas</SelectLabel>
                  {views.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground" id="sim-event">
            Operación
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={event}
            onValueChange={(v) => v && setTarget(tableId, v as DmlEvent)}
            aria-labelledby="sim-event"
            className="w-full"
          >
            {EVENTS.map((e) => (
              <ToggleGroupItem key={e} value={e} className="flex-1 text-xs">
                {e}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex gap-2">
          {playing ? (
            <Button size="sm" onClick={() => setPlaying(false)} className="flex-1">
              <Pause />
              Pausar
            </Button>
          ) : (
            <Button size="sm" onClick={play} disabled={!steps.length} className="flex-1">
              <Play />
              {current >= 0 && current < steps.length - 1 ? 'Continuar' : 'Simular'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={step} disabled={!steps.length || current >= steps.length - 1} aria-label="Siguiente paso">
            <StepForward />
          </Button>
          <Button size="sm" variant="outline" onClick={reset} disabled={current < 0} aria-label="Reiniciar">
            <RotateCcw />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {steps.length > 0 && (
          <SimStepList ref={listRef} steps={steps} current={current} keyPrefix={`${tableId}:${event}`} />
        )}
        {sim && (
          <div className="space-y-1 border-t px-4 py-3 text-xs">
            {triggersFired === 0 && <p className="text-muted-foreground">Ningún trigger se dispara con esta operación.</p>}
            <p>
              <span className="text-muted-foreground">Triggers ejecutados: </span>
              {triggersFired}
            </p>
            <p>
              <span className="text-muted-foreground">Tablas modificadas: </span>
              {affected.join(', ') || '—'}
            </p>
            {stale.length > 0 && (
              <p className="text-amber-700 dark:text-amber-400">
                <span>Vistas materializadas desactualizadas: </span>
                {stale.join(', ')}
              </p>
            )}
            {sim.cycles.length > 0 && (
              <p className="text-destructive">Esta operación entra en un ciclo: PostgreSQL la repetiría hasta agotar la pila.</p>
            )}
          </div>
        )}
        {allCycles.length > 0 && (
          <div className="border-t px-4 py-3 text-xs">
            <p className="font-medium text-destructive">Ciclos en el esquema</p>
            <ul className="mt-1 space-y-1">
              {allCycles.map((c) => (
                <li key={c.key} className="font-mono text-[11px] text-muted-foreground">
                  {c.path}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
