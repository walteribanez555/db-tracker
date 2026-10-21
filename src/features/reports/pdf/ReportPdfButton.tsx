// Botón "Descargar informe PDF" + diálogo previo (secciones y flujos). La generación va por runOperation (dock "Flujo").
import { FileDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/store/project'

import type { DateRange } from '../lib'
import type { PdfSections } from './data'

const SECTION_LABELS: { key: keyof PdfSections; label: string; hint: string }[] = [
  { key: 'schemas', label: 'Esquemas finales', hint: 'Tablas con columnas y tipos, vistas, triggers y funciones de cada flujo' },
  { key: 'migrations', label: 'SQL de migración', hint: 'Por cada versión, desde su versión padre' },
  { key: 'queries', label: 'Consultas', hint: 'Mediciones (o estimaciones) con SQL completo y plan si existe' },
  { key: 'session', label: 'Registro de la sesión', hint: 'Operaciones realizadas y sus pasos' },
]

interface Props {
  range?: DateRange
  /** Peso de la latencia en la recomendación (0–1). */
  latencyWeight?: number
  variant?: 'outline' | 'default' | 'ghost'
  size?: 'sm' | 'default'
  className?: string
}

let running = false

export function ReportPdfButton({ range = { from: null, to: null }, latencyWeight = 0.6, variant = 'outline', size = 'sm', className }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const hasVersions = useProjectStore((s) => s.project.versions.length > 0)

  const start = async (sections: PdfSections, branchIds: string[]) => {
    if (running) return
    running = true
    setBusy(true)
    setOpen(false)
    try {
      const { generateFlowReportPdf } = await import('./generate')
      const res = await generateFlowReportPdf({ sections, branchIds, range, latencyWeight })
      if (res.ok) toast.success('Informe PDF descargado')
      else toast.error('No se pudo generar el informe', { description: res.error instanceof Error ? res.error.message : String(res.error) })
    } finally {
      running = false
      setBusy(false)
    }
  }

  return (
    <>
      <Button size={size} variant={variant} className={cn('gap-1.5', className)} disabled={busy || !hasVersions} onClick={() => setOpen(true)}>
        {busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FileDown className="size-3.5" />}
        {busy ? 'Generando informe…' : 'Descargar informe PDF'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <PdfOptionsForm onCancel={() => setOpen(false)} onGenerate={start} range={range} />}
      </Dialog>
    </>
  )
}

function PdfOptionsForm({ onCancel, onGenerate, range }: { onCancel: () => void; onGenerate: (s: PdfSections, ids: string[]) => void; range: DateRange }) {
  const branches = useProjectStore((s) => s.project.branches)
  const versions = useProjectStore((s) => s.project.versions)
  const [sections, setSections] = useState<PdfSections>({ schemas: true, migrations: true, queries: true, session: true })
  const [selected, setSelected] = useState<Set<string>>(() => new Set(branches.map((b) => b.id)))

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Informe PDF de flujos</DialogTitle>
        <DialogDescription>
          {range.from || range.to ? 'Se aplicará el periodo seleccionado en Informes.' : 'Incluye todo el historial.'} El PDF se genera en tu navegador y se descarga al terminar.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-2.5">
        <legend className="mb-1 text-sm font-medium">Secciones</legend>
        {SECTION_LABELS.map((s) => (
          <div key={s.key} className="flex items-start gap-2.5">
            <Checkbox
              id={`pdf-${s.key}`}
              checked={sections[s.key]}
              onCheckedChange={(v) => setSections((x) => ({ ...x, [s.key]: v === true }))}
              className="mt-0.5"
            />
            <Label htmlFor={`pdf-${s.key}`} className="grid gap-0.5 font-normal">
              <span className="text-sm">{s.label}</span>
              <span className="text-xs text-muted-foreground">{s.hint}</span>
            </Label>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Portada, resumen ejecutivo, acciones por versión y glosario se incluyen siempre.</p>
      </fieldset>

      <fieldset className="grid gap-2 border-t pt-3">
        <legend className="sr-only">Flujos</legend>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Flujos</span>
          <div className="flex gap-1">
            <Button type="button" size="xs" variant="ghost" onClick={() => setSelected(new Set(branches.map((b) => b.id)))}>
              Todos
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
              Ninguno
            </Button>
          </div>
        </div>
        <div className="grid max-h-48 gap-2 overflow-y-auto pr-1">
          {branches.map((b) => {
            const n = versions.filter((v) => v.branchId === b.id).length
            return (
              <div key={b.id} className="flex items-center gap-2.5">
                <Checkbox id={`pdf-br-${b.id}`} checked={selected.has(b.id)} onCheckedChange={(v) => toggle(b.id, v === true)} />
                <Label htmlFor={`pdf-br-${b.id}`} className="flex flex-1 items-baseline justify-between gap-2 font-normal">
                  <span className="font-mono text-xs">{b.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {n} {n === 1 ? 'versión' : 'versiones'}
                  </span>
                </Label>
              </div>
            )
          })}
        </div>
      </fieldset>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button disabled={selected.size === 0} onClick={() => onGenerate(sections, branches.filter((b) => selected.has(b.id)).map((b) => b.id))} className="gap-1.5">
          <FileDown className="size-3.5" />
          Generar y descargar
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
