import { CircleCheck, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useProjectStore } from '@/store/project'
import type { Column, Table } from '@/types/schema'

import { compareTypes, fkTypeFor } from '../lib/sqlTypes'

interface TypeCompatibilityProps {
  source: { table: Table; column: Column }
  target: { table: Table; column: Column }
}

export function TypeCompatibility({ source, target }: TypeCompatibilityProps) {
  const updateColumn = useProjectStore((s) => s.updateColumn)
  const result = compareTypes(source.column.type, target.column.type)

  if (result === 'ok') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CircleCheck className="size-3.5" />
        Tipos compatibles <span className="font-mono">({source.column.type})</span>
      </p>
    )
  }

  const suggested = fkTypeFor(source.column.type)
  return (
    <div className="flex items-start gap-2 border-l-2 border-amber-400 py-0.5 pl-2.5 text-xs">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="grid gap-1">
        <p className="text-foreground">
          {result === 'similar' ? 'Mismo tipo base con parámetros distintos: ' : 'Tipos distintos: '}
          <span className="font-mono">{source.column.type}</span> vs <span className="font-mono">{target.column.type}</span>
        </p>
        <Button
          variant="link"
          size="xs"
          className="h-auto justify-start p-0 text-xs"
          onClick={() => updateColumn(target.table.id, target.column.id, { type: suggested })}
        >
          Cambiar {target.table.name}.{target.column.name} a <span className="font-mono">{suggested}</span>
        </Button>
      </div>
    </div>
  )
}
