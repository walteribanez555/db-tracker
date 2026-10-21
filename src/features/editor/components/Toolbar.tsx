import { Eye, Hand, ImageDown, MousePointer2, Network, PanelLeft, Plus, Redo2, StickyNote, Table2, Undo2, type LucideIcon } from 'lucide-react'

import { PanelSheetTrigger } from '@/components/layout/collapsible-panel'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

import { useCanvasActions } from '../hooks/useCanvasActions'
import { EXPLORER_PANEL_KEY } from '../lib/constants'
import { startEditing, useEditorUi } from '../lib/editorStore'
import { useCollabUndoState } from '@/collab/undo-bridge'

import { redo, undo, useHistoryStore } from '../lib/history'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

interface ToolButtonProps {
  icon: LucideIcon
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function ToolButton({ icon: Icon, label, shortcut, active, disabled, onClick }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(active && 'bg-muted text-foreground')}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
        {shortcut && <span className="text-background/60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

/** Botón táctil (44 px) de la barra móvil: sin tooltip, con nombre accesible. */
function TouchButton({ icon: Icon, label, disabled, onClick }: Omit<ToolButtonProps, 'shortcut' | 'active'>) {
  return (
    <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon className="size-5" />
    </Button>
  )
}

/**
 * Móvil: barra flotante compacta (botones de 44 px, scroll horizontal si no cabe). Abre el explorador
 * en una hoja; sin herramientas Seleccionar/Mano (un dedo en el fondo ya mueve el lienzo).
 */
function MobileToolbar({ canUndo, canRedo }: { canUndo: boolean; canRedo: boolean }) {
  const { addTable, addNote, addView, autoLayout, exportImage } = useCanvasActions()
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-center">
      <div
        role="toolbar"
        aria-label="Herramientas del diagrama"
        className="pointer-events-auto flex max-w-full items-center overflow-x-auto overscroll-x-contain rounded-lg border bg-background/95 p-0.5 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <PanelSheetTrigger storageKey={EXPLORER_PANEL_KEY} title="Explorador" asChild>
          <Button variant="ghost" size="icon" className="size-11 shrink-0" title="Explorador">
            <PanelLeft className="size-5" />
          </Button>
        </PanelSheetTrigger>
        <Separator orientation="vertical" className="mx-0.5 h-6 data-vertical:self-center" />
        <TouchButton icon={Table2} label="Añadir tabla" onClick={addTable} />
        <TouchButton icon={StickyNote} label="Añadir nota" onClick={() => startEditing({ kind: 'note', id: addNote().id })} />
        <TouchButton icon={Eye} label="Añadir vista SQL" onClick={addView} />
        <TouchButton icon={Network} label="Auto-layout" onClick={autoLayout} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label="Exportar imagen" title="Exportar imagen">
              <ImageDown className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem className="min-h-11" onSelect={() => void exportImage('png')}>
              PNG
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => void exportImage('svg')}>
              SVG
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Separator orientation="vertical" className="mx-0.5 h-6 data-vertical:self-center" />
        <TouchButton icon={Undo2} label="Deshacer" disabled={!canUndo} onClick={undo} />
        <TouchButton icon={Redo2} label="Rehacer" disabled={!canRedo} onClick={redo} />
      </div>
    </div>
  )
}

export function Toolbar() {
  const tool = useEditorUi((s) => s.tool)
  const setTool = useEditorUi((s) => s.setTool)
  const collabUndo = useCollabUndoState()
  const localUndo = useHistoryStore((s) => s.past.length > 0)
  const localRedo = useHistoryStore((s) => s.future.length > 0)
  // En sesión colaborativa, deshacer/rehacer solo cubre los cambios propios (UndoManager de Yjs).
  const canUndo = collabUndo.active ? collabUndo.canUndo : localUndo
  const canRedo = collabUndo.active ? collabUndo.canRedo : localRedo
  const { addTable, addNote, addView, autoLayout, exportImage } = useCanvasActions()
  const isMobile = useIsMobile()

  if (isMobile) return <MobileToolbar canUndo={canUndo} canRedo={canRedo} />

  return (
    <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border bg-background/95 p-1 shadow-sm backdrop-blur">
      <ToolButton icon={MousePointer2} label="Seleccionar" shortcut="V" active={tool === 'select'} onClick={() => setTool('select')} />
      <ToolButton icon={Hand} label="Mano" shortcut="H" active={tool === 'hand'} onClick={() => setTool('hand')} />
      <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
      <ToolButton icon={Table2} label="Añadir tabla" shortcut="T" onClick={addTable} />
      <ToolButton icon={StickyNote} label="Añadir nota" shortcut="N" onClick={() => startEditing({ kind: 'note', id: addNote().id })} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={addView} className="px-2">
            <Plus />
            Vista
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Añadir vista SQL
        </TooltipContent>
      </Tooltip>
      <ToolButton icon={Network} label="Auto-layout" onClick={autoLayout} />
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Exportar imagen">
                <ImageDown />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Exportar imagen
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="center" className="w-36">
          <DropdownMenuItem onSelect={() => void exportImage('png')}>PNG</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportImage('svg')}>SVG</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
      <ToolButton icon={Undo2} label="Deshacer" shortcut={`${MOD}Z`} disabled={!canUndo} onClick={undo} />
      <ToolButton icon={Redo2} label="Rehacer" shortcut={`${MOD}⇧Z`} disabled={!canRedo} onClick={redo} />
    </div>
  )
}
