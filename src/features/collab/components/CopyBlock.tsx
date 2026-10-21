import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { copyText } from '../lib/clipboard'

interface Props {
  /** Lo que se ve (puede llevar el token oculto). */
  display: string
  /** Lo que se copia; si es una función, se resuelve al pulsar (p. ej. pide el token completo). */
  value: string | (() => Promise<string | null>)
  label: string
  className?: string
}

/** Bloque de código con botón Copiar. Scroll horizontal en vez de partir líneas (comandos de terminal). */
export function CopyBlock({ display, value, label, className }: Props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const copy = async () => {
    const text = typeof value === 'string' ? value : await value()
    if (text && (await copyText(text))) {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } else toast.error('No se pudo copiar. Selecciona el texto y cópialo a mano.')
  }

  return (
    <div className={cn('flex min-w-0 items-start rounded-md border bg-muted/40', className)}>
      <pre
        aria-label={label}
        tabIndex={0}
        className="min-w-0 flex-1 overflow-x-auto rounded-l-md py-2.5 pl-3 pr-2 font-mono text-xs leading-relaxed whitespace-pre text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {display}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => void copy()}
        aria-label={copied ? 'Copiado' : `Copiar ${label}`}
        className="m-1 shrink-0 text-muted-foreground hover:text-foreground max-sm:size-11"
      >
        {copied ? <Check className="animate-in zoom-in-50 duration-150 motion-reduce:animate-none" /> : <Copy />}
      </Button>
    </div>
  )
}
