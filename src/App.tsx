import { Database, GitBranch, FolderGit2, LineChart, Network, Sparkles, Workflow, ArrowDownUp } from 'lucide-react'
import { Navigate, Route, Routes, useLocation } from 'react-router'

import { SectionNav } from '@/components/layout/section-nav'
import { FlowDock } from '@/components/operation-flow'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
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

export default function App() {
  const projectName = useProjectStore((s) => s.project.name)
  const { pathname } = useLocation()

  // /unirse (enlace o QR del anfitrión) es una página independiente, sin la cabecera de la app.
  if (pathname === '/unirse')
    return (
      <TooltipProvider>
        <JoinPage />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    )

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col bg-background text-foreground">
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
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
