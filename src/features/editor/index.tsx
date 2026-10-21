import { ReactFlowProvider } from '@xyflow/react'

import { Canvas } from './components/Canvas'
import { Inspector } from './components/inspector/Inspector'
import { Sidebar } from './components/Sidebar'
import { useEditorShortcuts } from './hooks/useEditorShortcuts'
import { useEditorUi } from './lib/editorStore'
import './editor.css'
import './lib/history'

function EditorLayout() {
  const tool = useEditorUi((s) => s.tool)
  useEditorShortcuts()

  return (
    <div className="db-editor flex h-full min-h-0" data-tool={tool}>
      <Sidebar />
      <Canvas />
      <Inspector />
    </div>
  )
}

export function EditorView() {
  return (
    <ReactFlowProvider>
      <EditorLayout />
    </ReactFlowProvider>
  )
}
