import { ReactFlowProvider } from '@xyflow/react'
import { PanelBottomOpen, PanelLeftOpen, Workflow } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router'

import { CollapsiblePanel, PanelSheetTrigger, usePanelSheet } from '@/components/layout/collapsible-panel'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createSampleSchema } from '@/features/normalization/lib/sample'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'

import { TriggerCanvas } from './components/Canvas'
import { Inspector } from './components/Inspector'
import { Palette, TemplateDialogHost } from './components/Palette'
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

const PALETTE_KEY = 'triggers-palette'
const INSPECTOR_KEY = 'triggers-inspector'

/** Botón flotante (44 px) sobre el lienzo móvil para abrir una hoja. */
const FLOAT_BUTTON =
  'absolute top-2 z-10 inline-flex h-11 items-center gap-1.5 rounded-lg border bg-background/95 px-3 text-sm font-medium text-foreground backdrop-blur [&_svg]:size-4 [&_svg]:text-muted-foreground'

/** Móvil: controles del inspector y del simulador de al menos 40 px (sin tocar los componentes). */
const TOUCH_TARGETS =
  'max-md:[&_[data-slot=button]]:min-h-10 max-md:[&_[data-slot=button][data-size^=icon]]:min-w-10 max-md:[&_[data-slot=toggle-group-item]]:min-h-10 max-md:[&_[data-slot=select-trigger]]:min-h-10'

const TAB_FADE = 'data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-200 motion-reduce:animate-none'

export function TriggersView() {
  const hasTables = useProjectStore((s) => s.draft.tables.length > 0)
  const replaceDraft = useProjectStore((s) => s.replaceDraft)
  const [tab, setTab] = useState<'inspector' | 'simulador'>('inspector')
  // Móvil: el lienzo ocupa todo; paleta (hoja izquierda) e inspector/simulador (hoja inferior) se abren aparte.
  const isMobile = useIsMobile()
  const { setOpen: setInspectorOpen } = usePanelSheet(INSPECTOR_KEY)
  const showSimulator = useCallback(() => {
    setTab('simulador')
    if (isMobile) setInspectorOpen(true)
  }, [isMobile, setInspectorOpen])
  const showInspector = useCallback(() => {
    setTab('inspector')
    setInspectorOpen(true)
  }, [setInspectorOpen])

  if (!hasTables)
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <Workflow className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-medium">Triggers y funciones</h1>
        <p className="text-sm text-muted-foreground">
          Los triggers se enganchan a tablas. Crea alguna en el Diagrama o carga un esquema de ejemplo con pedidos, auditoría y una vista materializada.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="max-md:h-11" asChild>
            <Link to="/editor">Ir al Diagrama</Link>
          </Button>
          <Button className="max-md:h-11" onClick={() => replaceDraft(createSampleSchema())}>Cargar ejemplo</Button>
        </div>
      </div>
    )

  return (
    <ReactFlowProvider>
      <div className="flex h-full min-h-0">
        <CollapsiblePanel side="left" width={240} title="Paleta" storageKey={PALETTE_KEY} shortcut="[" mobileTrigger={false}>
          <Palette />
        </CollapsiblePanel>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <TriggerCanvas onSimulate={showSimulator} onInspect={isMobile ? showInspector : undefined} />
            {isMobile && (
              <>
                <PanelSheetTrigger storageKey={PALETTE_KEY} title="Paleta" asChild>
                  <button type="button" className={cn(FLOAT_BUTTON, 'left-2')}>
                    <PanelLeftOpen />
                    Paleta
                  </button>
                </PanelSheetTrigger>
                <PanelSheetTrigger storageKey={INSPECTOR_KEY} title="Inspector y simulador" asChild>
                  <button type="button" className={cn(FLOAT_BUTTON, 'right-2')}>
                    <PanelBottomOpen />
                    {tab === 'simulador' ? 'Simulador' : 'Inspector'}
                  </button>
                </PanelSheetTrigger>
              </>
            )}
          </div>
          <SqlPanel />
        </div>
        <CollapsiblePanel
          side="right"
          width={320}
          title="Inspector y simulador"
          storageKey={INSPECTOR_KEY}
          shortcut="]"
          mobileSide="bottom"
          mobileTrigger={false}
          mobileSheetClassName="data-[side=bottom]:h-[75svh]"
        >
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className={cn('flex h-full min-h-0 flex-col gap-0', TOUCH_TARGETS)}>
            <div className="border-b px-3 pb-1">
              <TabsList variant="line" className="max-md:h-11">
                <TabsTrigger value="inspector" className="max-md:px-3">
                  Inspector
                </TabsTrigger>
                <TabsTrigger value="simulador" className="max-md:px-3">
                  Simulador
                </TabsTrigger>
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
      {isMobile && <TemplateDialogHost />}
    </ReactFlowProvider>
  )
}
