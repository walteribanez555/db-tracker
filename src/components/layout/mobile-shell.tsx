/**
 * Estructura móvil (< 768 px): barra superior compacta, barra de pestañas inferior y hoja "Más".
 * En escritorio no se usa (App pinta la cabecera y SectionNav de siempre).
 */
import { Bot, Database, LogIn, Menu, Monitor, Moon, MoreHorizontal, Share2, Sun } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'

import type { NavItem } from '@/components/layout/section-nav'
import { useTheme, type Theme } from '@/components/theme/theme-provider'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useCollabStore } from '@/collab'
import { CollabHeader, JoinDialog, ShareDialog, useIsCollaborating } from '@/features/collab'
import { AgentsDialog } from '@/features/collab/components/AgentsDialog'
import { isLoopbackOrigin } from '@/features/collab/lib/identity'
import { BranchSwitcher } from '@/features/versions'
import { cn } from '@/lib/utils'

/** Barra superior de 56 px: proyecto, rama (mono pequeño), avatares de la sesión y menú. */
export function MobileTopBar({ projectName, onMenu }: { projectName: string; onMenu: () => void }) {
  return (
    <header className="shrink-0 border-b bg-background pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-2 pr-1 pl-3">
        <Database className="size-5 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate text-sm leading-tight font-semibold">{projectName}</span>
          <div className="-ml-1.5 flex min-w-0">
            <BranchSwitcher compact />
          </div>
        </div>
        {/*
          Colaboración: CollabHeader (compacto) monta los hooks de presencia y, en sesión, los avatares
          con su menú. Fuera de sesión su botón de acciones se oculta: esas acciones están en "Más".
        */}
        <CollabHeader compact className="shrink-0 [&>[data-variant]]:hidden" />
        <button
          type="button"
          onClick={onMenu}
          aria-label="Menú"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Menu className="size-5" />
        </button>
      </div>
    </header>
  )
}

/** Barra de pestañas inferior (64 px + área segura). */
export function MobileTabBar({ items, moreItems, onMore }: { items: NavItem[]; moreItems: NavItem[]; onMore: () => void }) {
  const { pathname } = useLocation()
  const moreActive = moreItems.some((i) => pathname.startsWith(i.to))
  const cell =
    'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] leading-none text-muted-foreground transition-colors'
  const active = 'font-medium text-foreground after:absolute after:inset-x-5 after:top-0 after:h-0.5 after:rounded-full after:bg-foreground'
  return (
    <nav aria-label="Secciones" className="shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-16 items-stretch">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cn(cell, isActive && active)}>
            <Icon className="size-5" />
            <span className="max-w-full truncate px-0.5">{label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={onMore} aria-haspopup="dialog" className={cn(cell, moreActive && active)}>
          <MoreHorizontal className="size-5" />
          <span>Más</span>
        </button>
      </div>
    </nav>
  )
}

const THEMES: { value: Theme; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
]

type CollabDialog = 'share' | 'join' | 'agents' | null

/** Hoja inferior "Más": resto de secciones, acciones de colaboración y tema. */
export function MoreSheet({ open, onOpenChange, items }: { open: boolean; onOpenChange: (open: boolean) => void; items: NavItem[] }) {
  const { theme, setTheme } = useTheme()
  const collaborating = useIsCollaborating()
  const [dialog, setDialog] = useState<CollabDialog>(null)
  const isHost = useCollabStore((s) => s.isHost)
  const canShare = isLoopbackOrigin()
  // Como en CollabHeader: los agentes se conectan por loopback y solo los configura el anfitrión.
  const canAgents = canShare && (!collaborating || isHost)

  const openDialog = (d: CollabDialog) => {
    onOpenChange(false)
    setDialog(d)
  }

  const row =
    'flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm transition-colors active:bg-muted [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[85svh] gap-0 rounded-t-xl p-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetHeader className="px-4 pt-2 pb-1">
            <SheetTitle>Más</SheetTitle>
            <SheetDescription className="sr-only">Otras secciones, colaboración y tema</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <nav aria-label="Más secciones" className="py-1">
              {items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => onOpenChange(false)}
                  className={({ isActive }) => cn(row, isActive && 'font-medium [&_svg]:text-foreground bg-muted/60')}
                >
                  <Icon />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div role="group" aria-label="Colaboración" className="border-t py-1">
              <div className="px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">Colaboración</div>
              {!collaborating && canShare && (
                <button type="button" className={row} onClick={() => openDialog('share')}>
                  <Share2 />
                  Compartir
                </button>
              )}
              {!collaborating && (
                <button type="button" className={row} onClick={() => openDialog('join')}>
                  <LogIn />
                  Unirse
                </button>
              )}
              {canAgents && (
                <button type="button" className={row} onClick={() => openDialog('agents')}>
                  <Bot />
                  Conectar agentes
                </button>
              )}
            </div>

            <div role="group" aria-label="Tema" className="border-t px-4 py-3">
              <div className="pb-2 text-xs font-medium text-muted-foreground">Tema</div>
              <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                {THEMES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={theme === value}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setTheme(value, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
                    }}
                    className={cn(
                      'flex h-11 items-center justify-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors',
                      theme === value && 'bg-background font-medium text-foreground shadow-xs',
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Diálogos existentes de la colaboración (no se reescriben). */}
      <ShareDialog open={dialog === 'share'} onOpenChange={(o) => !o && setDialog(null)} />
      <JoinDialog open={dialog === 'join'} onOpenChange={(o) => !o && setDialog(null)} />
      <AgentsDialog open={dialog === 'agents'} onOpenChange={(o) => !o && setDialog(null)} />
    </>
  )
}
