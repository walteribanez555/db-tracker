import { ArrowLeftRight, GitBranchPlus, PencilRuler, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CodeDiff, CodeEditor, sqlLanguageFor } from '@/components/code'
import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { diffSchemas } from '@/lib/diff'
import type { Project, Version } from '@/types/schema'

import { branchVersions, fmtDate, fmtGap, fmtRelative, fmtShortDate, useLaneColor, orderedBranches, ts } from '../lib'
import { DiffList, DiffSummary } from './DiffList'
import { ddlOf, migrationFromParent } from '../sql'
import { SideBySideDiff } from './SideBySideDiff'

interface Props {
  project: Project
  version: Version
  isBase: boolean
  compareId: string | null
  picking: boolean
  onOpenInEditor: () => void
  onBranchFrom: () => void
  onStartCompare: () => void
  onCompare: (versionId: string | null) => void
}

export function VersionDetail({
  project,
  version,
  isBase,
  compareId,
  picking,
  onOpenInEditor,
  onBranchFrom,
  onStartCompare,
  onCompare,
}: Props) {
  const laneColor = useLaneColor()
  const branch = project.branches.find((b) => b.id === version.branchId)
  const parent = version.parentId ? project.versions.find((v) => v.id === version.parentId) : undefined
  const parentBranch = parent ? project.branches.find((b) => b.id === parent.branchId) : undefined
  const diff = useMemo(() => diffSchemas(parent?.schema ?? null, version.schema), [parent, version])
  const compare = compareId ? project.versions.find((v) => v.id === compareId) : undefined
  const isHead = branch?.headVersionId === version.id
  const [sqlTab, setSqlTab] = useState<'ddl' | 'migration'>('ddl')
  const ddl = useMemo(() => ddlOf(version.schema), [version])
  const migration = useMemo(() => migrationFromParent(project, version), [project, version])

  const label = (v: Version) => `${project.branches.find((b) => b.id === v.branchId)?.name ?? '?'} · ${v.message}`
  const [left, right] = compare
    ? ts(compare.createdAt) <= ts(version.createdAt)
      ? [compare, version]
      : [version, compare]
    : [version, version]

  return (
    <div className="animate-in space-y-5 duration-200 fade-in">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="size-2 rounded-full" style={{ background: laneColor(branch?.color ?? '#888') }} />
          <span className="font-mono">{branch?.name}</span>
          {isHead && <span>· cabeza de la rama</span>}
          {isBase && <span className="font-medium text-foreground">· versión actual del editor</span>}
        </div>
        <h2 className="text-lg leading-snug font-semibold">{version.message}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Autor</dt>
          <dd>{version.author}</dd>
          <dt className="text-muted-foreground">Fecha</dt>
          <dd>
            {fmtDate(version.createdAt)} <span className="text-muted-foreground">({fmtRelative(version.createdAt)})</span>
          </dd>
          <dt className="text-muted-foreground">Desde la anterior</dt>
          <dd>
            {parent ? (
              <>
                {fmtGap(parent.createdAt, version.createdAt)}{' '}
                <span className="text-muted-foreground">
                  tras «{parent.message}»
                  {parentBranch && parentBranch.id !== branch?.id && (
                    <>
                      {' '}
                      en <span className="font-mono">{parentBranch.name}</span>
                    </>
                  )}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">primera versión</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Saltos</dt>
          <dd className="tabular-nums">{diff.jumps}</dd>
        </dl>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onOpenInEditor} className="gap-1.5">
          <PencilRuler className="size-3.5" />
          Abrir en editor
        </Button>
        <Button size="sm" variant="outline" onClick={onBranchFrom} className="gap-1.5">
          <GitBranchPlus className="size-3.5" />
          Crear rama desde aquí
        </Button>
        <Button size="sm" variant={picking ? 'secondary' : 'outline'} onClick={onStartCompare} className="gap-1.5" aria-pressed={picking}>
          <ArrowLeftRight className="size-3.5" />
          Comparar con…
        </Button>
      </div>

      {(picking || compare) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={compareId ?? ''} onValueChange={(v) => onCompare(v)}>
              <SelectTrigger size="sm" className="w-full max-w-sm" aria-label="Versión con la que comparar">
                <SelectValue placeholder="Elige una versión…" />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {orderedBranches(project).map((b) => {
                  const vs = branchVersions(project, b.id).filter((v) => v.id !== version.id)
                  if (!vs.length) return null
                  return (
                    <SelectGroup key={b.id}>
                      <SelectLabel className="font-mono">{b.name}</SelectLabel>
                      {vs.reverse().map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="truncate">{v.message}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{fmtShortDate(v.createdAt)}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )
                })}
              </SelectContent>
            </Select>
            {compare && (
              <Button size="sm" variant="ghost" onClick={() => onCompare(null)} className="gap-1">
                <X className="size-3.5" />
                Quitar comparación
              </Button>
            )}
          </div>
          {picking && !compare && <p className="text-xs text-muted-foreground">También puedes hacer clic en otro punto del grafo.</p>}
        </div>
      )}

      <Separator />

      {compare ? (
        <>
          <CollapsibleSection
            title="Comparación lado a lado"
            meta={`${label(left)} → ${label(right)}`}
            storageKey="versions:compare"
            contentClassName="pt-2"
          >
            <SideBySideDiff left={left} right={right} leftLabel={label(left)} rightLabel={label(right)} />
          </CollapsibleSection>
          <CollapsibleSection title="Diff de DDL" meta="schema.sql" storageKey="versions:compare-ddl" contentClassName="pt-2">
            <CodeDiff
              original={ddlOf(left.schema)}
              modified={ddlOf(right.schema)}
              language={sqlLanguageFor(project.dialect)}
              originalLabel={label(left)}
              modifiedLabel={label(right)}
              height={480}
            />
          </CollapsibleSection>
        </>
      ) : (
        <CollapsibleSection
          title="Cambios respecto a la versión anterior"
          meta={`${diff.jumps} ${diff.jumps === 1 ? 'salto' : 'saltos'}`}
          storageKey="versions:diff"
          contentClassName="space-y-3 pt-2"
        >
          <DiffSummary diff={diff} className="text-xs" />
          <DiffList diff={diff} />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="SQL"
        meta={sqlTab === 'ddl' ? 'schema.sql' : 'migration.sql'}
        storageKey="versions:sql"
        contentClassName="pt-2"
      >
        <Tabs value={sqlTab} onValueChange={(v) => setSqlTab(v as 'ddl' | 'migration')}>
          <TabsList>
            <TabsTrigger value="ddl">DDL de la versión</TabsTrigger>
            <TabsTrigger value="migration">Migración desde {parent ? 'su padre' : 'vacío'}</TabsTrigger>
          </TabsList>
          <TabsContent value="ddl" className="animate-in fade-in duration-200">
            <CodeEditor
              value={ddl}
              readOnly
              filename="schema.sql"
              language={sqlLanguageFor(project.dialect)}
              schema={version.schema}
              height="auto"
              minHeight={160}
              maxHeight={520}
              statusBar
              ariaLabel={`DDL de la versión ${version.message}`}
            />
          </TabsContent>
          <TabsContent value="migration" className="animate-in fade-in duration-200">
            <CodeEditor
              value={migration}
              readOnly
              filename="migration.sql"
              language={sqlLanguageFor(project.dialect)}
              schema={version.schema}
              height="auto"
              minHeight={120}
              maxHeight={520}
              statusBar
              ariaLabel={`Migración de la versión ${version.message} desde su padre`}
            />
          </TabsContent>
        </Tabs>
      </CollapsibleSection>
    </div>
  )
}
