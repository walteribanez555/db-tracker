import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'

export type Theme = 'light' | 'dark' | 'system'
type Resolved = 'light' | 'dark'

const STORAGE_KEY = 'db-tracker:theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

interface ThemeContextValue {
  theme: Theme
  resolved: Resolved
  /** Cambia el tema; si se pasa un origen (p. ej. el botón), anima un círculo desde ahí. */
  setTheme: (theme: Theme, origin?: { x: number; y: number }) => void
  toggle: (origin?: { x: number; y: number }) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const readStored = (): Theme => {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

const resolve = (theme: Theme): Resolved => (theme === 'system' ? (media().matches ? 'dark' : 'light') : theme)

const apply = (resolved: Resolved) => {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored)
  const [resolved, setResolved] = useState<Resolved>(() => resolve(readStored()))

  useEffect(() => apply(resolved), [resolved])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = media()
    const onChange = () => setResolved(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((next: Theme, origin?: { x: number; y: number }) => {
    const nextResolved = resolve(next)
    const commit = () => {
      setThemeState(next)
      setResolved(nextResolved)
      apply(nextResolved)
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // almacenamiento no disponible: el tema dura la sesión
      }
    }

    if (!origin || !document.startViewTransition || prefersReducedMotion() || nextResolved === resolve(readStored())) {
      commit()
      return
    }

    // Transición estilo Telegram: el tema nuevo se revela en un círculo que crece desde el botón.
    const { x, y } = origin
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    const transition = document.startViewTransition(() => flushSync(commit))
    void transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme, toggle: (origin) => setTheme(resolved === 'dark' ? 'light' : 'dark', origin) }),
    [theme, resolved, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>')
  return ctx
}
