import type { NodeProps } from '@xyflow/react'
import { StickyNote } from 'lucide-react'
import { memo, useRef, useState, type CSSProperties } from 'react'

import { cn } from '@/lib/utils'

import { updateNote } from '../lib/actions'
import { NOTE_WIDTH } from '../lib/constants'
import { startEditing, stopEditing, useEditing } from '../lib/editorStore'
import type { NoteFlowNode } from '../lib/types'

function NoteEditor({ id, initial }: { id: string; initial: string }) {
  const [text, setText] = useState(initial)
  const done = useRef(false)
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save && text !== initial) updateNote(id, { text })
    stopEditing()
  }
  return (
    <textarea
      autoFocus
      aria-label="Texto de la nota"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') finish(false)
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finish(true)
      }}
      rows={Math.max(3, text.split('\n').length)}
      className="nodrag nopan nowheel w-full resize-none rounded-sm bg-background/60 p-1 leading-relaxed text-foreground outline-none"
    />
  )
}

function NoteNodeComponent({ data, selected }: NodeProps<NoteFlowNode>) {
  const { note } = data
  const editing = useEditing('note', note.id)

  return (
    <div
      className={cn(
        'animate-in fade-in-0 zoom-in-95 duration-200 ease-out motion-reduce:animate-none rounded-md border border-foreground/10 bg-(--note) p-3 text-xs text-[color-mix(in_oklch,var(--note)_15%,black)] shadow-sm dark:bg-[color-mix(in_oklch,var(--note)_18%,var(--card))] dark:text-foreground',
        selected && 'ring-2 ring-brand',
      )}
      style={{ width: NOTE_WIDTH, '--note': note.color } as CSSProperties}
      onDoubleClick={() => startEditing({ kind: 'note', id: note.id })}
    >
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase opacity-60">
        <StickyNote className="size-3" />
        Nota
      </div>
      {editing ? (
        <NoteEditor id={note.id} initial={note.text} />
      ) : (
        <p className="min-h-10 leading-relaxed break-words whitespace-pre-wrap">
          {note.text || <span className="italic opacity-50">Doble clic para escribir…</span>}
        </p>
      )}
    </div>
  )
}

export const NoteNode = memo(NoteNodeComponent)
