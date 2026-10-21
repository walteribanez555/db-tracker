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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { diffSchemas } from '@/lib/diff'
import { useCurrentBranch, useProjectStore } from '@/store/project'

import { useVersionsPrefs } from '../lib'
import { commitWithFlow } from '../operations'
import { DiffList, DiffSummary } from './DiffList'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommitDialog({ open, onOpenChange }: Props) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <CommitForm onOpenChange={onOpenChange} />}</Dialog>
}

function CommitForm({ onOpenChange }: Pick<Props, 'onOpenChange'>) {
  const branch = useCurrentBranch()
  const draft = useProjectStore((s) => s.draft)
  const base = useProjectStore((s) => (s.baseVersionId ? s.project.versions.find((v) => v.id === s.baseVersionId) : undefined))
  const { author, setAuthor } = useVersionsPrefs()
  const [message, setMessage] = useState('')
  const [who, setWho] = useState(author)

  const diff = useMemo(() => diffSchemas(base?.schema ?? null, draft), [base, draft])
  const behindHead = !!base && branch.headVersionId !== null && branch.headVersionId !== base.id

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (!message.trim()) return
    const name = who.trim() || 'local'
    setAuthor(who.trim())
    const msg = message.trim()
    const branchName = branch.name
    onOpenChange(false)
    void commitWithFlow(msg, name).then((res) => {
      if (res.ok) toast.success('Versión confirmada', { description: `${msg} · ${branchName}` })
      else toast.error('No se pudo confirmar la versión', { description: String(res.error) })
    })
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <form onSubmit={submit} className="contents">
        <DialogHeader>
          <DialogTitle>Confirmar versión</DialogTitle>
          <DialogDescription>
            Se creará una instantánea del esquema en <span className="font-mono text-foreground">{branch.name}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="commit-msg">Mensaje</Label>
            <Textarea
              id="commit-msg"
              autoFocus
              rows={2}
              placeholder="Describe el cambio, p. ej. «Extrae direcciones a su propia tabla»"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e)
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="commit-author">Autor</Label>
            <Input id="commit-author" placeholder="Tu nombre" value={who} onChange={(e) => setWho(e.target.value)} />
          </div>

          <div className="grid gap-2 border-t pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">Cambios respecto a {base ? 'la versión base' : 'un esquema vacío'}</span>
              <DiffSummary diff={diff} className="text-xs" />
            </div>
            <div className="max-h-64 overflow-y-auto pr-1">
              <DiffList diff={diff} emptyText="No hay cambios estructurales (puede haber cambios de posición, comentarios o notas)." />
            </div>
          </div>

          {behindHead && (
            <p className="border-l-2 border-amber-500 pl-3 text-sm text-amber-700 dark:text-amber-400">
              Editas una versión anterior a la cabeza de la rama: la nueva versión se añadirá a continuación de la cabeza actual.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!message.trim()}>
            Confirmar versión
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
