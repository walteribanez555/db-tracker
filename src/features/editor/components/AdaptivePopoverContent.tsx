import type { ComponentProps, ReactNode } from 'react'

import { PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

type AdaptivePopoverContentProps = ComponentProps<typeof PopoverContent> & {
  /** Título de la hoja en móvil (y nombre accesible). */
  title: string
  description?: string
  /** Cierra la edición: en móvil la hoja no forma parte del Popover. */
  onClose: () => void
  /** `full`: pantalla completa (editores SQL); `sheet`: hoja inferior. */
  mobileLayout?: 'sheet' | 'full'
  children: ReactNode
}

/**
 * Contenido de un popover anclado a un nodo. En escritorio es un `PopoverContent` normal;
 * en móvil se pinta como hoja inferior o a pantalla completa (el popover anclado no cabe).
 */
export function AdaptivePopoverContent({
  title,
  description,
  onClose,
  mobileLayout = 'sheet',
  children,
  className,
  ...props
}: AdaptivePopoverContentProps) {
  const isMobile = useIsMobile()
  if (!isMobile)
    return (
      <PopoverContent className={className} {...props}>
        {children}
      </PopoverContent>
    )
  const full = mobileLayout === 'full'
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        // Los portales propagan eventos React: que no lleguen al nodo de React Flow.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        // Sin foco automático: en móvil abriría el teclado nada más mostrar la hoja.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(
          'gap-0 p-0 pb-[env(safe-area-inset-bottom)]',
          full ? 'h-dvh max-h-dvh rounded-none border-t-0 pt-[env(safe-area-inset-top)] data-[side=bottom]:h-dvh' : 'max-h-[88dvh] rounded-t-xl',
          '[&>[data-slot=sheet-close]]:top-1.5 [&>[data-slot=sheet-close]]:right-1.5 [&>[data-slot=sheet-close]]:size-11',
        )}
      >
        <SheetHeader className="h-14 shrink-0 justify-center border-b px-4 py-0 pr-14">
          <SheetTitle className="truncate">{title}</SheetTitle>
          <SheetDescription className="sr-only">{description ?? title}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
