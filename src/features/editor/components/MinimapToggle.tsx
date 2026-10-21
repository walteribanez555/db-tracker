import { ChevronDown, Map as MapIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Botón pequeño para plegar el minimapa; se sitúa sobre su esquina superior derecha cuando está abierto. */
export function MinimapToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="outline"
      size="icon-xs"
      onClick={onToggle}
      aria-label={open ? 'Ocultar minimapa' : 'Mostrar minimapa'}
      aria-pressed={open}
      title={open ? 'Ocultar minimapa' : 'Mostrar minimapa'}
      className={cn(
        'absolute right-[15px] z-10 bg-background/90 text-muted-foreground shadow-xs backdrop-blur transition-[bottom] duration-200 ease-out hover:text-foreground motion-reduce:transition-none',
        open ? 'bottom-[171px]' : 'bottom-[15px]',
      )}
    >
      {open ? <ChevronDown /> : <MapIcon />}
    </Button>
  )
}
