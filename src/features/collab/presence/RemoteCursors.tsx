// Capa de presencia para un lienzo de React Flow: cursores remotos, borde del color del peer sobre el nodo
// que tiene seleccionado o editando, y "Ana está editando" encima. También publica el cursor propio.
// Se monta como hijo de <ReactFlow> (usa su store para el viewport y el nodo DOM).
import { useInternalNode, useReactFlow, useStore, type ReactFlowState } from '@xyflow/react'
import { useEffect, useRef } from 'react'

import { updatePresence, useCollabStore, type AwarenessState } from '@/collab'

import { usePeersHere, type PeerHere } from '../hooks'

type Sel = { kind: string; id: string }

interface Props {
  /** Traduce una selección del awareness al id del nodo en este lienzo (null si no aparece aquí). */
  nodeIdFor?: (sel: Sel) => string | null
}

const THROTTLE_MS = 50

const selectTransform = (s: ReactFlowState) => s.transform
const selectDomNode = (s: ReactFlowState) => s.domNode

const identity = (sel: Sel) => sel.id

export function RemoteCursors({ nodeIdFor = identity }: Props) {
  const peers = usePeersHere()
  const [tx, ty, zoom] = useStore(selectTransform)
  usePublishCursor()

  if (!peers.length) return null
  // La capa interior sigue al viewport sin transición (el pan y el zoom propios son instantáneos);
  // solo el movimiento remoto de cada cursor se suaviza.
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
      <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${tx}px, ${ty}px) scale(${zoom})` }}>
        {peers.map((p) => (
          <PeerMarks key={p.key} peer={p} zoom={zoom} nodeIdFor={nodeIdFor} />
        ))}
      </div>
    </div>
  )
}

function PeerMarks({ peer, zoom, nodeIdFor }: { peer: PeerHere; zoom: number; nodeIdFor: (s: Sel) => string | null }) {
  const st: AwarenessState = peer.state
  const target = st.editing ?? st.selection
  const nodeId = target ? nodeIdFor(target) : null
  return (
    <>
      {nodeId && <NodeOutline nodeId={nodeId} color={st.user.color} label={st.editing ? `${st.user.name} está editando` : null} zoom={zoom} />}
      {st.cursor && <Cursor x={st.cursor.x} y={st.cursor.y} name={st.user.name} color={st.user.color} zoom={zoom} />}
    </>
  )
}

/** Borde del color del peer alrededor del nodo (coordenadas del flujo; grosor constante en pantalla). */
function NodeOutline({ nodeId, color, label, zoom }: { nodeId: string; color: string; label: string | null; zoom: number }) {
  const node = useInternalNode(nodeId)
  if (!node || node.hidden) return null
  const w = node.measured.width ?? 0
  const h = node.measured.height ?? 0
  if (!w || !h) return null
  const pad = 4 / zoom
  const { x, y } = node.internals.positionAbsolute
  return (
    <div className="absolute top-0 left-0" style={{ transform: `translate(${x - pad}px, ${y - pad}px)` }}>
      {label && (
        <div className="absolute bottom-full left-0 origin-bottom-left" style={{ transform: `scale(${1 / zoom})` }}>
          <div className="mb-1 text-[11px] leading-none font-medium whitespace-nowrap animate-in fade-in duration-200 motion-reduce:animate-none" style={{ color }}>
            {label}
          </div>
        </div>
      )}
      <div
        className="animate-in rounded-lg fade-in duration-200 motion-reduce:animate-none"
        style={{ width: w + pad * 2, height: h + pad * 2, border: `${2 / zoom}px solid ${color}` }}
      />
    </div>
  )
}

function Cursor({ x, y, name, color, zoom }: { x: number; y: number; name: string; color: string; zoom: number }) {
  return (
    <div
      className="absolute top-0 left-0 transition-transform duration-100 ease-linear will-change-transform motion-reduce:transition-none"
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <div className="relative origin-top-left" style={{ transform: `scale(${1 / zoom})` }}>
        <svg width="16" height="18" viewBox="0 0 16 18" className="drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)]">
          <path d="M1 1 L1 15 L5 11.5 L7.8 17 L10.2 15.8 L7.5 10.5 L13 10.5 Z" fill={color} stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
        <span className="absolute top-4 left-3 rounded px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap text-white" style={{ backgroundColor: color }}>
          {name}
        </span>
      </div>
    </div>
  )
}

/** Publica el cursor propio en coordenadas del flujo (throttle ~50 ms) mientras hay sesión. */
function usePublishCursor() {
  const domNode = useStore(selectDomNode)
  const { screenToFlowPosition } = useReactFlow()
  const toFlow = useRef(screenToFlowPosition)
  useEffect(() => {
    toFlow.current = screenToFlowPosition
  }, [screenToFlowPosition])

  useEffect(() => {
    if (!domNode) return
    let last = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending: { x: number; y: number } | null = null
    const live = () => {
      const s = useCollabStore.getState().status
      return s === 'connected' || s === 'reconnecting'
    }
    const flush = () => {
      timer = null
      if (!pending) return
      last = performance.now()
      const p = toFlow.current(pending)
      pending = null
      updatePresence({ cursor: { x: Math.round(p.x), y: Math.round(p.y) } })
    }
    const onMove = (e: PointerEvent) => {
      if (!live()) return
      pending = { x: e.clientX, y: e.clientY }
      const wait = THROTTLE_MS - (performance.now() - last)
      if (wait <= 0) flush()
      else if (!timer) timer = setTimeout(flush, wait)
    }
    const onLeave = () => {
      if (!live()) return
      pending = null
      if (timer) clearTimeout(timer)
      timer = null
      updatePresence({ cursor: null })
    }
    domNode.addEventListener('pointermove', onMove)
    domNode.addEventListener('pointerleave', onLeave)
    return () => {
      domNode.removeEventListener('pointermove', onMove)
      domNode.removeEventListener('pointerleave', onLeave)
      if (timer) clearTimeout(timer)
      if (live()) updatePresence({ cursor: null })
    }
  }, [domNode])
}
