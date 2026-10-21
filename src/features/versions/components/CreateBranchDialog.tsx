import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useProjectStore } from '@/store/project'

import { BRANCH_PREFIX, branchVersions, fmtShortDate, orderedBranches, useIsDirty } from '../lib'
import { createBranchWithFlow } from '../operations'

const NONE = '__vacia__'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Versión de origen propuesta; por defecto la versión base del borrador. */
  fromVersionId?: string | null
  onCreated?: (branchId: string) => void
}

export function CreateBranchDialog(props: Props) {
  // Se remonta en cada apertura para reiniciar el formulario.
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>{props.open && <CreateBranchForm {...props} />}</Dialog>
}

function CreateBranchForm({ onOpenChange, fromVersionId, onCreated }: Props) {
  const project = useProjectStore((s) => s.project)
  const baseVersionId = useProjectStore((s) => s.baseVersionId)
  const dirty = useIsDirty()

  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [origin, setOrigin] = useState<string>(fromVersionId ?? baseVersionId ?? NONE)

  const name = `${BRANCH_PREFIX}${slug.trim()}`
  const groups = useMemo(
    () => orderedBranches(project).map((b) => ({ branch: b, versions: branchVersions(project, b.id).reverse() })),
    [project],
  )

  const error = !slug.trim()
    ? 'Escribe un nombre para el flujo.'
    : !/^[a-z0-9][a-z0-9._/-]*$/i.test(slug.trim())
      ? 'Usa letras, números, guiones, puntos o barras (sin espacios).'
      : project.branches.some((b) => b.name === name)
        ? 'Ya existe una rama con ese nombre.'
        : null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (error) return
    onOpenChange(false)
    void createBranchWithFlow(name, description.trim(), origin === NONE ? null : origin).then((res) => {
      if (res.ok && res.branch) {
        toast.success(`Rama ${res.branch.name} creada`, { description: 'Ahora trabajas sobre esta rama.' })
        onCreated?.(res.branch.id)
      } else toast.error('No se pudo crear la rama')
    })
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <form onSubmit={submit} className="contents">
        <DialogHeader>
          <DialogTitle>Nueva rama de flujo</DialogTitle>
          <DialogDescription>Cada rama explora un flujo (normalización, triggers…) a partir de una versión.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="branch-name">Nombre</Label>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText className="font-mono">{BRANCH_PREFIX}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="branch-name"
                autoFocus
                className="font-mono"
                placeholder="4fn"
                value={slug}
                onChange={(e) => setSlug(e.target.value.replace(/\s+/g, '-'))}
                aria-invalid={!!slug && !!error}
                aria-describedby="branch-name-hint"
              />
            </InputGroup>
            <p id="branch-name-hint" className="text-xs text-muted-foreground">
              {slug && error ? <span className="text-destructive">{error}</span> : <>Se creará como <span className="font-mono">{name}</span></>}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="branch-desc">Descripción</Label>
            <Textarea
              id="branch-desc"
              rows={3}
              placeholder="Qué explora este flujo, p. ej. «Forma normal de Boyce-Codd en pedidos»"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="branch-origin">Versión de origen</Label>
            <Select value={origin} onValueChange={setOrigin}>
              <SelectTrigger id="branch-origin" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                <SelectItem value={NONE}>Esquema vacío (sin origen)</SelectItem>
                {groups
                  .filter((g) => g.versions.length)
                  .map((g) => (
                    <SelectGroup key={g.branch.id}>
                      <SelectLabel className="font-mono">{g.branch.name}</SelectLabel>
                      {g.versions.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="truncate">{v.message}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{fmtShortDate(v.createdAt)}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {dirty && (
            <p className="border-l-2 border-amber-500 pl-3 text-sm text-amber-700 dark:text-amber-400">
              Tienes cambios sin confirmar en la rama actual. Al crear la rama se cambiará a ella y esos cambios se descartarán.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!!error}>
            Crear rama
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
