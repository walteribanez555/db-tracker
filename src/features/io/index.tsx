// Vista /datos: importar, exportar y bases de datos remotas.
import { useState } from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProjectStore } from '@/store/project'

import { ExportTab } from './components/ExportTab'
import { ImportTab } from './components/ImportTab'
import { RemoteTab } from './components/RemoteTab'

export { SchemaPreview } from './components/SchemaPreview'

const TAB_KEY = 'db-tracker:io-tab'

export function IoView() {
  const projectName = useProjectStore((s) => s.project.name)
  const [tab, setTab] = useState(() => {
    try {
      return sessionStorage.getItem(TAB_KEY) ?? 'export'
    } catch {
      return 'export'
    }
  })
  const change = (t: string) => {
    setTab(t)
    try {
      sessionStorage.setItem(TAB_KEY, t)
    } catch {
      /* ignorar */
    }
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">Importar / Exportar</h1>
          <p className="text-sm text-muted-foreground">
            {projectName} · Exporta a SQL, DBML, Prisma, Mermaid o Markdown, importa esquemas y trabaja con bases de datos reales.
          </p>
        </header>
        <Tabs value={tab} onValueChange={change}>
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="export" className="flex-none">
              Exportar
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-none">
              Importar
            </TabsTrigger>
            <TabsTrigger value="remote" className="flex-none">
              Bases de datos remotas
            </TabsTrigger>
          </TabsList>
          <TabsContent value="export" className="pt-6 data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-200 motion-reduce:animate-none">
            <ExportTab />
          </TabsContent>
          <TabsContent value="import" className="pt-6 data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-200 motion-reduce:animate-none">
            <ImportTab />
          </TabsContent>
          <TabsContent value="remote" className="pt-6 data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:duration-200 motion-reduce:animate-none">
            <RemoteTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
