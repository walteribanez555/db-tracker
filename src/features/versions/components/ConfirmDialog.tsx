import { useCallback, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmLabel?: string
  destructive?: boolean
}

/** `const [confirm, dialog] = useConfirm()` → `if (await confirm({...})) ...`; renderiza `dialog`. */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOpts(null)
  }

  const dialog = (
    <Dialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{opts?.title}</DialogTitle>
          {opts?.description && <DialogDescription>{opts.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button variant={opts?.destructive ? 'destructive' : 'default'} onClick={() => close(true)} autoFocus>
            {opts?.confirmLabel ?? 'Continuar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return [confirm, dialog]
}
