// Registro de actividad de la sesión (pestaña "Actividad" del dock): entradas, salidas y cambios de rol.
// Se deriva de los cambios del store del cliente (lista de participantes y estado de la conexión).
import { useEffect } from 'react'
import { create } from 'zustand'

import { useActivity, useCollabStore, type ClientKind, type CollabRole, type CollabState, type Participant } from '@/collab'

export interface ActivityEntry {
  id: string
  at: number
  /** Nombre de quien la protagoniza (null = mensaje del sistema). */
  who: string | null
  color: string | null
  /** Tipo de cliente de quien la protagoniza (icono en el panel). */
  kind?: ClientKind
  text: string
}

const MAX = 200

interface ActivityState {
  entries: ActivityEntry[]
  add: (e: Omit<ActivityEntry, 'id' | 'at'>) => void
  clear: () => void
}

let seq = 0

export const useActivityStore = create<ActivityState>()((set) => ({
  entries: [],
  add: (e) => set((s) => ({ entries: [{ ...e, id: `act_${++seq}`, at: Date.now() }, ...s.entries].slice(0, MAX) })),
  clear: () => set({ entries: [] }),
}))

export const ROLE_LABEL: Record<CollabRole, string> = { owner: 'Anfitrión', editor: 'Editor', viewer: 'Solo lectura' }

/** Compara dos instantáneas del store y genera las entradas correspondientes. */
function diff(prev: CollabState, next: CollabState, add: ActivityState['add']) {
  if (prev.status !== next.status) {
    const sys = (text: string) => add({ who: null, color: null, text })
    if (next.status === 'connected' && prev.status !== 'reconnecting' && prev.status !== 'offline')
      sys(next.isHost ? 'Empezaste a compartir el proyecto' : `Te uniste a ${next.session?.projectName ?? 'la sesión'}`)
    if (next.status === 'connected' && (prev.status === 'reconnecting' || prev.status === 'offline')) sys('Conexión recuperada')
    if (next.status === 'reconnecting') sys('Conexión perdida, reconectando…')
    if (next.status === 'kicked') sys('El anfitrión te expulsó de la sesión')
    if (next.status === 'ended') sys('El anfitrión terminó la sesión')
    if (next.status === 'rejected') sys('El anfitrión rechazó tu solicitud')
    if (next.status === 'idle' && prev.status !== 'idle') sys('Saliste de la sesión')
  }
  if (prev.participants === next.participants) return
  // Primera lista al entrar: no es actividad, es el estado inicial.
  if (prev.participants.length === 0) return
  const before = new Map<string, Participant>(prev.participants.map((p) => [p.id, p]))
  const after = new Map<string, Participant>(next.participants.map((p) => [p.id, p]))
  const me = next.me.participantId
  for (const p of next.participants) {
    if (p.id === me) continue
    const old = before.get(p.id)
    const who = { who: p.name, color: p.color, kind: p.kind }
    if (!old) add({ ...who, text: p.status === 'pending' ? 'pide unirse' : 'se unió' })
    else if (old.status === 'pending' && p.status === 'active') add({ ...who, text: 'se unió' })
    else if (old.role !== p.role) add({ ...who, text: `ahora es ${ROLE_LABEL[p.role]}` })
  }
  for (const p of prev.participants) {
    if (p.id === me || after.has(p.id)) continue
    add({ who: p.name, color: p.color, kind: p.kind, text: p.status === 'pending' ? 'ya no espera' : 'salió' })
  }
  if (prev.me.role && next.me.role && prev.me.role !== next.me.role)
    add({ who: null, color: null, text: `Tu rol ahora es ${ROLE_LABEL[next.me.role]}` })
}

/** Engancha el registro al store del cliente. Se monta una vez (en la cabecera). */
export function useActivityTracker() {
  useEffect(() => useCollabStore.subscribe((next, prev) => diff(prev, next, useActivityStore.getState().add)), [])
}

/** Número de entradas, incluidas las de agentes ({t:'activity'}) (para la pestaña del dock). */
export function useActivityCount() {
  const local = useActivityStore((s) => s.entries.length)
  return local + useActivity().length
}
