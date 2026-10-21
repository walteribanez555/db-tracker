import type { ConnectionStatus } from '@/collab'
import { Button } from '@/components/ui/button'

/** Vista de espera tras pedir entrada: aprobación pendiente, rechazo, expulsión o fin de sesión. */
export function JoinStatus({
  status,
  hostName,
  error,
  onCancel,
  onBack,
}: {
  status: ConnectionStatus
  hostName: string
  error?: string | null
  onCancel: () => void
  onBack: () => void
}) {
  if (status === 'connecting' || status === 'pending') {
    const waiting = status === 'pending'
    return (
      <div className="space-y-4 py-2" role="status" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
          </span>
          <p className="text-sm font-medium">{waiting ? `Esperando a que ${hostName} te acepte…` : 'Conectando…'}</p>
        </div>
        {waiting && <p className="text-sm text-muted-foreground">Deja esta pantalla abierta. Entrarás en cuanto el anfitrión apruebe tu solicitud.</p>}
        <Button variant="outline" onClick={onCancel} className="h-11 w-full sm:h-8 sm:w-auto">
          Cancelar
        </Button>
      </div>
    )
  }
  const message: Partial<Record<ConnectionStatus, [string, string]>> = {
    rejected: ['Solicitud rechazada', `${hostName} no ha aceptado tu solicitud.`],
    kicked: ['Te han expulsado', `${hostName} te ha sacado de la sesión.`],
    ended: ['La sesión terminó', `${hostName} dejó de compartir el proyecto.`],
    offline: ['Sin conexión', 'No se pudo mantener la conexión con el anfitrión.'],
  }
  const [title, body] = message[status] ?? ['No se pudo entrar', error ?? 'Inténtalo de nuevo.']
  return (
    <div className="space-y-3 py-2" role="alert">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{error && status === 'rejected' ? `${body} ${error}` : body}</p>
      <Button variant="outline" onClick={onBack} className="h-11 w-full sm:h-8 sm:w-auto">
        Volver
      </Button>
    </div>
  )
}
