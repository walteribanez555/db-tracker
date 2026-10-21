import { useRef, useState } from 'react'

import { cn } from '@/lib/utils'

interface InlineInputProps {
  initial: string
  /** `enter` distingue Enter (p. ej. para encadenar) de perder el foco. */
  onCommit: (value: string, via: 'enter' | 'blur') => void
  onCancel: () => void
  className?: string
  ariaLabel: string
}

/** Input en línea para nodos del lienzo: Enter confirma, Esc cancela, blur confirma. */
export function InlineInput({ initial, onCommit, onCancel, className, ariaLabel }: InlineInputProps) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)

  const finish = (via: 'enter' | 'blur' | 'cancel') => {
    if (done.current) return
    done.current = true
    if (via === 'cancel') onCancel()
    else onCommit(value.trim(), via)
  }

  return (
    <input
      autoFocus
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish('blur')}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish('enter')
        if (e.key === 'Escape') finish('cancel')
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'nodrag nopan h-5 min-w-0 flex-1 rounded-sm border border-brand bg-background px-1 outline-none focus:ring-2 focus:ring-brand/25',
        className,
      )}
    />
  )
}
