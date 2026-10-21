import type { ComponentType } from 'react'

import * as triggersFeature from '@/features/triggers'

import { startEditing, useEditorUi } from './editorStore'

/** Contrato de `TriggerFlowModal` (src/features/triggers/components/TriggerFlowModal.tsx). */
export interface TriggerFlowModalProps {
  triggerId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSwitchTrigger?: (id: string) => void
}

/**
 * Punto de integración con `TriggerFlowModal` (feature triggers): flujo, simulador y detalles.
 * Se resuelve por nombre para no romper la compilación mientras el módulo no lo exporte.
 */
export const TriggerFlowModal = (triggersFeature as unknown as { TriggerFlowModal?: ComponentType<TriggerFlowModalProps> })
  .TriggerFlowModal

/** Abre el modal del trigger o, si aún no está disponible, la edición rápida en línea. */
export function openTriggerFlow(triggerId: string) {
  if (TriggerFlowModal) useEditorUi.getState().setTriggerModalId(triggerId)
  else startEditing({ kind: 'trigger', id: triggerId })
}
