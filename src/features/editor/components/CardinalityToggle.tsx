import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { Cardinality } from '@/types/schema'

import { CARDINALITIES } from '../lib/constants'

interface CardinalityToggleProps {
  value: Cardinality
  onChange: (value: Cardinality) => void
}

export function CardinalityToggle({ value, onChange }: CardinalityToggleProps) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value}
      onValueChange={(v) => v && onChange(v as Cardinality)}
      className="w-full"
    >
      {CARDINALITIES.map((c) => (
        <ToggleGroupItem key={c} value={c} className="flex-1 font-mono text-xs">
          {c}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
