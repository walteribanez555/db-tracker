// Barra horizontal que crece desde 0 hasta `value` (0–100) al montarse y al cambiar.
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

export function GrowBar({ value, className, barClassName }: { value: number; className?: string; barClassName?: string }) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, value))))
    return () => cancelAnimationFrame(id)
  }, [value])
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}>
      <div
        className={cn(
          'h-full rounded-full bg-brand transition-[width] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none',
          barClassName,
        )}
        style={{ width: `${w}%` }}
      />
    </div>
  )
}
