import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import type { EnumType } from '@/types/schema'

import { removeEnum, upsertEnumValues } from '../lib/actions'

interface EnumPopoverProps {
  enumType?: EnumType
  children: ReactNode
}

export function EnumPopover({ enumType, children }: EnumPopoverProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [values, setValues] = useState('')

  const onOpenChange = (next: boolean) => {
    if (next) {
      setName(enumType?.name ?? '')
      setValues(enumType?.values.join('\n') ?? '')
    }
    setOpen(next)
  }

  const parsed = values
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean)
  const valid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim()) && parsed.length > 0

  const save = () => {
    if (!valid) return
    upsertEnumValues(enumType?.id ?? null, name.trim(), [...new Set(parsed)])
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 gap-3">
        <div className="text-sm font-medium">{enumType ? 'Editar enum' : 'Nuevo enum'}</div>
        <div className="grid gap-1.5">
          <Label htmlFor="enum-name" className="text-xs text-muted-foreground">
            Nombre
          </Label>
          <Input id="enum-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="estado_pedido" className="font-mono" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="enum-values" className="text-xs text-muted-foreground">
            Valores (uno por línea)
          </Label>
          <Textarea
            id="enum-values"
            value={values}
            onChange={(e) => setValues(e.target.value)}
            rows={5}
            placeholder={'pendiente\npagado\nenviado'}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          {enumType ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                removeEnum(enumType.id)
                setOpen(false)
              }}
            >
              Eliminar
            </Button>
          ) : (
            <span />
          )}
          <Button size="sm" disabled={!valid} onClick={save}>
            Guardar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
