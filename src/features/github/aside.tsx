// Columna lateral de /github: cuenta, sesión, repositorio vinculado y archivos que lleva cada commit.
import { CollapsibleSection } from '@/components/layout/collapsible-section'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

import { LinkedRepoInfo } from './repo'
import type { GithubMe } from './types'

const FILES: Array<[string, string]> = [
  ['README.md', 'flujo, tablas, vistas, triggers y diagrama'],
  ['schema.sql', 'DDL completo en el dialecto del proyecto'],
  ['schema.dbml', 'DBML para dbdiagram.io'],
  ['schema.json', 'modelo de DB Tracker (se usa al bajar)'],
  ['diagram.mmd', 'diagrama Mermaid'],
  ['migrations/NNN_*.sql', 'una migración por versión del linaje'],
  ['.dbtracker/project.json', 'nombre, dialecto, colores y descripciones de ramas'],
]

const TOKEN_KIND: Record<string, string> = {
  classic: 'Token classic',
  'fine-grained': 'Token fine-grained',
  oauth: 'Inicio con dispositivo (OAuth)',
}

const SECTION = 'border-b px-3 py-3'
const CONTENT = 'pt-2'

export function GithubAside({ me, onLogout }: { me: GithubMe | null; onLogout: () => void }) {
  return (
    <div className="text-sm">
      <CollapsibleSection title="Cuenta" storageKey="github:aside:account" className={SECTION} contentClassName={CONTENT}>
        {me?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarImage src={me.user.avatarUrl} alt="" />
                <AvatarFallback>{me.user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 leading-tight">
                <a
                  href={me.user.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium transition-colors hover:text-brand hover:underline"
                >
                  {me.user.name ?? me.user.login}
                </a>
                <div className="truncate text-muted-foreground">@{me.user.login}</div>
              </div>
            </div>
            <p className="text-muted-foreground">
              {TOKEN_KIND[me.tokenKind] ?? 'Token'}
              {me.scopes && me.scopes.length > 0 && <> · scopes: {me.scopes.join(', ')}</>}
            </p>
            {me.warnings.map((w) => (
              <p key={w} className="text-amber-800 dark:text-amber-300">
                {w}
              </p>
            ))}
            <Button className="max-md:h-11" variant="outline" size="sm" onClick={onLogout}>
              Desconectar
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">{me ? 'Sin conectar.' : 'Comprobando…'}</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Sesión" storageKey="github:aside:session" className={SECTION} contentClassName={CONTENT}>
        <p className="text-muted-foreground">
          La conexión y el vínculo con el repositorio duran solo esta sesión. El token vive en la memoria del servidor local, nunca en el
          navegador. Nada se sube ni se baja en segundo plano.
        </p>
      </CollapsibleSection>

      {me?.connected && (
        <CollapsibleSection title="Repositorio" storageKey="github:aside:repo" className={SECTION} contentClassName={CONTENT}>
          <LinkedRepoInfo />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Archivos por commit"
        meta={FILES.length}
        storageKey="github:aside:files"
        defaultOpen={false}
        className={SECTION}
        contentClassName={CONTENT}
      >
        <ul className="space-y-1.5">
          {FILES.map(([name, desc]) => (
            <li key={name}>
              <span className="font-mono text-xs">{name}</span>
              <span className="block text-xs text-muted-foreground">{desc}</span>
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  )
}
