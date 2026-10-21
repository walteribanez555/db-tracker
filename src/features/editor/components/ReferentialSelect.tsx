import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ReferentialAction } from '@/types/schema'

import { REFERENTIAL_ACTIONS } from '../lib/constants'

interface ReferentialSelectProps {
  label: string
  value: ReferentialAction
  onChange: (value: ReferentialAction) => void
}

export function ReferentialSelect({ label, value, onChange }: ReferentialSelectProps) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as ReferentialAction)}>
        <SelectTrigger size="sm" className="w-full font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {REFERENTIAL_ACTIONS.map((a) => (
            <SelectItem key={a} value={a} className="font-mono text-xs">
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
