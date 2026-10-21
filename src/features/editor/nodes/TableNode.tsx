import { Handle, Position, useConnection, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { KeyRound, Link2, Plus } from 'lucide-react'
import { memo, useEffect, useState, type CSSProperties } from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { Column } from '@/types/schema'

import { NormalizationPanel } from '../components/inline/NormalizationPanel'
import { TypeCombobox } from '../components/TypeCombobox'
import { removeColumnFrom } from '../lib/actions'
import { addColumnInline } from '../lib/canvasActions'
import { ADD_ROW_HEIGHT, HIGHLIGHT_COLOR, ROW_HEIGHT, TABLE_HEADER_HEIGHT, TABLE_WIDTH } from '../lib/constants'
import { startEditing, stopEditing, useEditing, useEditorUi } from '../lib/editorStore'
import { addedOutline, useFlashKey, type ChangeKind } from '../lib/changes'
import type { TableFlowNode } from '../lib/types'
import { ChangeDot, FlashOverlay } from './ChangeMarks'
import { InlineInput } from './InlineInput'
import { NodeLinkHandles } from './NodeLinkHandles'

const handleStyle: CSSProperties = {
  width: 9,
  height: 9,
  minWidth: 0,
  minHeight: 0,
  background: HIGHLIGHT_COLOR,
  border: '2px solid var(--background)',
}

interface ColumnRowProps {
  tableId: string
  column: Column
  isFk: boolean
  highlighted: boolean
  showHandles: boolean
  /** Fila añadida después de montar el nodo: entra con animación. */
  isNew: boolean
  change?: ChangeKind
  showChanges: boolean
}

function ColumnRow({ tableId, column, isFk, highlighted, showHandles, isNew, change, showChanges }: ColumnRowProps) {
  const flashKey = useFlashKey(JSON.stringify(column))
  const nameEdit = useEditing('column-name', tableId)
  const typeEdit = useEditing('column-type', tableId)
  const editingName = nameEdit?.columnId === column.id
  const editingType = typeEdit?.columnId === column.id
  const updateColumn = useProjectStore((s) => s.updateColumn)

  const typeLabel = (
    <span
      role="button"
      tabIndex={-1}
      title="Clic para cambiar el tipo"
      onClick={(e) => {
        e.stopPropagation()
        startEditing({ kind: 'column-type', id: tableId, columnId: column.id })
      }}
      className={cn(
        'nodrag max-w-[45%] shrink-0 cursor-pointer truncate rounded-sm px-1 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground',
        editingType && 'bg-muted text-foreground',
      )}
    >
      {column.type}
    </span>
  )

  return (
    <div
      data-column-id={column.id}
      className={cn(
        'relative flex items-center gap-2 border-b pr-2 pl-3 text-xs transition-colors',
        isNew && 'animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out motion-reduce:animate-none',
        (highlighted || editingName) && 'bg-brand/10',
      )}
      style={{ height: ROW_HEIGHT }}
    >
      {(['l', 'r'] as const).map((side) => (
        <Handle
          key={side}
          id={`${column.id}-${side}`}
          type="source"
          position={side === 'l' ? Position.Left : Position.Right}
          style={handleStyle}
          className={cn('transition-opacity', showHandles ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100')}
        />
      ))}
      {showChanges && <FlashOverlay flashKey={flashKey} />}
      <span
        aria-label={change === 'added' ? 'columna nueva' : change === 'modified' ? 'columna modificada' : undefined}
        className={cn(
          'pointer-events-none absolute left-1 font-mono text-[10px] leading-none font-semibold text-brand transition-opacity duration-300 ease-out',
          change ? 'opacity-100' : 'opacity-0',
        )}
      >
        {change === 'modified' ? '~' : '+'}
      </span>
      <span className="flex w-3.5 shrink-0 justify-center">
        {column.pk ? <KeyRound className="size-3.5 text-amber-600 dark:text-amber-400" /> : isFk ? <Link2 className="size-3.5 text-sky-600 dark:text-sky-400" /> : null}
      </span>
      {editingName ? (
        <InlineInput
          ariaLabel="Nombre de la columna"
          initial={column.name}
          className="font-mono text-xs"
          onCancel={() => {
            if (nameEdit?.chain && /^columna_\d+$/.test(column.name)) removeColumnFrom(tableId, column.id)
            stopEditing()
          }}
          onCommit={(value, via) => {
            if (value && value !== column.name) updateColumn(tableId, column.id, { name: value })
            if (via === 'enter' && nameEdit?.chain) addColumnInline(tableId)
            else stopEditing()
          }}
        />
      ) : (
        <span
          className={cn('min-w-0 flex-1 truncate font-mono', column.pk && 'font-semibold')}
          title="Doble clic para renombrar"
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEditing({ kind: 'column-name', id: tableId, columnId: column.id })
          }}
        >
          {column.name}
          {!column.nullable && !column.pk && <span className="ml-0.5 text-muted-foreground">*</span>}
        </span>
      )}
      {editingType ? (
        <TypeCombobox
          value={column.type}
          open
          onOpenChange={(open) => !open && stopEditing()}
          onChange={(type) => updateColumn(tableId, column.id, { type })}
        >
          {typeLabel}
        </TypeCombobox>
      ) : (
        typeLabel
      )}
    </div>
  )
}

function TableNodeComponent({ id, data, selected }: NodeProps<TableFlowNode>) {
  const { table, fkColumnIds, highlightColumnIds, change, columnChanges } = data
  const showChanges = useEditorUi((s) => s.showChanges)
  const flashKey = useFlashKey(JSON.stringify([table.name, table.color, table.comment, table.indexes]))
  const connecting = useConnection((c) => c.inProgress)
  const updateNodeInternals = useUpdateNodeInternals()
  const updateTable = useProjectStore((s) => s.updateTable)
  const renaming = useEditing('table-name', table.id)
  const reviewing = useEditing('normalization', table.id)

  const [initialColumns] = useState(() => new Set(table.columns.map((c) => c.id)))
  const columnsKey = table.columns.map((c) => c.id).join('|')
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, columnsKey, updateNodeInternals])

  const showHandles = selected || connecting

  return (
    <Popover open={reviewing !== null} onOpenChange={(open) => !open && stopEditing()}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            'group/node relative rounded-md border bg-card text-card-foreground shadow-sm transition-shadow animate-in fade-in-0 zoom-in-95 duration-200 ease-out motion-reduce:animate-none',
            selected ? 'border-transparent ring-2 ring-brand' : 'hover:shadow-md',
            addedOutline(change),
          )}
          style={{ width: TABLE_WIDTH }}
        >
          {showChanges && <FlashOverlay flashKey={flashKey} />}
          <ChangeDot change={change === 'modified' ? change : undefined} />
          <div className="h-1 rounded-t-[5px]" style={{ background: table.color }} />
          <div
            className="relative flex items-center gap-2 border-b bg-muted/40 px-3"
            style={{ height: TABLE_HEADER_HEIGHT - 4 }}
            onDoubleClick={() => startEditing({ kind: 'table-name', id: table.id })}
          >
            <NodeLinkHandles />
            {renaming ? (
              <InlineInput
                ariaLabel="Nombre de la tabla"
                initial={table.name}
                className="h-6 text-sm font-semibold"
                onCancel={stopEditing}
                onCommit={(value) => {
                  if (value && value !== table.name) updateTable(table.id, { name: value })
                  stopEditing()
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" title="Doble clic para renombrar">
                {table.name}
              </span>
            )}
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{table.columns.length} col</span>
          </div>

          {table.columns.length === 0 && (
            <div className="flex items-center border-b px-3 text-xs text-muted-foreground italic" style={{ height: ROW_HEIGHT }}>
              Sin columnas
            </div>
          )}

          {table.columns.map((column) => (
            <ColumnRow
              key={column.id}
              tableId={table.id}
              column={column}
              isFk={fkColumnIds.includes(column.id)}
              highlighted={highlightColumnIds.includes(column.id)}
              showHandles={showHandles}
              isNew={!initialColumns.has(column.id)}
              change={columnChanges[column.id]}
              showChanges={showChanges}
            />
          ))}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              addColumnInline(table.id)
            }}
            className={cn(
              'nodrag flex w-full items-center gap-1.5 rounded-b-[5px] px-3 text-[11px] text-muted-foreground transition-opacity hover:bg-muted/60 hover:text-foreground',
              selected ? 'opacity-100' : 'opacity-0 group-hover/node:opacity-100 focus-visible:opacity-100',
            )}
            style={{ height: ADD_ROW_HEIGHT }}
          >
            <Plus className="size-3" />
            columna
          </button>
        </div>
      </PopoverAnchor>
      {reviewing && (
        <PopoverContent side="right" align="start" sideOffset={12} className="w-80">
          <NormalizationPanel tableId={table.id} />
        </PopoverContent>
      )}
    </Popover>
  )
}

export const TableNode = memo(TableNodeComponent)
