import { lazy, Suspense } from 'react'

import type { CodeDiffProps, CodeEditorProps } from './types'

export type { CodeDiffProps, CodeEditorProps, CodeLanguage } from './types'
export { sqlLanguageFor } from './monaco'

const LazyEditor = lazy(() => import('./code-editor-impl'))
const LazyDiff = lazy(() => import('./code-editor-impl').then((m) => ({ default: m.CodeDiffImpl })))

const fallback = (text: string, height: number) => (
  <pre className="m-0 overflow-hidden rounded-md border bg-card px-4 py-2.5 font-mono text-[12.5px] leading-5 text-muted-foreground" style={{ minHeight: height }}>
    {text}
  </pre>
)

/** Editor de código al estilo VS Code (Monaco), cargado bajo demanda. */
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={fallback(props.value, typeof props.height === 'number' ? props.height : (props.minHeight ?? 80))}>
      <LazyEditor {...props} />
    </Suspense>
  )
}

/** Comparación lado a lado al estilo VS Code. */
export function CodeDiff(props: CodeDiffProps) {
  return (
    <Suspense fallback={fallback(props.modified, props.height ?? 360)}>
      <LazyDiff {...props} />
    </Suspense>
  )
}
