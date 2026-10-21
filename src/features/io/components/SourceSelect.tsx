// Selector de origen: borrador actual o cualquier versión, agrupado por rama.
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'

import { useSchemaSources } from '../lib/sources'

export function SourceSelect({
  value,
  onChange,
  id,
  includeDraft = true,
  placeholder = 'Elige una versión',
}: {
  value: string
  onChange: (id: string) => void
  id?: string
  includeDraft?: boolean
  placeholder?: string
}) {
  const { draft, groups } = useSchemaSources()
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="max-md:data-[size=default]:h-11 w-full min-w-0">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {includeDraft && (
          <SelectItem value={draft.id}>
            {draft.label} <span className="text-muted-foreground">· {draft.detail}</span>
          </SelectItem>
        )}
        {groups.map((g, i) => (
          <SelectGroup key={g.branch.id}>
            {(includeDraft || i > 0) && <SelectSeparator />}
            <SelectLabel>{g.branch.name}</SelectLabel>
            {g.versions.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                <span className="truncate">{v.label}</span>
                <span className="text-muted-foreground"> · {v.detail.split(' · ').slice(1).join(' · ')}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {!groups.length && !includeDraft && <div className="px-2 py-1.5 text-sm text-muted-foreground">Aún no hay versiones confirmadas.</div>}
      </SelectContent>
    </Select>
  )
}
