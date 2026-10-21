import type { NodeProps } from '@xyflow/react'
import { Zap } from 'lucide-react'
import { memo } from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { TriggerEditPanel, TriggerSqlPanel } from '../components/inline/TriggerPanels'
import { TRIGGER_HEIGHT, TRIGGER_WIDTH } from '../lib/constants'
import { stopEditing, useEditing, useEditorUi } from '../lib/editorStore'
import { openTriggerFlow } from '../lib/triggerModal'
import { triggerSummary } from '../lib/triggers'
import { addedOutline, useFlashKey } from '../lib/changes'
import type { TriggerFlowNode } from '../lib/types'
import { ChangeDot, FlashOverlay } from './ChangeMarks'
import { NodeLinkHandles } from './NodeLinkHandles'

function TriggerNodeComponent({ data, selected }: NodeProps<TriggerFlowNode>) {
  const { trigger, functionName, change } = data
  const showChanges = useEditorUi((s) => s.showChanges)
  const flashKey = useFlashKey(JSON.stringify([{ ...trigger, position: undefined }, functionName]))
  const disabled = trigger.enabled === false
  const editing = useEditing('trigger', trigger.id)
  const viewingSql = useEditing('trigger-sql', trigger.id)

  return (
    <Popover open={editing !== null || viewingSql !== null} onOpenChange={(open) => !open && stopEditing()}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            'relative flex flex-col justify-center gap-0.5 rounded-md border border-dashed bg-card/95 px-3 text-card-foreground transition-colors animate-in fade-in-0 zoom-in-95 duration-200 ease-out motion-reduce:animate-none',
            selected ? 'border-brand ring-1 ring-brand' : 'border-muted-foreground/40',
            disabled && !selected && 'bg-muted/60',
            addedOutline(change),
          )}
          style={{ width: TRIGGER_WIDTH, height: TRIGGER_HEIGHT }}
          onDoubleClick={() => openTriggerFlow(trigger.id)}
          title="Doble clic para abrir el flujo del trigger"
        >
          <NodeLinkHandles />
          {showChanges && <FlashOverlay flashKey={flashKey} />}
          <ChangeDot change={change === 'modified' ? change : undefined} />
          <div className={cn('flex items-center gap-1.5 transition-opacity', disabled && 'opacity-55')}>
            <Zap className={cn('size-3.5 shrink-0', disabled ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400')} />
            <span className={cn('min-w-0 flex-1 truncate font-mono text-xs font-semibold')}>
              {trigger.name}
            </span>
            {disabled && <span className="shrink-0 text-[11px] text-muted-foreground">desactivado</span>}
          </div>
          <div className={cn('truncate pl-5 font-mono text-[11px] text-muted-foreground transition-opacity', disabled && 'opacity-55')}>
            {triggerSummary(trigger, functionName)}
          </div>
        </div>
      </PopoverAnchor>
      {(editing || viewingSql) && (
        <PopoverContent side="right" align="start" sideOffset={12} className={viewingSql ? 'w-[28rem]' : 'w-80'}>
          {viewingSql ? <TriggerSqlPanel triggerId={trigger.id} /> : <TriggerEditPanel triggerId={trigger.id} />}
        </PopoverContent>
      )}
    </Popover>
  )
}

export const TriggerNode = memo(TriggerNodeComponent)
