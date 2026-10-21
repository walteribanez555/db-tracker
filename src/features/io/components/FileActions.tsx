// Botones Copiar / Descargar para la barra de pestañas del editor de código.
import { Check, Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { copyText, downloadText } from '../lib/download'

export function FileActions({
  content,
  filename,
  mime = 'text/plain',
  note,
  children,
}: {
  content: string
  filename: string
  mime?: string
  /** Texto gris a la izquierda de los botones (líneas, tamaño…). */
  note?: string
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-1">
      {note && <span className="mr-1 hidden text-xs text-muted-foreground sm:inline">{note}</span>}
      <Button
        size="xs"
        variant="ghost"
        onClick={async () => {
          if (await copyText(content)) {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } else toast.error('No se pudo copiar al portapapeles')
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copiado' : 'Copiar'}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => downloadText(filename, content, mime)}>
        <Download />
        Descargar
      </Button>
      {children}
    </div>
  )
}
