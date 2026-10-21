import { useEffect } from 'react'

import { useProjectStore } from '@/store/project'

import { deleteSelection } from '../lib/actions'
import { copySelection, duplicateTable, pasteClipboard } from '../lib/canvasActions'
import { startEditing, useEditorUi } from '../lib/editorStore'
import { redo, undo } from '../lib/history'
import { openTriggerFlow } from '../lib/triggerModal'
import { useCanvasActions } from './useCanvasActions'

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true
  return Boolean(target.closest('[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],.monaco-editor,.nokey'))
}

/** Abre la edición en línea propia del elemento seleccionado (F2 / Enter). */
function editSelection(rename: boolean) {
  const { selection } = useProjectStore.getState()
  if (!selection) return false
  switch (selection.kind) {
    case 'table':
      if (!rename) return false
      startEditing({ kind: 'table-name', id: selection.id })
      return true
    case 'view':
      startEditing({ kind: 'view-sql', id: selection.id })
      return true
    case 'trigger':
      openTriggerFlow(selection.id)
      return true
    case 'note':
      startEditing({ kind: 'note', id: selection.id })
      return true
    default:
      return false
  }
}

export function useEditorShortcuts() {
  const { addTable, addNote } = useCanvasActions()
  const setTool = useEditorUi((s) => s.setTool)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (mod) {
        if (key === 'z') (e.shiftKey ? redo : undo)()
        else if (key === 'y') redo()
        else if (key === 'c') {
          if (!copySelection()) return
        } else if (key === 'v') void pasteClipboard()
        else if (key === 'd') {
          const { selection } = useProjectStore.getState()
          if (selection?.kind !== 'table') return
          duplicateTable(selection.id)
        } else return
        e.preventDefault()
        return
      }
      if (e.altKey) return

      switch (key) {
        case 'delete':
        case 'backspace':
          e.preventDefault()
          deleteSelection()
          break
        case 'f2':
        case 'enter':
          if (e.target instanceof HTMLElement && e.target.closest('button,a')) break
          if (editSelection(key === 'f2')) e.preventDefault()
          break
        case 't':
          e.preventDefault()
          addTable()
          break
        case 'n': {
          e.preventDefault()
          startEditing({ kind: 'note', id: addNote().id })
          break
        }
        case 'v':
          setTool('select')
          break
        case 'h':
          setTool('hand')
          break
        case 'escape':
          useProjectStore.getState().setSelection(null)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addTable, addNote, setTool])
}
