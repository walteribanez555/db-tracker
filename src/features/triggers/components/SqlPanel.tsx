import { Check, ChevronUp, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { CodeEditor, sqlLanguageFor } from '@/components/code'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'
import type { Dialect } from '@/types/schema'

import { dialectWarnings, generateTriggerSQL, generateViewSQL } from '../lib/sql'
import { useTriggerLayout } from '../store'

export function SqlPanel() {
  const draft = useProjectStore((s) => s.draft)
  const open = useTriggerLayout((s) => s.sqlOpen)
  const setOpen = useTriggerLayout((s) => s.setSqlOpen)
  const [dialect, setDialect] = useState<Dialect>(draft.dialect === 'mysql' ? 'mysql' : 'postgresql')
  const [copied, setCopied] = useState(false)

  // Siempre "Todo": el SQL de un trigger concreto se ve en su modal, no aquí.
  const { sql, warnings } = useMemo(() => {
    const views = (draft.views ?? []).map((v) => generateViewSQL(v, dialect))
    const body = generateTriggerSQL(draft, { dialect, includeFunctions: true })
    return { sql: [...views, body].filter((x) => x.trim()).join('\n\n'), warnings: dialectWarnings(draft, dialect) }
  }, [draft, dialect])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql)
      setCopied(true)
      toast.success('SQL copiado al portapapeles')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  return (
    <section className="shrink-0 border-t bg-background" aria-label="SQL generado">
      <div className="flex h-10 items-center gap-2 px-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="triggers-sql-body">
          <ChevronUp className={cn('transition-transform duration-200 ease-out motion-reduce:transition-none', open && 'rotate-180')} />
          SQL generado
        </Button>
        {open && (
          <div className="flex flex-1 items-center gap-2 animate-in fade-in duration-200 motion-reduce:animate-none">
            <span className="text-xs text-muted-foreground">Todo el esquema · vistas, funciones y triggers</span>
            <Select value={dialect} onValueChange={(v) => setDialect(v as Dialect)}>
              <SelectTrigger size="sm" aria-label="Dialecto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="postgresql">PostgreSQL</SelectItem>
                <SelectItem value="mysql">MySQL</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={copy} disabled={!sql}>
              {copied ? <Check /> : <Copy />}
              Copiar
            </Button>
          </div>
        )}
      </div>
      <div
        id="triggers-sql-body"
        inert={!open}
        aria-hidden={!open}
        className={cn(
          'flex flex-col overflow-hidden border-t transition-[height,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none',
          open ? 'h-72 opacity-100' : 'h-0 border-t-0 opacity-0',
        )}
      >
        {warnings.length > 0 && (
          <ul className="max-h-16 shrink-0 space-y-0.5 overflow-y-auto border-b px-4 py-2 text-xs text-amber-700 dark:text-amber-400" role="status">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {sql ? (
          open && (
            <div className="min-h-0 flex-1">
              <CodeEditor
                value={sql}
                language={sqlLanguageFor(dialect)}
                readOnly
                height={warnings.length ? 210 : 260}
                filename={dialect === 'mysql' ? 'triggers.mysql.sql' : 'triggers.sql'}
                schema={draft}
                className="rounded-none border-0"
                ariaLabel="SQL de vistas, funciones y triggers"
              />
            </div>
          )
        ) : (
          <p className="px-4 py-3 text-xs text-muted-foreground">Todavía no hay triggers ni funciones.</p>
        )}
      </div>
    </section>
  )
}
