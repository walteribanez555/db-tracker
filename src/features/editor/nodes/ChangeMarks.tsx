import { cn } from '@/lib/utils'

import type { ChangeKind } from '../lib/changes'

/** Overlay de destello: se vuelve a montar (nueva `key`) en cada edición para repetir la animación. */
export function FlashOverlay({ flashKey }: { flashKey: number }) {
  if (!flashKey) return null
  return <span key={flashKey} aria-hidden className="db-change-flash pointer-events-none absolute inset-0 z-10 rounded-[inherit]" />
}

const LABEL: Record<ChangeKind, string> = { added: 'Nuevo sin confirmar', modified: 'Modificado sin confirmar' }

/** Punto lateral persistente mientras el cambio no se confirma (se desvanece al confirmar). */
export function ChangeDot({ change, className }: { change?: ChangeKind; className?: string }) {
  return (
    <span
      aria-hidden={!change}
      title={change ? LABEL[change] : undefined}
      className={cn(
        'pointer-events-none absolute -top-1 -left-1 z-10 size-2.5 rounded-full border-2 border-background bg-brand transition-opacity duration-300 ease-out',
        change ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  )
}
