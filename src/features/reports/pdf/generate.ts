// Generación del informe PDF como operación paso a paso: preparar datos → un paso por flujo → componer → descargar.
import { createElement, type ReactElement } from 'react'

import { runOperation, useOperationStore, type RunnableStep } from '@/components/operation-flow'
import { useProjectStore } from '@/store/project'
import type { DocumentProps } from '@react-pdf/renderer'

import { estimatedBenchmarks } from '../lib'
import { useBenchmarkStore } from '../store'
import { buildFlowSection, buildReportBase, reportFileName, type BenchmarkWithDetail, type FlowSection, type OperationLog, type PdfOptions, type ReportData } from './data'

/** Cuenta páginas de un PDF generado por react-pdf (objetos /Type /Page sin comprimir). */
export async function countPdfPages(blob: Blob): Promise<number> {
  const text = await blob.text()
  return (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length
}

const kb = (n: number) => `${(n / 1024).toLocaleString('es', { maximumFractionDigits: 0 })} KB`

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Compone el blob del PDF (import dinámico de @react-pdf/renderer y del documento). */
export async function renderReportBlob(data: ReportData): Promise<Blob> {
  const [{ pdf }, { FlowReportDocument }] = await Promise.all([import('@react-pdf/renderer'), import('./document')])
  const element = createElement(FlowReportDocument, { data }) as unknown as ReactElement<DocumentProps>
  return pdf(element).toBlob()
}

/** Genera y descarga el informe PDF de los flujos seleccionados. */
export async function generateFlowReportPdf(opts: PdfOptions) {
  const project = useProjectStore.getState().project
  const benchmarks = useBenchmarkStore.getState().benchmarks as BenchmarkWithDetail[]
  const operations: OperationLog[] = useOperationStore.getState().operations
  const branches = project.branches.filter((b) => opts.branchIds.includes(b.id))
  const filename = reportFileName(project.name)

  let estimates: ReturnType<typeof estimatedBenchmarks> = []
  let base: Omit<ReportData, 'flows'> | null = null
  const flows: FlowSection[] = []
  let blob: Blob | null = null

  const steps: RunnableStep[] = [
    {
      id: 'prep',
      label: 'Preparar datos',
      kind: 'check',
      run: () => {
        estimates = estimatedBenchmarks(project)
        base = buildReportBase(project, benchmarks, estimates, operations, opts)
        const remote = benchmarks.filter((b) => b.source === 'remote').length
        return `${branches.length} flujos · ${base.versionsCount} versiones · ${remote ? `${remote} mediciones remotas` : 'latencia estimada'}`
      },
    },
    ...branches.map<RunnableStep>((b) => ({
      id: `flow:${b.id}`,
      label: 'Flujo',
      detail: b.name,
      kind: 'branch',
      run: () => {
        const f = buildFlowSection(project, b, base!.rows, benchmarks, estimates, opts)
        flows.push(f)
        return `${b.name} · ${f.versions.length} versiones · ${f.versions.reduce((n, v) => n + v.actions.length, 0)} acciones${opts.sections.queries ? ` · ${f.queries.length} consultas` : ''}`
      },
    })),
    {
      id: 'compose',
      label: 'Componer PDF',
      kind: 'file',
      run: async () => {
        blob = await renderReportBlob({ ...base!, flows })
        const pages = await countPdfPages(blob)
        return `${pages} páginas · ${kb(blob.size)}`
      },
    },
    {
      id: 'download',
      label: 'Descargar',
      kind: 'file',
      run: () => {
        download(blob!, filename)
        return filename
      },
    },
  ]

  return runOperation(`Informe PDF · ${project.name}`, steps)
}
