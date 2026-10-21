import { useState } from 'react'
import { toast } from 'sonner'

import { leaveSession } from '@/collab'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { keepSharedBenchmarks } from '../lib/host'
import { useJoinContext } from '../lib/join'

export type LeaveReason = 'leave' | 'kicked' | 'ended'

const COPY: Record<LeaveReason, { title: string; body: string }> = {
  leave: {
    title: '¿Quedarte con una copia del proyecto compartido?',
    body: 'Si te quedas con una copia, el proyecto compartido pasa a ser tu proyecto local. Si no, vuelves al proyecto que tenías antes de unirte.',
  },
  kicked: {
    title: 'El anfitrión te sacó de la sesión',
    body: '¿Quieres quedarte con una copia del proyecto compartido? Si no, vuelves al proyecto que tenías antes de unirte.',
  },
  ended: {
    title: 'El anfitrión terminó la sesión',
    body: '¿Quieres quedarte con una copia del proyecto compartido? Si no, vuelves al proyecto que tenías antes de unirte.',
  },
}

/** Salida del invitado: pregunta si conservar una copia y llama a leaveSession. */
export function LeaveDialog({ reason, onOpenChange }: { reason: LeaveReason | null; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const copy = COPY[reason ?? 'leave']

  const leave = async (keepCopy: boolean) => {
    setBusy(true)
    try {
      if (keepCopy) keepSharedBenchmarks()
      await leaveSession({ keepCopy })
      useJoinContext.getState().set(null)
      toast(keepCopy ? 'Te quedaste con una copia del proyecto' : 'Saliste de la sesión')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo salir de la sesión.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={reason !== null}
      // Si la sesión terminó o te expulsaron no se puede "cancelar": hay que elegir.
      onOpenChange={(o) => (reason === 'leave' || o ? onOpenChange(o) : undefined)}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={reason === 'leave'}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {reason === 'leave' && (
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)} className="max-sm:h-11 sm:mr-auto">
              Seguir en la sesión
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void leave(false)} className="max-sm:h-11">
            {reason === 'leave' ? 'Salir sin copia' : 'Descartar'}
          </Button>
          <Button disabled={busy} onClick={() => void leave(true)} className="max-sm:h-11">
            Quedarme con una copia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
