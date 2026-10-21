import { Check, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { Fragment, isValidElement, useState, type ReactNode } from 'react'

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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
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

/** Lista táctil (≥ 44 px por fila); los submenús se abren en la misma hoja con "Atrás". */
function SheetItems({ groups, onDone, onEnter }: { groups: ActionGroup[]; onDone: () => void; onEnter: (item: ActionItem) => void }) {
  const visible = groups.filter((g) => g.items.length > 0)
  return visible.map((group, gi) => (
    <div key={group.id} role="group" aria-label={group.label} className={cn(gi > 0 && 'mt-1 border-t pt-1')}>
      {group.label && <div className="truncate px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>}
      {group.items.map((item) => (
        <button
          key={item.id}
          type="button"
          role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
          aria-checked={item.checked}
          aria-haspopup={item.submenu ? 'menu' : undefined}
          disabled={item.disabled}
          onClick={() => {
            if (item.submenu) return onEnter(item)
            onDone()
            item.onSelect?.()
          }}
          className={cn(
            'flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors active:bg-muted disabled:opacity-50',
            item.destructive && 'text-destructive [&_svg]:text-destructive',
          )}
        >
          {item.checked !== undefined ? (
            <span className="flex size-4 shrink-0 items-center justify-center">{item.checked && <Check className="size-4" />}</span>
          ) : (
            <ItemIcon icon={item.icon} />
          )}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint && <span className="max-w-36 truncate text-xs text-muted-foreground">{item.hint}</span>}
          {item.submenu && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
        </button>
      ))}
    </div>
  ))
}

function ActionSheet({ open, onOpenChange, groups, className }: Pick<ActionMenuProps, 'open' | 'onOpenChange' | 'groups' | 'className'>) {
  const [stack, setStack] = useState<ActionItem[]>([])
  const current = stack.at(-1)
  const change = (next: boolean) => {
    if (!next) setStack([])
    onOpenChange(next)
  }
  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent
        side="bottom"
        role="menu"
        className={cn('max-h-[80svh] gap-0 rounded-t-xl p-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]', className)}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
        <SheetHeader className="flex-row items-center gap-1 px-2 py-1 pr-12">
          {current ? (
            <button
              type="button"
              onClick={() => setStack((s) => s.slice(0, -1))}
              aria-label="Atrás"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-muted"
            >
              <ChevronLeft className="size-5" />
            </button>
          ) : null}
          <SheetTitle className={cn('truncate text-sm', !current && 'px-2')}>{current?.label ?? 'Acciones'}</SheetTitle>
          <SheetDescription className="sr-only">Menú de acciones</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SheetItems
            groups={current?.submenu ?? groups}
            onDone={() => change(false)}
            onEnter={(item) => setStack((s) => [...s, item])}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Menú de acciones controlado y anclado a un punto de la pantalla.
 * En móvil (< 768 px) se pinta como hoja inferior con filas de 44 px; la API no cambia.
 */
export function ActionMenu({ open, x, y, onOpenChange, groups, className }: ActionMenuProps) {
  const isMobile = useIsMobile()
  if (isMobile) return <ActionSheet open={open} onOpenChange={onOpenChange} groups={groups} />
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
