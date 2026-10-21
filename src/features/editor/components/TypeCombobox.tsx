import { defaultFilter } from 'cmdk'
import { ChevronsUpDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'

import { COMMON_TYPES } from '../lib/sqlTypes'

const CUSTOM_PREFIX = '__custom__'

interface TypeComboboxProps {
  value: string
  onChange: (type: string) => void
  className?: string
  /** Control externo de la apertura (edición en línea desde el lienzo). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Disparador propio; por defecto un botón con el tipo actual. */
  children?: ReactNode
}

export function TypeCombobox({ value, onChange, className, open: openProp, onOpenChange, children }: TypeComboboxProps) {
  const dialect = useProjectStore((s) => s.draft.dialect)
  const enums = useProjectStore((s) => s.draft.enums)
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  const [search, setSearch] = useState('')

  const custom = search.trim()
  const known = [...COMMON_TYPES[dialect], ...enums.map((e) => e.name)]
  const showCustom = custom.length > 0 && !known.some((t) => t.toLowerCase() === custom.toLowerCase())

  const pick = (type: string) => {
    onChange(type)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn('justify-between gap-1 px-2 font-mono text-xs font-normal', className)}
        >
          <span className="truncate">{value || 'tipo'}</span>
          <ChevronsUpDown className="size-3 opacity-50" />
        </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="end">
        <Command filter={(v, search, keywords) => (v.startsWith(CUSTOM_PREFIX) ? 0.001 : defaultFilter(v, search, keywords))}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="Buscar o escribir tipo…" />
          <CommandList>
            <CommandEmpty>Sin coincidencias</CommandEmpty>
            <CommandGroup heading={`Tipos ${dialect}`}>
              {COMMON_TYPES[dialect].map((t) => (
                <CommandItem key={t} value={t} data-checked={t === value} onSelect={() => pick(t)} className="font-mono text-xs">
                  {t}
                </CommandItem>
              ))}
            </CommandGroup>
            {enums.length > 0 && (
              <CommandGroup heading="Enums">
                {enums.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`enum:${e.name}`}
                    keywords={[e.name]}
                    data-checked={e.name === value}
                    onSelect={() => pick(e.name)}
                    className="font-mono text-xs"
                  >
                    {e.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showCustom && (
              <CommandGroup>
                <CommandItem value={`${CUSTOM_PREFIX}${custom}`} onSelect={() => pick(custom)} className="font-mono text-xs">
                  Usar «{custom}»
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
