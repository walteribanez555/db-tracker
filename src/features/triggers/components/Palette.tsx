import { useReactFlow } from '@xyflow/react'
import { LayoutGrid, Plus, SquareFunction, Zap } from 'lucide-react'
import { useState } from 'react'

import { ACTION_MENU_GESTURE_LABEL } from '@/components/flow/use-action-menu'
import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useProjectStore } from '@/store/project'

import { addFunction, addTrigger, applyTemplate, arrangeCanvas, contextRelationId } from '../actions'
import { TEMPLATES, type TriggerTemplate } from '../lib/templates'
import { useCanvasUi, useTriggerLayout } from '../store'


export function Palette() {
  const setTemplate = useCanvasUi((s) => s.setTemplate)
  const onlyInvolved = useTriggerLayout((s) => s.onlyInvolved)
  const setOnlyInvolved = useTriggerLayout((s) => s.setOnlyInvolved)
  const { fitView } = useReactFlow()

  return (
    <div className="flex flex-col" aria-label="Paleta de triggers">
      <CollapsibleSection title="Crear" storageKey="triggers-palette-crear" className="border-b px-1.5 pb-2" contentClassName="px-0.5">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => addTrigger()}>
          <Plus />
          <Zap className="text-amber-600 dark:text-amber-400" />
          Trigger
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => addFunction()}>
          <Plus />
          <SquareFunction className="text-violet-600 dark:text-violet-400" />
          Función
        </Button>
      </CollapsibleSection>

      <CollapsibleSection
        title="Plantillas"
        meta={TEMPLATES.length}
        storageKey="triggers-palette-plantillas"
        className="border-b px-1.5 py-2"
        contentClassName="px-0.5"
      >
        <ul>
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setTemplate({ id: t.id })}
                className="w-full rounded-md px-2 py-1.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="block text-sm">{t.name}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{t.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Lienzo" storageKey="triggers-palette-lienzo" className="px-1.5 py-2" contentClassName="space-y-2 px-0.5 pt-1">
        <div className="flex items-center justify-between gap-2 px-2">
          <Label htmlFor="only-involved" className="text-sm font-normal">
            Solo tablas implicadas
          </Label>
          <Switch id="only-involved" checked={onlyInvolved} onCheckedChange={setOnlyInvolved} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            arrangeCanvas()
            setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50)
          }}
        >
          <LayoutGrid />
          Ordenar en columnas
        </Button>
        <p className="px-2 text-xs leading-snug text-muted-foreground">
          Doble clic sobre un trigger, una función o una vista para editarlo ahí mismo. {ACTION_MENU_GESTURE_LABEL} abre el menú de acciones
          (o Mayús+F10 con un elemento seleccionado). Arrastra de una tabla a un trigger, o de un trigger a una función, para conectarlos.
        </p>
      </CollapsibleSection>

      <TemplateDialogHost />
    </div>
  )
}

/** Diálogo de plantilla controlado por useCanvasUi: lo abren la paleta y el menú de acciones. */
function TemplateDialogHost() {
  const state = useCanvasUi((s) => s.template)
  const setTemplate = useCanvasUi((s) => s.setTemplate)
  const template = state && TEMPLATES.find((t) => t.id === state.id)
  if (!state || !template) return null
  return <TemplateDialog key={`${state.id}:${state.tableId ?? ''}`} template={template} preferredTableId={state.tableId} onClose={() => setTemplate(null)} />
}

function TemplateDialog({ template, preferredTableId, onClose }: { template: TriggerTemplate; preferredTableId?: string; onClose: () => void }) {
  const draft = useProjectStore((s) => s.draft)
  const options = draft.tables.map((t) => ({ table: t, reason: template.unavailable(draft, t.id) }))
  const ctx = preferredTableId ?? contextRelationId()
  const initial = options.find((o) => o.table.id === ctx && !o.reason) ?? options.find((o) => !o.reason)
  const [tableId, setTableId] = useState(initial?.table.id ?? '')
  const selected = options.find((o) => o.table.id === tableId)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plantilla: {template.name}</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-table">Tabla</Label>
          <Select value={tableId} onValueChange={setTableId}>
            <SelectTrigger id="tpl-table" className="w-full">
              <SelectValue placeholder="Elige una tabla" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.table.id} value={o.table.id} disabled={!!o.reason}>
                  {o.table.name}
                  {o.reason && <span className="text-xs text-muted-foreground"> · {o.reason}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!initial && <p className="text-xs text-muted-foreground">Ninguna tabla cumple los requisitos de esta plantilla.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!selected || !!selected.reason}
            onClick={() => {
              applyTemplate(template.id, tableId)
              onClose()
            }}
          >
            Crear función y trigger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
