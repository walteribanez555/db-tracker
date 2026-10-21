/**
 * Panel lateral plegable (escritorio) que en móvil (< 768 px) pasa a una hoja (Sheet).
 *
 * ── API móvil ────────────────────────────────────────────────────────────────
 * `<CollapsiblePanel mobile="sheet" | "hidden" | "inline" mobileTrigger mobileSide …>`
 *   - `mobile="sheet"` (por defecto): en móvil el panel NO ocupa espacio en línea; su contenido se
 *     muestra en un Sheet lateral (lado = `mobileSide`, por defecto `side`; admite 'bottom').
 *   - `mobile="hidden"`: en móvil no se pinta nada (la sección muestra el contenido a su manera).
 *   - `mobile="inline"`: en móvil el contenido se pinta en línea a todo el ancho, sin riel ni
 *     anchura fija (útil para apilarlo en columna).
 *   - `mobileTrigger` (por defecto `true`): con `mobile="sheet"`, pinta un botón flotante discreto
 *     (44 px) en el borde de la pantalla para abrir la hoja, con `title` como aria-label.
 *     Pásalo a `false` si la sección pone su propio botón.
 *
 * Abrir la hoja desde fuera (mismo `storageKey` que el panel):
 *   const { open, setOpen, toggle } = usePanelSheet('editor-inspector')
 *   <PanelSheetTrigger storageKey="editor-inspector" title="Inspector" />   // botón listo (44 px)
 *   <PanelSheetTrigger storageKey="…" title="…" asChild><Button>…</Button></PanelSheetTrigger>
 * El estado vive en memoria (no se persiste) y es compartido por todos los que usen la misma clave.
 *
 * En escritorio el comportamiento es idéntico al de siempre (riel plegable con persistencia).
 */
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Slot } from 'radix-ui'
import { useEffect, useState } from 'react'

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

import { setPanelSheetOpen, usePanelSheet } from './panel-sheet'

const read = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(`db-tracker:panel:${key}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

export { usePanelSheet } from './panel-sheet'

export interface PanelSheetTriggerProps extends Omit<React.ComponentProps<'button'>, 'title'> {
  storageKey: string
  /** Título del panel: se usa como aria-label ("Abrir <title>"). */
  title: string
  /** Pasa el comportamiento a tu propio botón (p. ej. un `<Button>`). */
  asChild?: boolean
}

/** Botón que abre la hoja móvil del panel con ese `storageKey`. Sin estilos de posición: colócalo tú. */
export function PanelSheetTrigger({ storageKey, title, asChild, className, children, onClick, ...props }: PanelSheetTriggerProps) {
  const { open, setOpen } = usePanelSheet(storageKey)
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      type={asChild ? undefined : 'button'}
      aria-label={`Abrir ${title}`}
      aria-expanded={open}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOpen(true)
      }}
      className={cn(
        !asChild &&
          'inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children ?? (!asChild && <PanelLeftOpen className="size-5" />)}
    </Comp>
  )
}

export interface CollapsiblePanelProps {
  side: 'left' | 'right'
  /** Ancho desplegado en px. */
  width: number
  /** Nombre del panel: se muestra vertical en el riel cuando está plegado. */
  title: string
  storageKey: string
  defaultOpen?: boolean
  /** Atajo opcional (p. ej. '[' o ']') para plegar/desplegar. */
  shortcut?: string
  className?: string
  /** Comportamiento en móvil (< 768 px). Por defecto 'sheet'. */
  mobile?: 'sheet' | 'hidden' | 'inline'
  /** Con `mobile="sheet"`: botón flotante en el borde para abrir la hoja. Por defecto `true`. */
  mobileTrigger?: boolean
  /** Lado de la hoja móvil. Por defecto el mismo que `side`. */
  mobileSide?: 'left' | 'right' | 'bottom'
  /** Clases extra para el contenido de la hoja móvil. */
  mobileSheetClassName?: string
  children: React.ReactNode
}

/** Panel lateral que se pliega a un riel estrecho con animación de ancho. */
export function CollapsiblePanel(props: CollapsiblePanelProps) {
  const isMobile = useIsMobile()
  const { mobile = 'sheet' } = props
  if (!isMobile) return <DesktopPanel {...props} />
  if (mobile === 'hidden') return null
  if (mobile === 'inline')
    return (
      <section aria-label={props.title} className={cn('flex w-full min-w-0 flex-col bg-background', props.className)}>
        {props.children}
      </section>
    )
  return <MobileSheetPanel {...props} />
}

function MobileSheetPanel({
  side,
  title,
  storageKey,
  mobileTrigger = true,
  mobileSide,
  mobileSheetClassName,
  children,
}: CollapsiblePanelProps) {
  const { open, setOpen } = usePanelSheet(storageKey)
  const sheetSide = mobileSide ?? side
  const OpenIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen

  // Al desmontar la sección (cambio de ruta) la hoja no debe quedar abierta.
  useEffect(() => () => setPanelSheetOpen(storageKey, false), [storageKey])

  return (
    <>
      {mobileTrigger && (
        <PanelSheetTrigger
          storageKey={storageKey}
          title={title}
          className={cn(
            'fixed top-1/2 z-30 size-11 -translate-y-1/2 border bg-background/90 shadow-sm backdrop-blur-sm',
            side === 'left' ? 'left-0 rounded-l-none border-l-0' : 'right-0 rounded-r-none border-r-0',
          )}
        >
          <OpenIcon className="size-5" />
        </PanelSheetTrigger>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={sheetSide}
          // En el teléfono no enfocar el primer campo (p. ej. el buscador): sacaría el teclado cada vez.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            'gap-0 p-0',
            sheetSide === 'bottom'
              ? 'max-h-[85svh] rounded-t-xl pb-[env(safe-area-inset-bottom)]'
              : 'w-[min(88vw,380px)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
            mobileSheetClassName,
          )}
        >
          {sheetSide === 'bottom' && (
            <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
          )}
          <SheetHeader className="shrink-0 border-b px-4 py-3 pr-14">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">Panel {title}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function DesktopPanel({
  side,
  width,
  title,
  storageKey,
  defaultOpen = true,
  shortcut,
  className,
  children,
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(() => read(storageKey, defaultOpen))

  const change = (next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(`db-tracker:panel:${storageKey}`, next ? '1' : '0')
    } catch {
      // sin almacenamiento
    }
  }

  useEffect(() => {
    if (!shortcut) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], .monaco-editor, .nokey')) return
      if (e.key === shortcut) setOpen((o) => {
        try {
          localStorage.setItem(`db-tracker:panel:${storageKey}`, o ? '0' : '1')
        } catch {
          // sin almacenamiento
        }
        return !o
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut, storageKey])

  const CloseIcon = side === 'left' ? PanelLeftClose : PanelRightClose
  const OpenIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen
  const hint = shortcut ? ` (${shortcut})` : ''

  return (
    <aside
      aria-label={title}
      style={{ width: open ? width : 40 }}
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden bg-background transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none',
        side === 'left' ? 'border-r' : 'border-l',
        className,
      )}
    >
      <div
        aria-hidden={!open}
        inert={!open}
        style={{ width }}
        className={cn(
          'flex min-h-0 flex-1 flex-col transition-opacity duration-200',
          open ? 'opacity-100 delay-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className={cn('flex h-9 shrink-0 items-center px-2', side === 'left' ? 'justify-end' : 'justify-start')}>
          <button
            type="button"
            onClick={() => change(false)}
            aria-label={`Plegar ${title}${hint}`}
            title={`Plegar${hint}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>

      <button
        type="button"
        onClick={() => change(true)}
        aria-label={`Desplegar ${title}${hint}`}
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        className={cn(
          'absolute inset-0 flex flex-col items-center gap-3 pt-2.5 text-muted-foreground transition-opacity duration-200 hover:bg-muted/60 hover:text-foreground',
          open ? 'pointer-events-none opacity-0' : 'opacity-100 delay-150',
        )}
      >
        <OpenIcon className="size-4" />
        <span className="text-xs font-medium [writing-mode:vertical-rl]">{title}</span>
      </button>
    </aside>
  )
}
