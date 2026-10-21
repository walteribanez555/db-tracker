import { ReactFlowProvider } from '@xyflow/react'
import { Workflow } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router'

import { CollapsiblePanel } from '@/components/layout/collapsible-panel'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createSampleSchema } from '@/features/normalization/lib/sample'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'

import { TriggerCanvas } from './components/Canvas'
import { Inspector } from './components/Inspector'
import { Palette } from './components/Palette'
import { Simulator } from './components/Simulator'
import { SqlPanel } from './components/SqlPanel'
import { TriggerFlowModal } from './components/TriggerFlowModal'
import { useCanvasUi } from './store'

export { TriggerFlowModal } from './components/TriggerFlowModal'
export type { TriggerFlowModalProps } from './components/TriggerFlowModal'

/** Modal del trigger conectado al estado del lienzo de /triggers. */
function CanvasTriggerModal() {
  const modal = useCanvasUi((s) => s.flowModal)
  const close = useCanvasUi((s) => s.closeFlowModal)
  const openFlowModal = useCanvasUi((s) => s.openFlowModal)
  return (
    <TriggerFlowModal
      key={modal ? `${modal.triggerId}:${modal.tab ?? ''}` : 'none'}
      triggerId={modal?.triggerId ?? null}
      open={!!modal}
      initialTab={modal?.tab}
      onOpenChange={(o) => !o && close()}
      onSwitchTrigger={(id) => openFlowModal(id, 'detalles')}
    />
  )
}

const TAB_FADE = 'data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-200 motion-reduce:animate-none'

export function TriggersView() {
  const hasTables = useProjectStore((s) => s.draft.tables.length > 0)
  const replaceDraft = useProjectStore((s) => s.replaceDraft)
  const [tab, setTab] = useState<'inspector' | 'simulador'>('inspector')
  const showSimulator = useCallback(() => setTab('simulador'), [])

  if (!hasTables)
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <Workflow className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-medium">Triggers y funciones</h1>
        <p className="text-sm text-muted-foreground">
          Los triggers se enganchan a tablas. Crea alguna en el Diagrama o carga un esquema de ejemplo con pedidos, auditoría y una vista materializada.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/editor">Ir al Diagrama</Link>
          </Button>
          <Button onClick={() => replaceDraft(createSampleSchema())}>Cargar ejemplo</Button>
        </div>
      </div>
    )

  return (
    <ReactFlowProvider>
      <div className="flex h-full min-h-0">
        <CollapsiblePanel side="left" width={240} title="Paleta" storageKey="triggers-palette" shortcut="[">
          <Palette />
        </CollapsiblePanel>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <TriggerCanvas onSimulate={showSimulator} />
          </div>
          <SqlPanel />
        </div>
        <CollapsiblePanel side="right" width={320} title="Inspector y simulador" storageKey="triggers-inspector" shortcut="]">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex h-full min-h-0 flex-col gap-0">
            <div className="border-b px-3 pb-1">
              <TabsList variant="line">
                <TabsTrigger value="inspector">Inspector</TabsTrigger>
                <TabsTrigger value="simulador">Simulador</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="inspector" className={cn('min-h-0 overflow-y-auto', TAB_FADE)}>
              <Inspector onSimulate={showSimulator} />
            </TabsContent>
            <TabsContent value="simulador" className={cn('flex min-h-0 flex-col', TAB_FADE)}>
              <Simulator />
            </TabsContent>
          </Tabs>
        </CollapsiblePanel>
      </div>
      <CanvasTriggerModal />
    </ReactFlowProvider>
  )
}
