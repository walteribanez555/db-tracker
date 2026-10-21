import type { NodeProps } from '@xyflow/react'
import { Eye } from 'lucide-react'
import { memo } from 'react'

import { Popover, PopoverAnchor } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import { AdaptivePopoverContent } from '../components/AdaptivePopoverContent'
import { ViewSqlPanel } from '../components/inline/ViewSqlPanel'
import { MAX_VIEW_ROWS, ROW_HEIGHT, TABLE_HEADER_HEIGHT, VIEW_WIDTH } from '../lib/constants'
import { startEditing, stopEditing, useEditing, useEditorUi } from '../lib/editorStore'
import { addedOutline, useFlashKey } from '../lib/changes'
import type { ViewFlowNode } from '../lib/types'
import { ChangeDot, FlashOverlay } from './ChangeMarks'
import { NodeLinkHandles } from './NodeLinkHandles'

function ViewNodeComponent({ data, selected }: NodeProps<ViewFlowNode>) {
  const { view, change } = data
  const showChanges = useEditorUi((s) => s.showChanges)
  const flashKey = useFlashKey(JSON.stringify({ ...view, position: undefined }))
  const visible = view.columns.slice(0, MAX_VIEW_ROWS)
  const hiddenCount = view.columns.length - visible.length
  const editing = useEditing('view-sql', view.id)

  return (
    <Popover open={editing !== null} onOpenChange={(open) => !open && stopEditing()}>
      <PopoverAnchor asChild>
        <div
          onDoubleClick={() => startEditing({ kind: 'view-sql', id: view.id })}
          title="Doble clic para editar el SQL"
          className={cn(
            'relative rounded-md border-[1.5px] border-dashed bg-card/95 text-card-foreground transition-colors animate-in fade-in-0 zoom-in-95 duration-200 ease-out motion-reduce:animate-none',
            selected ? 'border-brand ring-1 ring-brand' : 'border-muted-foreground/50',
            addedOutline(change),
          )}
          style={{ width: VIEW_WIDTH }}
        >
          {showChanges && <FlashOverlay flashKey={flashKey} />}
          <ChangeDot change={change === 'modified' ? change : undefined} />
          <div className="relative flex items-center gap-2 border-b border-dashed px-3" style={{ height: TABLE_HEADER_HEIGHT }}>
            <NodeLinkHandles />
            <Eye className="size-3.5 shrink-0" style={{ color: view.color }} />
            <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">{view.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{view.materialized ? 'materializada' : 'vista'}</span>
          </div>
          {view.columns.length === 0 && (
            <div className="flex items-center px-3 text-xs text-muted-foreground italic" style={{ height: ROW_HEIGHT }}>
              Sin columnas detectadas
            </div>
          )}
          {visible.map((c, i) => (
            <div key={`${c.name}-${i}`} className="flex items-center gap-2 px-3 text-xs" style={{ height: ROW_HEIGHT }}>
              <span className="min-w-0 flex-1 truncate font-mono">{c.name}</span>
              {c.type && <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-muted-foreground">{c.type}</span>}
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="flex items-center px-3 text-[11px] text-muted-foreground" style={{ height: ROW_HEIGHT }}>
              +{hiddenCount} columnas más
            </div>
          )}
        </div>
      </PopoverAnchor>
      {editing && (
        <AdaptivePopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="w-[34rem]"
          title={`Vista ${view.name}`}
          description="Nombre, SQL y detección de columnas de la vista"
          mobileLayout="full"
          onClose={stopEditing}
        >
          <ViewSqlPanel viewId={view.id} />
        </AdaptivePopoverContent>
      )}
    </Popover>
  )
}

export const ViewNode = memo(ViewNodeComponent)
