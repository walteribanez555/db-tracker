import { CircleCheck, Wand } from 'lucide-react'
import { useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { analyzeSchema, describeFix } from '@/features/normalization/lib/rules'
import { useProjectStore } from '@/store/project'

import { applyNormalizationFix } from '../../lib/canvasActions'

const SEVERITY_COLOR = { alta: 'bg-red-500', media: 'bg-amber-500', baja: 'bg-muted-foreground' } as const

/** Hallazgos de normalización de una tabla con su corrección aplicable en el sitio. */
export function NormalizationPanel({ tableId }: { tableId: string }) {
  const draft = useProjectStore((s) => s.draft)
  const table = draft.tables.find((t) => t.id === tableId)
  const findings = useMemo(() => analyzeSchema(draft).filter((f) => f.tableId === tableId && !f.viewId), [draft, tableId])

  return (
    <div className="grid gap-2">
      <div>
        <div className="text-sm font-medium">Normalización</div>
        <div className="font-mono text-xs text-muted-foreground">{table?.name}</div>
      </div>
      {findings.length === 0 && (
        <p className="flex items-center gap-1.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CircleCheck className="size-3.5" />
          Sin hallazgos para esta tabla.
        </p>
      )}
      <ul className="-mx-2.5 max-h-80 overflow-y-auto">
        {findings.map((f) => {
          const description = f.fix ? describeFix(draft, f.fix) : null
          return (
            <li key={f.id} className="grid gap-1 border-t px-2.5 py-2.5">
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${SEVERITY_COLOR[f.severity]}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{f.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {f.level} · severidad {f.severity}
                  </div>
                </div>
              </div>
              <p className="pl-3.5 text-xs text-muted-foreground">{f.suggestion}</p>
              {f.fix && description && (
                <div className="pl-3.5">
                  <Button variant="outline" size="xs" onClick={() => void applyNormalizationFix(f.fix!, description)} title={description}>
                    <Wand />
                    Aplicar corrección
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
