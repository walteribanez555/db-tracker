import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCurrentBranch, useProjectStore } from '@/store/project'

export interface BranchDraft {
  name: string
  description: string
  message: string
}

interface Props {
  initial: BranchDraft
  onCancel: () => void
  onConfirm: (d: BranchDraft) => void
}

export function BranchDialog({ initial, onCancel, onConfirm }: Props) {
  const [form, setForm] = useState(initial)
  const branch = useCurrentBranch()
  const dirty = useProjectStore((s) => s.isDirty())
  const branches = useProjectStore((s) => s.project.branches)
  const taken = branches.some((b) => b.name === form.name.trim())
  const valid = form.name.trim() && !taken && form.message.trim()

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aplicar en un flujo nuevo</DialogTitle>
          <DialogDescription>
            Se crea una rama desde <span className="font-mono">{branch?.name}</span>, se aplica la corrección y se confirma como su primera versión.
            Así puedes comparar el esquema normalizado con el original en Versiones.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) onConfirm({ name: form.name.trim(), description: form.description.trim(), message: form.message.trim() })
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="br-name">Nombre del flujo</Label>
            <Input
              id="br-name"
              className="font-mono"
              value={form.name}
              aria-invalid={taken || undefined}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {taken && <p className="text-xs text-destructive">Ya existe una rama con ese nombre.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-desc">Descripción</Label>
            <Textarea id="br-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-msg">Mensaje de la versión</Label>
            <Input id="br-msg" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </div>
          {dirty && (
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400" role="status">
              El borrador de <span className="font-mono">{branch?.name}</span> tiene cambios sin confirmar. Se moverán al nuevo flujo junto con la
              corrección; si quieres conservarlos en {branch?.name}, confírmalos antes en Versiones.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valid}>
              Crear flujo y confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
