import { format } from 'date-fns'

import { useActivityStore } from '../activity'

/** Contenido de la pestaña "Actividad" del dock: entradas, salidas y cambios de rol, lo más reciente arriba. */
export function ActivityPanel() {
  const entries = useActivityStore((s) => s.entries)
  if (!entries.length)
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Aquí aparece lo que pasa en la sesión compartida: quién entra y sale y los cambios de rol.
      </p>
    )
  return (
    <ol className="divide-y" aria-label="Actividad de la sesión">
      {entries.map((e) => (
        <li key={e.id} className="flex items-baseline gap-3 px-4 py-1.5 text-xs animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
          <time className="w-10 shrink-0 text-muted-foreground tabular-nums" dateTime={new Date(e.at).toISOString()}>
            {format(e.at, 'HH:mm')}
          </time>
          <span className="min-w-0 truncate">
            {e.who ? (
              <>
                <span className="font-medium" style={{ color: e.color ?? undefined }}>
                  {e.who}
                </span>{' '}
                {e.text}
              </>
            ) : (
              <span className="text-muted-foreground">{e.text}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
