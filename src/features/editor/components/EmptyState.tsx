import { Plus, Table2 } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center text-center">
        <Table2 className="mb-4 size-8 text-muted-foreground/60" strokeWidth={1.5} />
        <h2 className="text-base font-semibold">El diagrama está vacío</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea una tabla para empezar a modelar o importa un esquema existente desde SQL o DBML.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <Button onClick={onCreate}>
            <Plus />
            Crear primera tabla
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/datos">Importar</Link>
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Atajo: <span className="font-mono">T</span>
        </p>
      </div>
    </div>
  )
}
