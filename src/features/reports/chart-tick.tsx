// Etiqueta de eje para recharts que trunca nombres largos (p. ej. ramas) y conserva el nombre completo como <title>.

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

interface TickProps {
  x?: number | string
  y?: number | string
  payload?: { value?: unknown }
  textAnchor?: string
  /** Máximo de caracteres visibles. */
  max: number
  /** Eje: 'y' alinea a la derecha del hueco del eje; 'x' centra bajo la barra. */
  axis: 'x' | 'y'
}

export function TruncatedTick({ x = 0, y = 0, payload, max, axis }: TickProps) {
  const full = String(payload?.value ?? '')
  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={axis === 'x' ? 12 : 4}
      dx={axis === 'y' ? -4 : 0}
      textAnchor={axis === 'y' ? 'end' : 'middle'}
      fontSize={11}
      className="fill-muted-foreground"
    >
      <title>{full}</title>
      {truncate(full, max)}
    </text>
  )
}
