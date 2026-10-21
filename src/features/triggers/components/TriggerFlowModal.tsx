// Modal "flujo del trigger": mini flujo de solo lectura + simulación, detalles, SQL, efectos e historial.
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type NodeProps } from '@xyflow/react'
import { Copy, CopyPlus, Eye, Pause, Pencil, Play, Power, RotateCcw, SquareFunction, StepForward, Table2, Trash2, Zap } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { CodeEditor, sqlLanguageFor } from '@/components/code'
import { useTheme } from '@/components/theme/theme-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { DbFunction, Trigger } from '@/types/schema'

import { deleteTrigger, duplicateTrigger, toggleTriggerEnabled } from '../actions'
import { STEP_MS } from '../lib/constants'
import { simulate, type DmlEvent } from '../lib/graph'
import { triggerHistory } from '../lib/history'
import { stepNodeIds, useSimOperation } from '../lib/simOperation'
import { generateFunctionSQL, generateSingleTriggerSQL } from '../lib/sql'
import { buildTriggerFlow, triggerEffects, type MiniFlowNode } from '../lib/triggerFlow'
import { useCanvasUi, type TriggerModalTab } from '../store'
import { TriggerQuickEdit } from './QuickEdit'
import { SimStepList } from './SimStepList'

const EVENTS: DmlEvent[] = ['INSERT', 'UPDATE', 'DELETE']
const TAB_FADE = 'data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-200 motion-reduce:animate-none'

type Lit = 'active' | 'visited' | 'cycle' | undefined
type MiniData = MiniFlowNode['data'] & { lit?: Lit }

const KIND_ICON = { table: Table2, view: Eye, trigger: Zap, function: SquareFunction }
const KIND_COLOR = {
  table: 'text-muted-foreground',
  view: 'text-cyan-600 dark:text-cyan-400',
  trigger: 'text-amber-600 dark:text-amber-400',
  function: 'text-violet-600 dark:text-violet-400',
}

const MiniNode = memo(function MiniNode({ data }: NodeProps<MiniFlowNode>) {
  const d = data as MiniData
  const Icon = KIND_ICON[d.kind]
  return (
    <div
      className={cn(
        'w-48 rounded-md border bg-card px-2.5 py-1.5 text-xs text-card-foreground transition-[box-shadow,border-color,opacity,background-color] duration-300 ease-out',
        'animate-in fade-in zoom-in-95 motion-reduce:animate-none motion-reduce:transition-none',
        d.kind === 'view' && 'border-dashed',
        d.focus && 'border-brand ring-2 ring-brand/40',
        d.disabled && 'border-dashed opacity-55',
        d.stale && 'border-amber-500/70',
        d.lit === 'visited' && 'border-brand/50',
        d.lit === 'active' && 'border-brand bg-brand/10 ring-2 ring-brand/50',
        d.lit === 'cycle' && 'border-destructive ring-2 ring-destructive',
      )}
    >
      <Handle type="target" position={Position.Top} className="!invisible" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
      <p className="flex items-center gap-1.5">
        <Icon className={cn('size-3.5 shrink-0', KIND_COLOR[d.kind])} aria-hidden />
        <span className={cn('truncate font-medium', (d.kind === 'trigger' || d.kind === 'function') && 'font-mono')}>{d.label}</span>
      </p>
      {d.sub && <p className={cn('truncate text-[10px] text-muted-foreground', d.stale && 'text-amber-700 dark:text-amber-400')}>{d.sub}</p>}
      {d.disabled && <p className="text-[10px] font-medium text-muted-foreground">desactivado</p>}
    </div>
  )
})

const nodeTypes = { mini: MiniNode }

/**
 * Reencuadra el mini flujo cuando cambia el tamaño del contenedor (el diálogo entra con animación,
 * así que el fitView inicial se haría con tamaño 0) o cuando cambia el grafo.
 */
function FitOnResize({ target, signature }: { target: React.RefObject<HTMLDivElement | null>; signature: string }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    const el = target.current
    if (!el) return
    const fit = () => void fitView({ padding: 0.15, maxZoom: 1.1, duration: 200 })
    const ro = new ResizeObserver(() => requestAnimationFrame(fit))
    ro.observe(el)
    const t = setTimeout(fit, 220)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
  }, [fitView, target, signature])
  return null
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export interface TriggerFlowModalProps {
  triggerId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pestaña inicial (por defecto "simular"). */
  initialTab?: TriggerModalTab
  /** Se llama al duplicar, para que el contenedor muestre el trigger nuevo. */
  onSwitchTrigger?: (id: string) => void
}

/** Modal con el flujo de un trigger: se usa desde /triggers y desde el editor. */
export function TriggerFlowModal({ triggerId, open, onOpenChange, initialTab = 'simular', onSwitchTrigger }: TriggerFlowModalProps) {
  const draft = useProjectStore((s) => s.draft)
  const trigger = triggerId ? draft.triggers.find((t) => t.id === triggerId) : undefined

  // Si el trigger desaparece (eliminado, deshacer…), se cierra el modal.
  useEffect(() => {
    if (open && triggerId && !trigger) onOpenChange(false)
  }, [open, triggerId, trigger, onOpenChange])

  return (
    <Dialog open={open && !!trigger} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(720px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
        {trigger && <ModalBody key={trigger.id} trigger={trigger} initialTab={initialTab} onClose={() => onOpenChange(false)} onSwitchTrigger={onSwitchTrigger} />}
      </DialogContent>
    </Dialog>
  )
}

function ModalBody({
  trigger,
  initialTab,
  onClose,
  onSwitchTrigger,
}: {
  trigger: Trigger
  initialTab: TriggerModalTab
  onClose: () => void
  onSwitchTrigger?: (id: string) => void
}) {
  const draft = useProjectStore((s) => s.draft)
  const project = useProjectStore((s) => s.project)
  const upsertFunction = useProjectStore((s) => s.upsertFunction)
  const disabledTriggers = useCanvasUi((s) => s.disabledTriggers)
  const { resolved } = useTheme()
  const [tab, setTab] = useState<TriggerModalTab>(initialTab)
  const fn = draft.functions.find((f) => f.id === trigger.functionId)
  const table = draft.tables.find((t) => t.id === trigger.tableId) ?? (draft.views ?? []).find((v) => v.id === trigger.tableId)
  const off = trigger.enabled === false

  // --- Simulación local (además se refleja como operación en el dock).
  const [event, setEvent] = useState<DmlEvent>(() => (trigger.events.find((e) => e !== 'TRUNCATE') as DmlEvent) ?? 'INSERT')
  const [current, setCurrent] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const sim = useMemo(
    () => simulate(draft, trigger.tableId, event, { disabled: new Set(disabledTriggers) }),
    [draft, trigger.tableId, event, disabledTriggers],
  )
  const steps = sim.steps
  useSimOperation(sim, current, playing, draft)
  const listRef = useRef<HTMLOListElement>(null)
  const flowBox = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setCurrent((c) => {
        if (c >= steps.length - 1) {
          setPlaying(false)
          return c
        }
        return c + 1
      })
    }, STEP_MS)
    return () => clearInterval(timer)
  }, [playing, steps.length])

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current])

  const changeEvent = (ev: DmlEvent) => {
    setEvent(ev)
    setCurrent(-1)
    setPlaying(false)
  }
  const play = () => {
    if (current < 0 || current >= steps.length - 1) setCurrent(0)
    setPlaying(true)
  }

  // --- Mini flujo con el paso actual iluminado.
  const flow = useMemo(() => buildTriggerFlow(draft, trigger.id), [draft, trigger.id])
  const lit = useMemo(() => {
    const viewIds = new Set((draft.views ?? []).map((v) => v.id))
    const active = new Set<string>()
    const visited = new Set<string>()
    if (current >= 0 && steps[current]) stepNodeIds(steps[current], viewIds).forEach((id) => active.add(id))
    for (let i = 0; i < current && i < steps.length; i++) stepNodeIds(steps[i], viewIds).forEach((id) => visited.add(id))
    return { active, visited, cycle: current >= 0 && steps[current]?.kind === 'cycle' }
  }, [current, steps, draft.views])
  const nodes = useMemo(
    () =>
      flow.nodes.map((n) => ({
        ...n,
        data: { ...n.data, lit: lit.active.has(n.id) ? (lit.cycle ? 'cycle' : 'active') : lit.visited.has(n.id) ? 'visited' : undefined } as MiniData,
      })),
    [flow.nodes, lit],
  )
  const edges = useMemo(() => {
    if (current < 0) return flow.edges
    const on = new Set([...lit.active, ...lit.visited])
    return flow.edges.map((e) => {
      const hot = on.has(e.source) && on.has(e.target)
      return { ...e, animated: hot, style: { ...e.style, stroke: hot ? 'var(--brand)' : undefined, opacity: hot ? 1 : 0.35 } }
    })
  }, [flow.edges, lit, current])

  const sql = [fn ? generateFunctionSQL(fn) : null, generateSingleTriggerSQL(trigger, draft)].filter(Boolean).join('\n\n')
  const effects = useMemo(() => triggerEffects(draft, trigger), [draft, trigger])
  const history = useMemo(() => triggerHistory(project, trigger.id), [project, trigger.id])

  return (
    <>
      {/* Encabezado */}
      <header className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b px-5 py-3 pr-12">
        <div className="min-w-0 flex-1">
          <DialogTitle className="flex items-center gap-2 font-mono text-base">
            <Zap className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span className="truncate">{trigger.name}</span>
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-sm">
            {trigger.timing} · {trigger.events.join(', ') || 'sin eventos'} · {trigger.level === 'ROW' ? 'por fila' : 'por sentencia'} → {fn ? `${fn.name}()` : 'sin función'}
            <span className="mx-1.5">·</span>
            en {table?.name ?? '?'}
            <span className="mx-1.5">·</span>
            <span className={cn('whitespace-nowrap', off ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
              {off ? 'desactivado en la BD' : 'activo en la BD'}
            </span>
          </DialogDescription>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setTab('detalles')}>
            <Pencil />
            Editar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const id = duplicateTrigger(trigger.id)
              if (id) onSwitchTrigger?.(id)
            }}
          >
            <CopyPlus />
            Duplicar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toggleTriggerEnabled(trigger.id)}>
            <Power />
            {off ? 'Activar' : 'Desactivar'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              deleteTrigger(trigger.id)
              onClose()
            }}
          >
            <Trash2 />
            Eliminar
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Izquierda: flujo del trigger */}
        <div
          ref={flowBox}
          className="relative h-64 min-w-0 shrink-0 border-b md:h-auto md:flex-1 md:border-r md:border-b-0"
          aria-label="Flujo del trigger"
        >
          {/* Proveedor propio: el modal vive dentro del ReactFlowProvider del lienzo y no debe compartir su store. */}
          <ReactFlowProvider>
            <FitOnResize target={flowBox} signature={flow.nodes.map((n) => n.id).join()} />
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
              minZoom={0.2}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnDoubleClick={false}
              colorMode={resolved}
              style={{ backgroundColor: 'var(--canvas)' }}
              defaultEdgeOptions={{
                labelStyle: { fontSize: 10, fill: 'var(--muted-foreground)' },
                labelBgStyle: { fill: 'var(--canvas)' },
                labelBgPadding: [4, 2],
              }}
              className="[&_.react-flow__edge-path]:transition-[stroke,opacity] [&_.react-flow__edge-path]:duration-300"
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--canvas-dot)" bgColor="var(--canvas)" />
            </ReactFlow>
          </ReactFlowProvider>
          <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted-foreground">
            De arriba abajo: tabla → triggers {trigger.timing} en orden → función → efectos → cascada
          </p>
        </div>

        {/* Derecha: pestañas */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TriggerModalTab)} className="flex min-h-0 w-full flex-col gap-0 md:w-[400px] md:shrink-0">
          <div className="border-b px-3 pt-2 pb-1">
            <TabsList variant="line">
              <TabsTrigger value="simular">Simular</TabsTrigger>
              <TabsTrigger value="detalles">Detalles</TabsTrigger>
              <TabsTrigger value="sql">SQL</TabsTrigger>
              <TabsTrigger value="efectos">Efectos</TabsTrigger>
              <TabsTrigger value="historial">Historial</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="simular" className={cn('flex min-h-0 flex-col', TAB_FADE)}>
            <div className="space-y-3 border-b p-4">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={event}
                onValueChange={(v) => v && changeEvent(v as DmlEvent)}
                aria-label="Operación a simular"
                className="w-full"
              >
                {EVENTS.map((e) => (
                  <ToggleGroupItem key={e} value={e} className="flex-1 text-xs">
                    {e}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="flex gap-2">
                {playing ? (
                  <Button size="sm" className="flex-1" onClick={() => setPlaying(false)}>
                    <Pause />
                    Pausar
                  </Button>
                ) : (
                  <Button size="sm" className="flex-1" onClick={play} disabled={!steps.length}>
                    <Play />
                    {current >= 0 && current < steps.length - 1 ? 'Continuar' : 'Reproducir'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Paso a paso"
                  disabled={current >= steps.length - 1}
                  onClick={() => {
                    setPlaying(false)
                    setCurrent((c) => Math.min(c + 1, steps.length - 1))
                  }}
                >
                  <StepForward />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Reiniciar"
                  disabled={current < 0}
                  onClick={() => {
                    setPlaying(false)
                    setCurrent(-1)
                  }}
                >
                  <RotateCcw />
                </Button>
              </div>
              {!trigger.events.includes(event) && (
                <p className="text-xs text-muted-foreground">Este trigger no escucha {event}: verás lo que hacen los demás triggers de {table?.name}.</p>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SimStepList ref={listRef} steps={steps} current={current} keyPrefix={`modal:${event}`} />
              {sim.cycles.length > 0 && (
                <div className="border-t px-4 py-3 text-xs" role="alert">
                  <p className="font-medium text-destructive">Ciclo detectado</p>
                  {sim.cycles.map((c) => (
                    <p key={c.key} className="font-mono text-[11px] text-muted-foreground">
                      {c.path}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="detalles" className={cn('min-h-0 space-y-5 overflow-y-auto p-4', TAB_FADE)}>
            <TriggerQuickEdit trigger={trigger} />
            {fn && <FunctionBody fn={fn} onChange={(body) => upsertFunction({ ...fn, body })} />}
          </TabsContent>

          <TabsContent value="sql" className={cn('min-h-0 overflow-y-auto p-4', TAB_FADE)}>
            <CodeEditor
              value={sql}
              language={sqlLanguageFor('postgresql')}
              readOnly
              height="auto"
              minHeight={160}
              maxHeight={520}
              filename={`${trigger.name}.sql`}
              schema={draft}
              actions={
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    navigator.clipboard.writeText(sql).then(
                      () => toast.success('SQL copiado'),
                      () => toast.error('No se pudo copiar'),
                    )
                  }
                >
                  <Copy />
                  Copiar
                </Button>
              }
              ariaLabel={`SQL de ${trigger.name}`}
            />
          </TabsContent>

          <TabsContent value="efectos" className={cn('min-h-0 space-y-4 overflow-y-auto p-4 text-sm', TAB_FADE)}>
            <Section title="Escribe en">
              <List items={effects.writes.map((w) => `${w.event} ${w.tableName}`)} empty="No escribe en otras tablas." />
            </Section>
            <Section title="Refresca">
              <List items={effects.refreshes.map((v) => `REFRESH MATERIALIZED VIEW ${v.name}`)} empty="No refresca vistas." />
            </Section>
            <Section title="Vistas materializadas que quedan desactualizadas">
              <List items={effects.stale.map((s) => `${s.view.name} (lee de ${s.via})`)} empty="Ninguna." tone="amber" />
            </Section>
            <Section title="Triggers que dispara en cascada">
              <List
                items={effects.cascade.map((c) => `${c.trigger.name}: ${c.trigger.timing} ${c.via}${c.trigger.enabled === false ? ' (desactivado)' : ''}`)}
                empty="Ninguno."
              />
            </Section>
          </TabsContent>

          <TabsContent value="historial" className={cn('min-h-0 overflow-y-auto', TAB_FADE)}>
            {history.length ? (
              <ol className="divide-y text-sm">
                {history.map((h) => (
                  <li key={h.version.id} className="px-4 py-2.5">
                    <p className="flex items-baseline gap-2">
                      <span className={cn('font-medium', h.kind === 'eliminado' && 'text-destructive')}>{h.kind}</span>
                      <span className="min-w-0 flex-1 truncate">{h.version.message}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{h.branchName}</span> · {new Date(h.version.createdAt).toLocaleString('es')} · {h.jumps} cambio
                      {h.jumps === 1 ? '' : 's'} en la versión
                    </p>
                    {h.changes.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                        {h.changes.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Este trigger aún no aparece en ninguna versión confirmada.</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

function List({ items, empty, tone }: { items: string[]; empty: string; tone?: 'amber' }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y border-y text-xs">
      {items.map((it) => (
        <li key={it} className={cn('py-1.5 font-mono', tone === 'amber' && 'text-amber-700 dark:text-amber-400')}>
          {it}
        </li>
      ))}
    </ul>
  )
}

function FunctionBody({ fn, onChange }: { fn: DbFunction; onChange: (body: string) => void }) {
  const draft = useProjectStore((s) => s.draft)
  return (
    <Section title={`Cuerpo de ${fn.name}()`}>
      <CodeEditor
        value={fn.body}
        onChange={onChange}
        language="pgsql"
        height="auto"
        minHeight={140}
        maxHeight={360}
        filename={`${fn.name}.sql`}
        schema={draft}
        ariaLabel={`Cuerpo de ${fn.name}`}
      />
    </Section>
  )
}
