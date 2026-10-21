import { Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { Eye, KeyRound, Link2, Network, Wand2 } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { CodeEditor } from '@/components/code'
import { ActionMenu, type ActionGroup } from '@/components/flow/action-menu'
import { ACTION_MENU_GESTURE_LABEL, useActionMenuTrigger } from '@/components/flow/use-action-menu'
import { useTheme } from '@/components/theme/theme-provider'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { DataMigrationHint } from '@/types/schema'

import type { PreviewSide, PreviewTable } from '../lib/preview'

type MiniNode = Node<{ table: PreviewTable }, 'mini'>

const STATE_LABEL: Record<PreviewTable['state'], string> = { same: '', new: 'nueva', renamed: 'renombrada', removed: 'eliminada' }

const MiniTable = memo(function MiniTable({ data }: NodeProps<MiniNode>) {
  const { table } = data
  return (
    <div
      className={cn(
        'w-52 rounded-md border bg-card text-[11px] text-card-foreground',
        table.isView && 'border-dashed',
        table.state === 'new' && 'border-emerald-600/60 dark:border-emerald-400/60',
        table.state === 'removed' && 'opacity-60',
      )}
    >
      <Handle type="target" position={Position.Left} className="!invisible" />
      <Handle type="source" position={Position.Right} className="!invisible" />
      <div className={cn('flex items-center gap-1.5 border-b px-2 py-1', table.isView && 'border-dashed')}>
        {table.isView && <Eye className="size-3 text-cyan-600 dark:text-cyan-400" aria-hidden />}
        <span className={cn('truncate font-medium', table.state === 'removed' && 'line-through')}>{table.name}</span>
        {table.state !== 'same' && (
          <span className={cn('ml-auto shrink-0', table.state === 'new' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
            {STATE_LABEL[table.state]}
          </span>
        )}
      </div>
      {table.previousName && <p className="border-b px-2 py-0.5 text-muted-foreground">antes: {table.previousName}</p>}
      <ul className="py-0.5">
        {table.columns.map((c, i) => (
          <li
            key={`${c.id}-${i}`}
            className={cn(
              'flex items-center gap-1 px-2 py-px',
              c.state === 'removed' && 'text-destructive line-through decoration-destructive/60',
              c.state === 'added' && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400',
              c.state === 'changed' && 'bg-amber-500/10 text-amber-800 dark:text-amber-400',
            )}
            title={c.previous ? `antes: ${c.previous}` : undefined}
          >
            <span className="w-3 shrink-0">
              {c.pk ? <KeyRound className="size-2.5 text-amber-600 dark:text-amber-400" aria-label="PK" /> : c.fk ? <Link2 className="size-2.5 text-muted-foreground" aria-label="FK" /> : null}
            </span>
            <span className="truncate">
              {c.state === 'added' && '+ '}
              {c.name}
            </span>
            <span className="ml-auto truncate pl-1 font-mono text-[10px] opacity-70">{c.type}</span>
          </li>
        ))}
        {table.indexes.map((i, n) => (
          <li
            key={`idx-${i.name}-${n}`}
            className={cn(
              'truncate px-2 py-px text-[10px]',
              i.added ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400' : 'text-muted-foreground',
            )}
          >
            {i.added && '+ '}índice {i.name}
          </li>
        ))}
      </ul>
    </div>
  )
})

const nodeTypes = { mini: MiniTable }

function MiniDiagram({
  side,
  label,
  onApply,
  applyLabel,
  delay = 0,
}: {
  side: PreviewSide
  label: string
  onApply?: () => void
  applyLabel?: string
  delay?: number
}) {
  const { resolved } = useTheme()
  const navigate = useNavigate()
  const draft = useProjectStore((s) => s.draft)
  const menu = useActionMenuTrigger<PreviewTable>()
  const target = menu.target
  const groups: ActionGroup[] = useMemo(() => {
    if (!target) return []
    const isTable = draft.tables.some((t) => t.id === target.id)
    const isView = (draft.views ?? []).some((v) => v.id === target.id)
    return [
      {
        id: 'nav',
        label: target.name,
        items: [
          {
            id: 'see',
            label: 'Ver en el diagrama',
            icon: Network,
            disabled: !isTable && !isView,
            hint: !isTable && !isView ? 'aún no existe' : undefined,
            onSelect: () => {
              navigate('/editor')
              useProjectStore.getState().setSelection({ kind: isView ? 'view' : 'table', id: target.id })
            },
          },
        ],
      },
      {
        id: 'apply',
        items: [{ id: 'apply', label: 'Aplicar solo este cambio', icon: Wand2, disabled: !onApply, hint: applyLabel, onSelect: () => onApply?.() }],
      },
    ]
  }, [target, draft, navigate, onApply, applyLabel])

  const { nodes, edges } = useMemo(() => {
    const nodes: MiniNode[] = side.tables.map((t, i) => ({ id: t.id, type: 'mini', position: { x: i * 250, y: (i % 2) * 30 }, data: { table: t } }))
    const edges: Edge[] = side.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: e.id.includes('->') ? { strokeDasharray: '1 5', strokeLinecap: 'round' } : undefined,
    }))
    return { nodes, edges }
  }, [side])

  return (
    <figure
      className="min-w-0 animate-in fade-in zoom-in-95 fill-mode-both duration-300 ease-out motion-reduce:animate-none"
      style={{ animationDelay: `${delay}ms` }}
    >
      <figcaption className="mb-1.5 text-xs text-muted-foreground">{label}</figcaption>
      <div className="h-64 rounded-md border bg-canvas">
        {nodes.length ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            preventScrolling={false}
            minZoom={0.3}
            colorMode={resolved}
            style={{ backgroundColor: 'transparent' }}
            aria-label={label}
            // Un manejador de clic hace los nodos interactivos (si no, React Flow les quita los eventos de puntero).
            onNodeClick={() => {}}
            onNodeContextMenu={(e, n) => void menu.handleContextMenu(e, n.data.table)}
            onPaneContextMenu={(e) => e.preventDefault()}
          />
        ) : (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">Sin tablas afectadas</p>
        )}
      </div>
      <ActionMenu {...menu.menuProps} groups={groups} />
    </figure>
  )
}

function MigrationHints({ hints }: { hints: DataMigrationHint[] }) {
  const schema = useProjectStore((s) => s.draft)
  if (!hints.length) return null
  return (
    <div className="space-y-2 animate-in fade-in fill-mode-both delay-200 duration-300 motion-reduce:animate-none">
      <p className="text-xs font-medium">Copiar datos</p>
      {hints.map((h) => (
        <CodeEditor
          key={h.id}
          value={h.sql}
          language="pgsql"
          readOnly
          height="auto"
          minHeight={60}
          maxHeight={320}
          filename="copiar-datos.sql"
          schema={schema}
          statusBar={false}
          ariaLabel={h.description}
          actions={
            <>
              <span className="mr-1 hidden max-w-80 truncate text-xs text-muted-foreground sm:inline">{h.description}</span>
              <button
                type="button"
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() =>
                  navigator.clipboard.writeText(h.sql).then(
                    () => toast.success('SQL copiado'),
                    () => toast.error('No se pudo copiar'),
                  )
                }
              >
                Copiar
              </button>
            </>
          }
        />
      ))}
      <p className="text-xs text-muted-foreground">
        Se guarda con el esquema y la migración lo ejecuta tras crear las tablas y columnas, antes de eliminar las de origen.
      </p>
    </div>
  )
}

export function BeforeAfter({
  before,
  after,
  migrations = [],
  onApply,
  applyLabel,
}: {
  before: PreviewSide
  after: PreviewSide
  migrations?: DataMigrationHint[]
  /** Aplica en el borrador solo la corrección de este hallazgo. */
  onApply?: () => void
  applyLabel?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid gap-4 lg:grid-cols-2">
        <MiniDiagram side={before} label="Antes" onApply={onApply} applyLabel={applyLabel} />
        <MiniDiagram side={after} label="Después" onApply={onApply} applyLabel={applyLabel} delay={120} />
      </div>
      <p className="text-xs text-muted-foreground">{ACTION_MENU_GESTURE_LABEL} sobre una tabla: verla en el diagrama o aplicar solo este cambio.</p>
      <MigrationHints hints={migrations} />
    </div>
  )
}
