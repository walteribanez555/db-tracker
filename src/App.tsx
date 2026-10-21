import { Database, GitBranch, FolderGit2, LineChart, Network, Sparkles, Workflow, ArrowDownUp } from 'lucide-react'
import { useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'

import { MobileTabBar, MobileTopBar, MoreSheet } from '@/components/layout/mobile-shell'
import { SectionNav } from '@/components/layout/section-nav'
import { FlowDock } from '@/components/operation-flow'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
// Colaboración en red: indicador/acciones de la cabecera, aviso de solo lectura y página /unirse.
import { CollabBanner, CollabHeader, JoinPage } from '@/features/collab'
import { EditorView } from '@/features/editor'
import { GithubView } from '@/features/github'
import { IoView } from '@/features/io'
import { NormalizationView } from '@/features/normalization'
import { ReportsView } from '@/features/reports'
import { TriggersView } from '@/features/triggers'
import { BranchSwitcher, VersionsView } from '@/features/versions'
import { useProjectStore } from '@/store/project'

const NAV = [
  { to: '/editor', label: 'Diagrama', icon: Network },
  { to: '/triggers', label: 'Triggers', icon: Workflow },
  { to: '/normalizacion', label: 'Normalización', icon: Sparkles },
  { to: '/versiones', label: 'Versiones', icon: GitBranch },
  { to: '/informes', label: 'Informes', icon: LineChart },
  { to: '/datos', label: 'Importar / Exportar', icon: ArrowDownUp },
  { to: '/github', label: 'GitHub', icon: FolderGit2 },
]

// Móvil: cuatro pestañas en la barra inferior; el resto va en la hoja "Más".
const MOBILE_TABS = ['/editor', '/triggers', '/versiones', '/informes']
const MOBILE_NAV = MOBILE_TABS.map((to) => NAV.find((n) => n.to === to)!)
const MOBILE_MORE = NAV.filter((n) => !MOBILE_TABS.includes(n.to))

export default function App() {
  const projectName = useProjectStore((s) => s.project.name)
  const { pathname } = useLocation()
  const isMobile = useIsMobile()
  const [moreOpen, setMoreOpen] = useState(false)

  // /unirse (enlace o QR del anfitrión) es una página independiente, sin la cabecera de la app.
  if (pathname === '/unirse')
    return (
      <TooltipProvider>
        {/* Áreas seguras (viewport-fit=cover): en escritorio valen 0. */}
        <div className="bg-background px-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <JoinPage />
        </div>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    )

  return (
    <TooltipProvider>
      <div
        className={cn(
          'flex h-svh flex-col bg-background px-[env(safe-area-inset-left)] text-foreground',
          // En móvil la barra de pestañas ya reserva el área segura inferior (y la superior, la barra de arriba).
          !isMobile && 'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
        )}
      >
        {isMobile ? (
          <MobileTopBar projectName={projectName} onMenu={() => setMoreOpen(true)} />
        ) : (
          <header className="shrink-0 border-b">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <div className="flex shrink-0 items-center gap-2 font-semibold">
                <Database className="size-5" />
                DB Tracker
              </div>
              <span className="text-muted-foreground">/</span>
              <span className="truncate text-sm font-medium">{projectName}</span>
              <div className="min-w-0 max-w-full">
                <BranchSwitcher />
              </div>
              {/* Colaboración: "Compartir" / "Unirse" o el indicador de sesión. */}
              <CollabHeader className="ml-auto" />
              <ThemeToggle />
            </div>
            <SectionNav items={NAV} />
          </header>
        )}
        <CollabBanner />
        <main key={pathname} className="route-enter min-h-0 flex-1">
          <Routes>
            <Route path="/" element={<Navigate to="/editor" replace />} />
            <Route path="/editor" element={<EditorView />} />
            <Route path="/triggers" element={<TriggersView />} />
            <Route path="/normalizacion" element={<NormalizationView />} />
            <Route path="/versiones" element={<VersionsView />} />
            <Route path="/informes" element={<ReportsView />} />
            <Route path="/datos" element={<IoView />} />
            <Route path="/github" element={<GithubView />} />
          </Routes>
        </main>
        <FlowDock />
        {isMobile && (
          <>
            <MobileTabBar items={MOBILE_NAV} moreItems={MOBILE_MORE} onMore={() => setMoreOpen(true)} />
            <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} items={MOBILE_MORE} />
          </>
        )}
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
