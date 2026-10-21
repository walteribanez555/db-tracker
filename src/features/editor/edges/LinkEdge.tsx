import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'
import { memo } from 'react'

import { EDGE_COLOR, HIGHLIGHT_COLOR } from '../lib/constants'
import type { LinkFlowEdge } from '../lib/types'

/** Arista discontinua sin cardinalidad: origen de una vista o trigger → tabla. */
function LinkEdgeComponent({ id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps<LinkFlowEdge>) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 8, offset: 20 })
  const active = data?.highlighted
  return (
    <BaseEdge
      id={id}
      path={path}
      interactionWidth={0}
      style={{ stroke: active ? HIGHLIGHT_COLOR : EDGE_COLOR, strokeWidth: active ? 1.75 : 1.25, strokeDasharray: '5 4', transition: 'stroke 150ms ease-out' }}
    />
  )
}

export const LinkEdge = memo(LinkEdgeComponent)
