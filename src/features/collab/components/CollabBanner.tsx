import { Eye } from 'lucide-react'

import { useIsReadOnly } from '../hooks'

/** Aviso en texto plano bajo la cabecera cuando el invitado tiene el rol "Solo lectura". */
export function CollabBanner() {
  const readOnly = useIsReadOnly()
  if (!readOnly) return null
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs text-muted-foreground animate-in fade-in duration-200 motion-reduce:animate-none">
      <Eye className="size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-medium text-foreground">Estás en modo solo lectura.</span> Ves los cambios de los demás en directo; el anfitrión puede darte permiso de edición.
      </span>
    </div>
  )
}
