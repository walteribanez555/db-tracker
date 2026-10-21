import { useSharedText } from '@/collab'

import { CodeEditor } from './index'
import type { CodeEditorProps } from './types'

export interface SharedCodeEditorProps extends CodeEditorProps {
  /** Texto compartido en la sesión colaborativa (SQL de una vista o cuerpo de una función). */
  shared: { kind: 'view-definition' | 'function-body'; id: string }
}

/**
 * CodeEditor que, durante una sesión colaborativa, se enlaza con el Y.Text compartido:
 * edición simultánea con cursores remotos. Fuera de sesión se comporta como CodeEditor.
 */
export function SharedCodeEditor({ shared, ...props }: SharedCodeEditorProps) {
  const sharedText = useSharedText(shared.kind, shared.id)
  return <CodeEditor {...props} sharedText={sharedText ?? undefined} />
}
