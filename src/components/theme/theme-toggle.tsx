import { cn } from '@/lib/utils'

import { useTheme } from './theme-provider'

/** Botón sol/luna: el sol se convierte en luna (y viceversa) mientras el tema se revela en círculo. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme()
  const dark = resolved === 'dark'

  return (
    <button
      type="button"
      data-theme-toggle
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      }}
      aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={dark ? 'Modo claro' : 'Modo oscuro'}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
        <mask id="theme-toggle-moon">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <circle
            r="9"
            fill="black"
            className="transition-[cx,cy] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
            cx={dark ? 17 : 32}
            cy={dark ? 7 : 0}
          />
        </mask>
        <circle
          cx="12"
          cy="12"
          fill="currentColor"
          mask="url(#theme-toggle-moon)"
          className="transition-[r] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
          r={dark ? 9 : 5}
        />
        <g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={cn(
            'origin-center transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]',
            dark ? 'scale-50 rotate-45 opacity-0' : 'scale-100 rotate-0 opacity-100',
          )}
        >
          <line x1="12" y1="1.5" x2="12" y2="3.5" />
          <line x1="12" y1="20.5" x2="12" y2="22.5" />
          <line x1="1.5" y1="12" x2="3.5" y2="12" />
          <line x1="20.5" y1="12" x2="22.5" y2="12" />
          <line x1="4.6" y1="4.6" x2="6" y2="6" />
          <line x1="18" y1="18" x2="19.4" y2="19.4" />
          <line x1="4.6" y1="19.4" x2="6" y2="18" />
          <line x1="18" y1="6" x2="19.4" y2="4.6" />
        </g>
      </svg>
    </button>
  )
}
