import { useRef } from 'react'

import { cn } from '@/lib/utils'

import { normalizeCode } from '../lib/join'

const LEN = 6

/** Código de sala en 6 casillas: avanza solo, admite pegar el código completo y borra hacia atrás. */
export function CodeInput({
  value,
  onChange,
  disabled,
  invalid,
  autoFocus,
  id,
}: {
  value: string
  onChange: (code: string) => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  id?: string
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const chars = Array.from({ length: LEN }, (_, i) => value[i] ?? '')
  const focus = (i: number) => refs.current[Math.max(0, Math.min(LEN - 1, i))]?.focus()

  const setAt = (i: number, raw: string) => {
    const clean = normalizeCode(raw)
    if (clean.length > 1) {
      // Pegado o autocompletado: rellena desde esta casilla.
      const next = normalizeCode(value.slice(0, i) + clean)
      onChange(next)
      focus(next.length)
      return
    }
    const arr = [...chars]
    arr[i] = clean
    const next = arr.join('').slice(0, LEN)
    onChange(normalizeCode(next))
    if (clean) focus(i + 1)
  }

  return (
    <div className="flex gap-1.5 sm:gap-2" role="group" aria-label="Código de la sesión">
      {chars.map((c, i) => (
        <input
          key={i}
          id={i === 0 ? id : undefined}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={c}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          spellCheck={false}
          aria-label={`Carácter ${i + 1} de ${LEN}`}
          aria-invalid={invalid || undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setAt(i, e.target.value)}
          onPaste={(e) => {
            e.preventDefault()
            setAt(i, e.clipboardData.getData('text'))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !c && i > 0) {
              e.preventDefault()
              const arr = [...chars]
              arr[i - 1] = ''
              onChange(arr.join(''))
              focus(i - 1)
            } else if (e.key === 'ArrowLeft') focus(i - 1)
            else if (e.key === 'ArrowRight') focus(i + 1)
          }}
          className={cn(
            'h-12 w-full max-w-12 min-w-0 flex-1 rounded-lg border border-input bg-transparent text-center font-mono text-lg font-semibold uppercase outline-none transition-colors sm:h-11 sm:max-w-10',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30',
            'aria-invalid:border-destructive',
          )}
        />
      ))}
    </div>
  )
}
