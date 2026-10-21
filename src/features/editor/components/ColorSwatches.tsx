import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

interface ColorSwatchesProps {
  colors: string[]
  value: string
  onChange: (color: string) => void
}

export function ColorSwatches({ colors, value, onChange }: ColorSwatchesProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((color) => {
        const active = color.toLowerCase() === value.toLowerCase()
        return (
          <button
            key={color}
            type="button"
            aria-label={`Color ${color}`}
            aria-pressed={active}
            onClick={() => onChange(color)}
            className={cn(
              'flex size-6 items-center justify-center rounded-md border border-foreground/15 transition-transform hover:scale-110',
              active && 'ring-2 ring-ring ring-offset-1 ring-offset-background',
            )}
            style={{ background: color }}
          >
            {active && <Check className="size-3.5 text-white mix-blend-difference" />}
          </button>
        )
      })}
    </div>
  )
}
