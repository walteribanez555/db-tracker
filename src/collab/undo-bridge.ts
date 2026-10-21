// Puente ligero (sin Yjs) entre el historial del editor y el UndoManager de la sesión colaborativa.
// En sesión, deshacer/rehacer solo afecta a los cambios propios; los de otros participantes se respetan.
import { create } from 'zustand'

export interface CollabUndoHandler {
  undo(): void
  redo(): void
}

interface CollabUndoState {
  active: boolean
  canUndo: boolean
  canRedo: boolean
}

export const useCollabUndoState = create<CollabUndoState>(() => ({ active: false, canUndo: false, canRedo: false }))

let handler: CollabUndoHandler | null = null

export function setCollabUndo(next: CollabUndoHandler | null) {
  handler = next
  useCollabUndoState.setState({ active: !!next, canUndo: false, canRedo: false })
}

export const getCollabUndo = () => handler

export const setCollabUndoAvailability = (canUndo: boolean, canRedo: boolean) =>
  useCollabUndoState.setState({ canUndo, canRedo })
