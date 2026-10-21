import { Hand, ImageDown, MousePointer2, Network, Plus, Redo2, StickyNote, Table2, Undo2, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { useCanvasActions } from '../hooks/useCanvasActions'
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
