import { useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'

import { cn } from '@/lib/utils'

export interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

/** Navegación por secciones con un indicador que se desliza hasta la sección activa. */
export function SectionNav({ items }: { items: NavItem[] }) {
  const { pathname } = useLocation()
  const listRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const active = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
      setIndicator(active ? { left: active.offsetLeft, width: active.offsetWidth } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (listRef.current) ro.observe(listRef.current)
    return () => ro.disconnect()
  }, [pathname])

  return (
    <nav aria-label="Secciones" className="overflow-x-auto border-t px-3">
      <div ref={listRef} className="relative flex items-center gap-1 py-1.5">
        {indicator && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 rounded-md bg-muted transition-[left,width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{ left: indicator.left, width: indicator.width }}
          />
        )}
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'relative z-10 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-200 hover:text-foreground',
                isActive && 'font-medium text-foreground',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
