import { useMemo } from 'react'

import { diffSchemas, relationLabel } from '@/lib/diff'
import { cn } from '@/lib/utils'
import type { Column, Schema, Table, Version } from '@/types/schema'

import { DIFF_TEXT, fmtDate, type DiffKind } from '../lib'
import { DiffSummary } from './DiffList'

const SIGN: Record<DiffKind | 'same', string> = { add: '+', remove: '−', change: '~', same: ' ' }
const SR: Record<DiffKind | 'same', string> = { add: 'añadido', remove: 'eliminado', change: 'cambiado', same: '' }

function colDesc(c: Column) {
  const flags = [c.pk && 'PK', !c.nullable && 'NOT NULL', c.unique && 'UNIQUE', c.default && `= ${c.default}`].filter(Boolean)
  return `${c.type}${flags.length ? ` ${flags.join(' ')}` : ''}`
}

const sameCol = (a: Column, b: Column) =>
  a.name === b.name &&
  a.type === b.type &&
  a.pk === b.pk &&
  a.nullable === b.nullable &&
  a.unique === b.unique &&
  a.autoIncrement === b.autoIncrement &&
  (a.default ?? '') === (b.default ?? '')

function Row({ kind, children }: { kind: DiffKind | 'same'; children: React.ReactNode }) {
  return (
    <li className={cn('flex gap-2 font-mono text-xs leading-5', kind === 'same' ? 'text-foreground/80' : DIFF_TEXT[kind])}>
      <span aria-hidden className="w-3 shrink-0 text-center font-semibold">
        {SIGN[kind]}
      </span>
      {kind !== 'same' && <span className="sr-only">{SR[kind]}: </span>}
      <span className="min-w-0 break-words">{children}</span>
    </li>
  )
}

/** Bloque de una tabla en un lado del diff. `side` decide qué se marca (eliminado a la izquierda, añadido a la derecha). */
function TableBlock({ table, other, side }: { table?: Table; other?: Table; side: 'left' | 'right' }) {
  if (!table) return <div className="px-3 py-2 text-xs text-muted-foreground italic">— no existe —</div>
  const tableKind: DiffKind | 'same' = !other ? (side === 'left' ? 'remove' : 'add') : other.name !== table.name ? 'change' : 'same'
  const otherCols = new Map((other?.columns ?? []).map((c) => [c.id, c]))
  return (
    <div className="px-3 py-2">
      <ul>
        <Row kind={tableKind}>
          <span className="font-semibold">{table.name}</span>
        </Row>
      </ul>
      <ul className="mt-0.5 ml-3">
        {table.columns.map((c) => {
          const o = otherCols.get(c.id)
          const kind: DiffKind | 'same' = !other ? 'same' : !o ? (side === 'left' ? 'remove' : 'add') : sameCol(c, o) ? 'same' : 'change'
          return (
            <Row key={c.id} kind={kind}>
              {c.name} <span className="text-muted-foreground">{colDesc(c)}</span>
            </Row>
          )
        })}
      </ul>
    </div>
  )
}

interface Item {
  id: string
  label: string
  /** Firma para detectar cambios con el mismo id. */
  sig: string
}

function ListBlock({ items, others, side }: { items: Item[]; others: Map<string, string>; side: 'left' | 'right' }) {
  if (!items.length) return <div className="px-3 py-2 text-xs text-muted-foreground italic">— ninguno —</div>
  return (
    <ul className="px-3 py-2">
      {items.map((i) => (
        <Row key={i.id} kind={!others.has(i.id) ? (side === 'left' ? 'remove' : 'add') : others.get(i.id) === i.sig ? 'same' : 'change'}>
          {i.label}
        </Row>
      ))}
    </ul>
  )
}

const relItems = (s: Schema): Item[] => s.relations.map((r) => ({ id: r.id, label: relationLabel(r, s), sig: relationLabel(r, s) }))
const trgItems = (s: Schema): Item[] =>
  s.triggers.map((t) => {
    const fn = s.functions.find((f) => f.id === t.functionId)?.name ?? '?'
    const label = `${t.name} · ${t.timing} ${t.events.join('/')} ON ${s.tables.find((x) => x.id === t.tableId)?.name ?? '?'} → ${fn}()${t.condition ? ` WHEN ${t.condition}` : ''}${t.enabled === false ? ' [desactivado]' : ''}`
    return { id: t.id, label, sig: label }
  })
const viewItems = (s: Schema): Item[] =>
  (s.views ?? []).map((v) => ({
    id: v.id,
    label: `${v.name}${v.materialized ? ' (materializada)' : ''} · ${v.columns.map((c) => c.name).join(', ')}`,
    sig: `${v.name}|${v.materialized}|${v.definition.replace(/\s+/g, ' ').trim()}`,
  }))
const sigs = (items: Item[]) => new Map(items.map((i) => [i.id, i.sig]))

/** Comparación lado a lado de dos versiones (izquierda = base, derecha = destino). */
export function SideBySideDiff({ left, right, leftLabel, rightLabel }: { left: Version; right: Version; leftLabel: string; rightLabel: string }) {
  const diff = useMemo(() => diffSchemas(left.schema, right.schema), [left, right])
  const rows = useMemo(() => {
    const L = new Map(left.schema.tables.map((t) => [t.id, t]))
    const R = new Map(right.schema.tables.map((t) => [t.id, t]))
    const ids = [...left.schema.tables.map((t) => t.id), ...right.schema.tables.filter((t) => !L.has(t.id)).map((t) => t.id)]
    return ids.map((id) => ({ id, l: L.get(id), r: R.get(id) }))
  }, [left, right])

  const lRel = relItems(left.schema)
  const rRel = relItems(right.schema)
  const lTrg = trgItems(left.schema)
  const rTrg = trgItems(right.schema)
  const lView = viewItems(left.schema)
  const rView = viewItems(right.schema)

  return (
    <div className="space-y-3">
      <DiffSummary diff={diff} />
      <div className="overflow-hidden rounded-md border">
        <div className="grid grid-cols-2 divide-x border-b bg-muted/40 text-xs">
          <div className="px-3 py-2">
            <div className="font-medium">{leftLabel}</div>
            <div className="text-muted-foreground">{fmtDate(left.createdAt)}</div>
          </div>
          <div className="px-3 py-2">
            <div className="font-medium">{rightLabel}</div>
            <div className="text-muted-foreground">{fmtDate(right.createdAt)}</div>
          </div>
        </div>
        {rows.map(({ id, l, r }) => (
          <div key={id} className="grid grid-cols-2 divide-x border-b last:border-b-0">
            <TableBlock table={l} other={r} side="left" />
            <TableBlock table={r} other={l} side="right" />
          </div>
        ))}
        <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">Relaciones</div>
        <div className="grid grid-cols-2 divide-x border-b">
          <ListBlock items={lRel} others={sigs(rRel)} side="left" />
          <ListBlock items={rRel} others={sigs(lRel)} side="right" />
        </div>
        <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">Vistas</div>
        <div className="grid grid-cols-2 divide-x border-b">
          <ListBlock items={lView} others={sigs(rView)} side="left" />
          <ListBlock items={rView} others={sigs(lView)} side="right" />
        </div>
        <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">Triggers</div>
        <div className="grid grid-cols-2 divide-x">
          <ListBlock items={lTrg} others={sigs(rTrg)} side="left" />
          <ListBlock items={rTrg} others={sigs(lTrg)} side="right" />
        </div>
      </div>
    </div>
  )
}
