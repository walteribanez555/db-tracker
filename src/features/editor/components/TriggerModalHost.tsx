import { closeTriggerModal, useEditorUi } from '../lib/editorStore'
import { TriggerFlowModal } from '../lib/triggerModal'

/** Monta el modal de flujo del trigger seleccionado (si la feature triggers lo exporta). */
export function TriggerModalHost() {
  const triggerId = useEditorUi((s) => s.triggerModalId)
  if (!TriggerFlowModal || !triggerId) return null
  return (
    <TriggerFlowModal
      triggerId={triggerId}
      open
      onOpenChange={(open) => !open && closeTriggerModal()}
      onSwitchTrigger={(id) => useEditorUi.getState().setTriggerModalId(id)}
    />
  )
}
