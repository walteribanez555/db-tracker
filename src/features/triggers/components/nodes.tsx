import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Eye, KeyRound, SquareFunction, Table2, Zap } from 'lucide-react'
import { memo, useState } from 'react'

import { cn } from '@/lib/utils'

import type { FunctionFlowNode, Highlight, TableFlowNode, TriggerFlowNode, ViewFlowNode } from '../lib/layout'
import { useCanvasUi } from '../store'
import { FunctionQuickEdit, InlineEditor, TriggerQuickEdit, ViewQuickEdit } from './QuickEdit'

/**
 * Marca de cambio en vivo: barra lateral sutil mientras difiere de la versión base y un destello
 * brand cada vez que se edita (no al montar, para no destellar todo al entrar en la vista).
 */
function LiveMarkOverlay({ changed, sig }: { changed?: boolean; sig?: string }) {
  const [first] = useState(sig)
  return (
    <>
      {changed && (
        <span aria-hidden className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand/70 transition-opacity duration-300" />
      )}
      {changed && <span className="sr-only">Cambiado desde la última versión</span>}
      {sig !== first && (
        <span
          key={sig}
          aria-hidden
          className="pointer-events-none absolute -inset-0.5 rounded-lg ring-2 ring-brand animate-out fade-out fill-mode-forwards duration-700 ease-out motion-reduce:hidden"
        />
      )}
    </>
  )
}

const handleCls = '!size-2 !min-h-0 !min-w-0 !border-0 !bg-muted-foreground/60'

function frame(selected: boolean | undefined, hl: Highlight, extra?: string) {
  return cn(
    'rounded-md border bg-card text-xs text-card-foreground transition-[box-shadow,border-color,opacity,background-color] duration-300 ease-out',
    'animate-in fade-in zoom-in-95 motion-reduce:animate-none motion-reduce:transition-none',
    selected && 'ring-2 ring-brand/60',
    hl === 'visited' && 'border-brand/50',
    hl === 'active' && 'border-brand bg-brand/5 ring-2 ring-brand/50',
    hl === 'cycle' && 'border-destructive ring-2 ring-destructive',
    hl === 'stale' && 'border-amber-500 ring-1 ring-amber-500/60',
    extra,
  )
}

export const TableNode = memo(function TableNode({ data, selected }: NodeProps<TableFlowNode>) {
  const { table, triggerCount, hl } = data
  const shown = table.columns.slice(0, 8)
  return (
    <div className={frame(selected, hl, 'w-56')}>
      <Handle type="target" position={Position.Bottom} id="written" className={handleCls} />
      <Handle type="source" position={Position.Right} id="out" className={handleCls} />
      <Handle type="source" position={Position.Right} id="feeds" style={{ top: '80%' }} className={handleCls} />
      <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: table.color }} aria-hidden />
        <Table2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{table.name}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {triggerCount ? `${triggerCount} trigger${triggerCount > 1 ? 's' : ''}` : ''}
        </span>
      </div>
      <ul className="py-1">
        {shown.map((c) => (
          <li key={c.id} className="flex items-center gap-1.5 px-2.5 py-0.5 leading-4">
            {c.pk ? <KeyRound className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-label="clave primaria" /> : <span className="w-3 shrink-0" />}
            <span className="truncate">{c.name}</span>
            <span className="ml-auto truncate pl-2 font-mono text-[10px] text-muted-foreground">{c.type}</span>
          </li>
        ))}
        {table.columns.length > shown.length && (
          <li className="px-2.5 py-0.5 text-[10px] text-muted-foreground">+{table.columns.length - shown.length} columnas más</li>
        )}
      </ul>
    </div>
  )
})

export const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps<TriggerFlowNode>) {
  const { trigger, hl, changed, sig } = data
  const simOff = useCanvasUi((s) => s.disabledTriggers.includes(trigger.id))
  const dbOff = trigger.enabled === false
  const off = simOff || dbOff
  return (
    <InlineEditor kind="trigger" id={trigger.id} title={`Trigger ${trigger.name}`} editor={() => <TriggerQuickEdit trigger={trigger} />}>
      <div className={frame(selected, hl, cn('relative w-60', off && 'border-dashed opacity-60'))}>
        <LiveMarkOverlay changed={changed} sig={sig} />
        <Handle type="target" position={Position.Left} id="in" className={handleCls} />
        <Handle type="source" position={Position.Right} id="out" className={handleCls} />
        <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
          <Zap className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span className="truncate font-mono font-medium">{trigger.name}</span>
        </div>
        <div className="space-y-0.5 px-2.5 py-1.5">
          <p>
            <span className="font-medium">{trigger.timing}</span>
            <span className="text-muted-foreground"> · </span>
            {trigger.events.length ? trigger.events.join(', ') : <span className="text-destructive">sin eventos</span>}
          </p>
          <p className="text-muted-foreground">{trigger.level === 'ROW' ? 'FOR EACH ROW' : 'FOR EACH STATEMENT'}</p>
          {trigger.condition?.trim() && (
            <p className="truncate font-mono text-[10px] text-muted-foreground" title={trigger.condition}>
              WHEN ({trigger.condition})
            </p>
          )}
          {dbOff && <p className="text-[10px] font-medium text-muted-foreground">desactivado</p>}
        {simOff && !dbOff && <p className="text-[10px] text-muted-foreground">desactivado en la simulación</p>}
        </div>
      </div>
    </InlineEditor>
  )
})

export const FunctionNode = memo(function FunctionNode({ data, selected }: NodeProps<FunctionFlowNode>) {
  const { fn, writes, refreshes, usedBy, hl, changed, sig } = data
  const lines = fn.body.split('\n').slice(0, 4)
  return (
    <InlineEditor kind="function" id={fn.id} title={`Función ${fn.name}()`} width="w-[30rem]" editor={() => <FunctionQuickEdit fn={fn} />}>
      <div className={frame(selected, hl, 'relative w-64')}>
        <LiveMarkOverlay changed={changed} sig={sig} />
        <Handle type="target" position={Position.Left} id="in" className={handleCls} />
        <Handle type="source" position={Position.Bottom} id="writes" className={handleCls} />
        <Handle type="source" position={Position.Right} id="out" className={handleCls} />
        <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
          <SquareFunction className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
          <span className="truncate font-mono font-medium">{fn.name}()</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{usedBy ? '' : 'sin uso'}</span>
        </div>
        <p className="px-2.5 pt-1.5 text-muted-foreground">
          {fn.language} · RETURNS {fn.returns || 'trigger'}
        </p>
        <pre className="mx-2.5 my-1.5 overflow-hidden rounded-sm bg-muted/60 px-2 py-1 font-mono text-[10px] leading-4 text-muted-foreground">
          {lines.join('\n')}
          {fn.body.split('\n').length > 4 ? '\n…' : ''}
        </pre>
        {(writes.length > 0 || refreshes.length > 0) && (
          <p className="border-t px-2.5 py-1 text-[10px] text-muted-foreground">
            {writes.length > 0 && <>escribe en {writes.map((w) => `${w.tableName} (${w.event})`).join(', ')}</>}
            {writes.length > 0 && refreshes.length > 0 && ' · '}
            {refreshes.length > 0 && <>refresca {refreshes.map((v) => v.name).join(', ')}</>}
          </p>
        )}
      </div>
    </InlineEditor>
  )
})

export const ViewNode = memo(function ViewNode({ data, selected }: NodeProps<ViewFlowNode>) {
  const { view, refreshedBy, hl, changed, sig } = data
  const shown = view.columns.slice(0, 6)
  return (
    <InlineEditor kind="view" id={view.id} title={`Vista ${view.name}`} width="w-[30rem]" editor={() => <ViewQuickEdit view={view} />}>
      <div className={frame(selected, hl, 'relative w-56 border-dashed')}>
        <LiveMarkOverlay changed={changed} sig={sig} />
        <Handle type="target" position={Position.Left} id="in" className={handleCls} />
        <Handle type="target" position={Position.Bottom} id="written" className={handleCls} />
        <Handle type="source" position={Position.Right} id="out" className={handleCls} />
        <Handle type="source" position={Position.Right} id="feeds" style={{ top: '80%' }} className={handleCls} />
        <div className="flex items-center gap-2 border-b border-dashed px-2.5 py-1.5">
          <Eye className="size-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
          <span className="truncate font-medium">{view.name}</span>
        </div>
        <p className="px-2.5 pt-1.5 text-muted-foreground">{view.materialized ? 'vista materializada' : 'vista'}</p>
        <ul className="py-1">
          {shown.map((c) => (
            <li key={c.name} className="flex items-center gap-1.5 px-2.5 py-0.5 leading-4">
              <span className="truncate">{c.name}</span>
              {c.type && <span className="ml-auto truncate pl-2 font-mono text-[10px] text-muted-foreground">{c.type}</span>}
            </li>
          ))}
          {view.columns.length > shown.length && (
            <li className="px-2.5 py-0.5 text-[10px] text-muted-foreground">+{view.columns.length - shown.length} columnas más</li>
          )}
        </ul>
        {view.materialized && (
          <p className={cn('border-t border-dashed px-2.5 py-1 text-[10px]', refreshedBy.length ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400')}>
            {refreshedBy.length ? `refrescada por ${refreshedBy.join(', ')}()` : hl === 'stale' ? 'desactualizada: requiere REFRESH' : 'sin refresco automático'}
          </p>
        )}
      </div>
    </InlineEditor>
  )
})
