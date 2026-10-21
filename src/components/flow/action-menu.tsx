import type { LucideIcon } from 'lucide-react'
import { Fragment, isValidElement, type ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

export interface ActionItem {
  id: string
  label: string
  /** Componente de lucide o un nodo ya renderizado (p. ej. una muestra de color). */
  icon?: LucideIcon | ReactNode
  /** Atajo a mostrar; un array se pinta como combinación de teclas (["⌘", "D"]). */
  shortcut?: string | string[]
  destructive?: boolean
  disabled?: boolean
  /** Si se define, el elemento se pinta como casilla marcada/desmarcada. */
  checked?: boolean
  /** Texto secundario a la derecha (p. ej. el motivo de un elemento deshabilitado). */
  hint?: string
  onSelect?: () => void
  submenu?: ActionGroup[]
}

export interface ActionGroup {
  id: string
  label?: string
  items: ActionItem[]
}

export type { ActionMenuState } from './use-action-menu'

export interface ActionMenuProps {
  open: boolean
  /** Coordenadas de pantalla (clientX / clientY). */
  x: number
  y: number
  onOpenChange: (open: boolean) => void
  groups: ActionGroup[]
  className?: string
}

function ItemIcon({ icon }: { icon: ActionItem['icon'] }) {
  if (!icon) return <span className="size-4 shrink-0" />
  if (isValidElement(icon)) return <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
  const Icon = icon as LucideIcon
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}

function Shortcut({ value }: { value: ActionItem['shortcut'] }) {
  if (!value) return null
  const keys = Array.isArray(value) ? value : [value]
  return (
    <KbdGroup className="ml-auto pl-3">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </KbdGroup>
  )
}

function Items({ groups }: { groups: ActionGroup[] }) {
  const visible = groups.filter((g) => g.items.length > 0)
  return visible.map((group, gi) => (
    <Fragment key={group.id}>
      {gi > 0 && <DropdownMenuSeparator />}
      <DropdownMenuGroup>
        {group.label && <DropdownMenuLabel className="truncate">{group.label}</DropdownMenuLabel>}
        {group.items.map((item) => {
          const content = (
            <>
              <ItemIcon icon={item.icon} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="ml-2 max-w-40 truncate text-xs text-muted-foreground">{item.hint}</span>}
            </>
          )
          if (item.submenu) {
            return (
              <DropdownMenuSub key={item.id}>
                <DropdownMenuSubTrigger disabled={item.disabled} className={cn(item.destructive && 'text-destructive')}>
                  {content}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 min-w-44 overflow-y-auto">
                  <Items groups={item.submenu} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          }
          if (item.checked !== undefined) {
            return (
              <DropdownMenuCheckboxItem key={item.id} checked={item.checked} disabled={item.disabled} onSelect={() => item.onSelect?.()}>
                {content}
                <Shortcut value={item.shortcut} />
              </DropdownMenuCheckboxItem>
            )
          }
          return (
            <DropdownMenuItem
              key={item.id}
              disabled={item.disabled}
              variant={item.destructive ? 'destructive' : 'default'}
              onSelect={() => item.onSelect?.()}
            >
              {content}
              <Shortcut value={item.shortcut} />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuGroup>
    </Fragment>
  ))
}

/** Menú de acciones controlado y anclado a un punto de la pantalla. */
export function ActionMenu({ open, x, y, onOpenChange, groups, className }: ActionMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden tabIndex={-1} className="pointer-events-none fixed size-0" style={{ left: x, top: y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        collisionPadding={8}
        className={cn('w-60', className)}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Items groups={groups} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
