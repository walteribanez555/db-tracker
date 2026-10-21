// Destino de una importación: reemplazar el borrador actual o crear una rama nueva con commit.
import { useProjectStore } from '@/store/project'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { ImportTargetState } from '../lib/importInto'
import { RadioList } from './RadioList'

export function ImportTargetForm({
  value,
  onChange,
  idPrefix,
}: {
  value: ImportTargetState
  onChange: (v: ImportTargetState) => void
  idPrefix: string
}) {
  const branchName = useProjectStore((s) => s.project.branches.find((b) => b.id === s.project.currentBranchId)?.name ?? '')
  const dirty = useProjectStore((s) => s.isDirty())
  const exists = useProjectStore((s) => s.project.branches.some((b) => b.name === value.name.trim()))

  return (
    <div className="space-y-3">
      <RadioList
        name={`${idPrefix}-mode`}
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        options={[
          {
            value: 'branch',
            label: 'Como rama nueva',
            description: 'Crea la rama desde la versión actual y confirma el esquema importado como su primera versión.',
          },
          {
            value: 'draft',
            label: `Reemplazar el borrador de «${branchName}»`,
            description: dirty ? 'Atención: el borrador tiene cambios sin confirmar que se perderán.' : 'No se crea ninguna versión; podrás revisarlo y confirmarlo después.',
          },
        ]}
      />
      {value.mode === 'branch' && (
        <div className="grid gap-3 pl-8 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-branch`}>Nombre de la rama</Label>
            <Input
              id={`${idPrefix}-branch`}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              className="max-md:h-11 font-mono"
            />
            {exists && <p className="text-xs text-muted-foreground">Ya existe: se añadirá un sufijo.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-msg`}>Mensaje del commit</Label>
            <Input className="max-md:h-11" id={`${idPrefix}-msg`} value={value.message} onChange={(e) => onChange({ ...value, message: e.target.value })} />
          </div>
          {dirty && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              El borrador de «{branchName}» tiene cambios sin confirmar: al cambiar de rama se descartan. Confírmalos antes si quieres conservarlos.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
