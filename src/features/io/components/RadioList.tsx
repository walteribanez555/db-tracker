// Lista de opciones excluyentes, plana (radio nativo + etiqueta y descripción).
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface RadioOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function RadioList<T extends string>({
  name,
  value,
  onChange,
  options,
  className,
  dense,
}: {
  name: string
  value: T
  onChange: (v: T) => void
  options: RadioOption<T>[]
  className?: string
  dense?: boolean
}) {
  return (
    <div role="radiogroup" className={cn('flex flex-col', className)}>
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-md px-2 transition-colors duration-150 hover:bg-muted/50',
            dense ? 'py-1' : 'py-1.5',
            o.disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            className="mt-[3px] size-3.5 shrink-0 accent-brand"
          />
          <span className="min-w-0">
            <span className={cn('block text-sm', value === o.value && 'font-medium')}>{o.label}</span>
            {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}
