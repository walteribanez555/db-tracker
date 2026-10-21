import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'
import { emptySchema, useProjectStore } from '@/store/project'
import type { Schema } from '@/types/schema'

import { useEditorUi } from './editorStore'

export type ChangeKind = 'added' | 'modified'

/** Cambios sin confirmar del borrador respecto a la versión base, por id. */
export interface ChangeSet {
  tables: Map<string, ChangeKind>
  columns: Map<string, ChangeKind>
  relations: Map<string, ChangeKind>
  views: Map<string, ChangeKind>
  triggers: Map<string, ChangeKind>
}

const sig = (v: unknown) => JSON.stringify(v)
const noPosition = <T extends { position?: unknown }>(v: T) => sig({ ...v, position: undefined })

function compare<T extends { id: string }>(base: T[], next: T[], same: (a: T, b: T) => boolean) {
  const prev = new Map(base.map((x) => [x.id, x]))
  const out = new Map<string, ChangeKind>()
  for (const x of next) {
    const o = prev.get(x.id)
    if (!o) out.set(x.id, 'added')
    else if (!same(o, x)) out.set(x.id, 'modified')
  }
  return out
}

export function computeChanges(base: Schema, draft: Schema): ChangeSet {
  const columns = new Map<string, ChangeKind>()
  const tables = new Map<string, ChangeKind>()
  const prevTables = new Map(base.tables.map((t) => [t.id, t]))
  for (const t of draft.tables) {
    const o = prevTables.get(t.id)
    if (!o) {
      tables.set(t.id, 'added')
      for (const c of t.columns) columns.set(c.id, 'added')
      continue
    }
    const cols = compare(o.columns, t.columns, (a, b) => sig(a) === sig(b))
    cols.forEach((v, k) => columns.set(k, v))
    const props = o.name !== t.name || o.color !== t.color || o.comment !== t.comment || sig(o.indexes) !== sig(t.indexes)
    const removed = o.columns.some((c) => !t.columns.some((x) => x.id === c.id))
    const reordered = sig(o.columns.map((c) => c.id)) !== sig(t.columns.map((c) => c.id))
    if (props || removed || reordered || cols.size) tables.set(t.id, 'modified')
  }
  return {
    tables,
    columns,
    relations: compare(base.relations, draft.relations, (a, b) => sig(a) === sig(b)),
    views: compare(base.views ?? [], draft.views, (a, b) => noPosition(a) === noPosition(b)),
    triggers: compare(base.triggers, draft.triggers, (a, b) => noPosition(a) === noPosition(b)),
  }
}

const EMPTY: ChangeSet = { tables: new Map(), columns: new Map(), relations: new Map(), views: new Map(), triggers: new Map() }

/** Cambios sin confirmar (vacío si el resaltado está desactivado). */
export function useChangeSet(): ChangeSet {
  const draft = useProjectStore((s) => s.draft)
  const base = useProjectStore((s) => (s.baseVersionId ? s.project.versions.find((v) => v.id === s.baseVersionId)?.schema : undefined))
  const dialect = useProjectStore((s) => s.project.dialect)
  const enabled = useEditorUi((s) => s.showChanges)
  return useMemo(() => (enabled ? computeChanges(base ?? emptySchema(dialect), draft) : EMPTY), [enabled, base, dialect, draft])
}

/**
 * Devuelve una clave que aumenta cada vez que cambia `signature` (no al montar).
 * Se usa como `key` de un overlay con animación para que el destello se repita en cada edición.
 */
export function useFlashKey(signature: string) {
  const [state, setState] = useState({ signature, key: 0 })
  if (state.signature !== signature) setState({ signature, key: state.key + 1 })
  return state.signature === signature ? state.key : state.key + 1
}

/** Contorno punteado para elementos nuevos sin confirmar (con transición al desaparecer). */
export const addedOutline = (change?: ChangeKind) =>
  cn(
    'outline-2 outline-offset-2 outline-dashed transition-[outline-color,border-color,box-shadow] duration-300 ease-out',
    change === 'added' ? 'outline-brand/60' : 'outline-transparent',
  )
