import { BaseEdge, EdgeLabelRenderer, Position, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { memo } from 'react'

import { EDGE_COLOR, HIGHLIGHT_COLOR } from '../lib/constants'
import { cardinalityEnds } from '../lib/relations'
import { useFlashKey } from '../lib/changes'
import { useEditorUi } from '../lib/editorStore'
import type { RelationFlowEdge } from '../lib/types'

const STROKE_TRANSITION = 'stroke 150ms ease-out, stroke-width 150ms ease-out'

interface EndProps {
  x: number
  y: number
  position: Position
  label: string
  color: string
}

function CardinalityEnd({ x, y, position, label, color }: EndProps) {
  const dir = position === Position.Left ? -1 : 1
  const many = label !== '1'
  const at = (dx: number) => x + dir * dx
  return (
    <g strokeWidth={1.5} fill="none" strokeLinecap="round" style={{ stroke: color, transition: STROKE_TRANSITION }}>
      {many ? (
        <>
          <path d={`M ${at(14)} ${y} L ${at(1)} ${y - 7} M ${at(14)} ${y} L ${at(1)} ${y + 7} M ${at(14)} ${y} L ${at(1)} ${y}`} />
          <path d={`M ${at(18)} ${y - 6} L ${at(18)} ${y + 6}`} />
        </>
      ) : (
        <path d={`M ${at(9)} ${y - 6} L ${at(9)} ${y + 6} M ${at(14)} ${y - 6} L ${at(14)} ${y + 6}`} />
      )}
      <text
        x={at(26)}
        y={y - 7}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        style={{ fill: color, stroke: 'none', transition: 'fill 150ms ease-out' }}
        className="select-none"
      >
        {label}
      </text>
    </g>
  )
}

function RelationEdgeComponent({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<RelationFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    offset: 28,
  })
  const active = selected || data?.highlighted
  const changed = Boolean(data?.change)
  const color = active || changed ? HIGHLIGHT_COLOR : EDGE_COLOR
  const showChanges = useEditorUi((s) => s.showChanges)
  const flashKey = useFlashKey(JSON.stringify(data?.relation ?? null))
  const cardinality = data?.relation.cardinality ?? '1:N'
  const [sourceLabel, targetLabel] = cardinalityEnds(cardinality)

  return (
    <>
      {showChanges && flashKey > 0 && (
        <path key={flashKey} d={path} fill="none" className="db-edge-flash" style={{ stroke: HIGHLIGHT_COLOR, strokeWidth: 8, strokeLinecap: 'round' }} />
      )}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={18}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : active ? 2 : 1.5,
          strokeDasharray: changed && !active ? '6 4' : undefined,
          transition: STROKE_TRANSITION,
        }}
      />
      <CardinalityEnd x={sourceX} y={sourceY} position={sourcePosition} label={sourceLabel} color={color} />
      <CardinalityEnd x={targetX} y={targetY} position={targetPosition} label={targetLabel} color={color} />
      {active && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute bg-background/90 px-1 font-mono text-[10px] font-medium text-brand"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data?.relation.name || cardinality}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const RelationEdge = memo(RelationEdgeComponent)
