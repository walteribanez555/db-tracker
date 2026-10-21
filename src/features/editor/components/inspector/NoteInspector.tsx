import { Textarea } from '@/components/ui/textarea'
import type { Note } from '@/types/schema'

import { deleteSelection, updateNote } from '../../lib/actions'
import { NOTE_COLORS } from '../../lib/constants'
import { ColorSwatches } from '../ColorSwatches'
import { Field, InspectorHeader, InspectorSection } from './primitives'

export function NoteInspector({ note }: { note: Note }) {
  return (
    <>
      <InspectorHeader kind="Nota" title={note.text.split('\n')[0] || 'Sin texto'} onDelete={deleteSelection} />
      <InspectorSection title="Nota" id="note">
        <Field label="Texto" htmlFor="note-text">
          <Textarea
            id="note-text"
            value={note.text}
            onChange={(e) => updateNote(note.id, { text: e.target.value })}
            rows={8}
            className="text-sm"
          />
        </Field>
        <Field label="Color">
          <ColorSwatches colors={NOTE_COLORS} value={note.color} onChange={(color) => updateNote(note.id, { color })} />
        </Field>
      </InspectorSection>
    </>
  )
}
