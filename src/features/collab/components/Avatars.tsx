import { cn } from '@/lib/utils'

import { initials } from '../lib/identity'

export function PeerAvatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex size-6 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold text-white', className)}
      style={{ backgroundColor: color }}
    >
      {initials(name)}
    </span>
  )
}

/** Avatares apilados (máximo `max`) con "+N" en texto para el resto. */
export function AvatarStack({ people, max = 4 }: { people: { id: string; name: string; color: string }[]; max?: number }) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <span className="flex items-center">
      <span className="flex -space-x-1.5">
        {shown.map((p) => (
          <PeerAvatar key={p.id} name={p.name} color={p.color} className="ring-2 ring-background" />
        ))}
      </span>
      {rest > 0 && <span className="ml-1 text-xs text-muted-foreground tabular-nums">+{rest}</span>}
    </span>
  )
}
