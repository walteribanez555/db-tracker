import { Loader2, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'

import { CollapsiblePanel, PanelSheetTrigger } from '@/components/layout/collapsible-panel'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'
import { useProjectStore } from '@/store/project'

import { githubApi, GithubApiError } from './api'
import { GithubAside } from './aside'
import { ConnectSection } from './connect'
import { ReportSection } from './report'
import { RepoSection } from './repo'
import { SyncSection } from './sync'
import type { CreateRepoInput, GithubMe } from './types'
import { useGithubReport } from './useGithubReport'
import { useSyncRunner } from './useSyncRunner'

export function GithubView() {
  const [me, setMe] = useState<GithubMe | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const github = useProjectStore((s) => s.project.github)
  const hasVersions = useProjectStore((s) => s.project.versions.length > 0)
  const setGithub = useProjectStore((s) => s.setGithub)
  const isMobile = useIsMobile()

  const report = useGithubReport(me?.connected ? github : null)
  const runner = useSyncRunner(report.refresh)

  useEffect(() => {
    githubApi
      .me()
      .then(setMe)
      .catch((err) => setLoadError(err instanceof GithubApiError ? err.message : 'No se pudo consultar el estado de GitHub.'))
  }, [])

  const logout = async () => {
    await githubApi.logout().catch(() => undefined)
    setMe({ connected: false, deviceFlowAvailable: me?.deviceFlowAvailable ?? false })
    toast('Cuenta de GitHub desconectada')
  }

  const onConnected = (next: GithubMe) => {
    setMe(next)
    if (next.connected) toast.success(`Conectado como ${next.user.login}`)
  }

  // Crear repositorio → commit inicial → subir, como una sola operación en el dock.
  const onCreate = async (input: CreateRepoInput) => {
    if (!me?.connected) return
    await runner.start({
      create: { ...input, login: me.user.login },
      force: false,
      onLinked: (link) => {
        setGithub(link)
        toast.success(`Repositorio ${link.owner}/${link.repo} creado`)
      },
    })
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8 max-md:px-4 max-md:py-4">
          <header className="border-b pb-6 max-md:pb-4">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">GitHub</h1>
              {isMobile && (
                // Móvil: cuenta, repositorio vinculado y archivos van en una hoja.
                <PanelSheetTrigger storageKey="github:aside" title="Cuenta y archivos" asChild>
                  <Button variant="outline" className="h-11 gap-1.5">
                    <UserRound className="size-4" />
                    Cuenta y archivos
                  </Button>
                </PanelSheetTrigger>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Sube el proyecto a un repositorio (una rama por flujo, un commit por versión) o bájalo de él, y consulta la actividad de cada
              rama. La conexión con GitHub y el vínculo con el repositorio duran solo esta sesión.
            </p>
          </header>

          {!me && !loadError && (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Comprobando la conexión con GitHub…
            </p>
          )}
          {loadError && <p className="py-8 text-sm text-destructive">{loadError}</p>}

          {me && !me.connected && <ConnectSection deviceFlowAvailable={me.deviceFlowAvailable} onConnected={onConnected} />}

          {me?.connected && (
            <div className="animate-in fade-in duration-200">
              {!hasVersions && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b py-5 max-md:flex-col max-md:items-stretch">
                  <div className="text-sm">
                    <p className="font-medium">Este proyecto aún no tiene versiones</p>
                    <p className="text-muted-foreground">
                      No hay nada que subir todavía. Carga el proyecto de ejemplo, confirma una versión desde el editor o baja un
                      proyecto desde la pestaña «Bajar de un repositorio».
                    </p>
                  </div>
                  <Button className="max-md:h-11" asChild variant="outline" size="sm">
                    <Link to="/versiones">Cargar proyecto de ejemplo</Link>
                  </Button>
                </div>
              )}
              <RepoSection login={me.user.login} onCreate={onCreate} />
              {github && (
                <>
                  <SyncSection link={github} runner={runner} />
                  <ReportSection report={report} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <CollapsiblePanel side="right" width={300} title="Cuenta y archivos" storageKey="github:aside" shortcut="]" mobileTrigger={false} mobileSide="bottom">
        <GithubAside me={me} onLogout={logout} />
      </CollapsiblePanel>
    </div>
  )
}
