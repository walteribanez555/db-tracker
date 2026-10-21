import { Handle, Position } from '@xyflow/react'

import { NODE_HANDLE } from '../lib/types'

const hidden = { opacity: 0, pointerEvents: 'none', width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 } as const

/** Anclas invisibles para las aristas de vistas y triggers (no permiten crear conexiones). */
export function NodeLinkHandles() {
  return (
    <>
      <Handle id={NODE_HANDLE.left} type="source" position={Position.Left} isConnectable={false} style={hidden} />
      <Handle id={NODE_HANDLE.right} type="source" position={Position.Right} isConnectable={false} style={hidden} />
    </>
  )
}
