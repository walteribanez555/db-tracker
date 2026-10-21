import { DiffEditor, Editor, type DiffOnMount, type OnMount } from '@monaco-editor/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'

import { getAwareness, useCollabStore, usePeers } from '@/collab'
import { useTheme } from '@/components/theme/theme-provider'
import { cn } from '@/lib/utils'

import { loadMonaco, setCompletionSchema } from './monaco'
import type { CodeDiffProps, CodeEditorProps } from './types'
import { bindSharedText, loadMonacoWithYjs, remoteCursorCss } from './yjs-binding'

const LANGUAGE_LABEL: Record<string, string> = {
  pgsql: 'PostgreSQL',
  mysql: 'MySQL',
  sql: 'SQL',
  json: 'JSON',
  markdown: 'Markdown',
  dbml: 'DBML',
  prisma: 'Prisma',
  mermaid: 'Mermaid',
  plaintext: 'Texto',
}

function useMonacoReady(withYjs = false) {
  const [ready, setReady] = useState<boolean | 'yjs'>(false)
  useEffect(() => {
    let alive = true
    void (withYjs ? loadMonacoWithYjs() : loadMonaco()).then(() => alive && setReady(withYjs ? 'yjs' : true))
    return () => {
      alive = false
    }
  }, [withYjs])
  return { ready: ready !== false, yjsReady: ready === 'yjs' }
}

type StandaloneEditor = Parameters<OnMount>[0]

/** Enlace y-monaco del editor con el Y.Text compartido (y CSS de cursores remotos). */
function useSharedTextBinding(editor: StandaloneEditor | null, sharedText: unknown, yjsReady: boolean) {
  useEffect(() => {
    if (!editor || !sharedText || !yjsReady) return
    const binding = bindSharedText(sharedText as Y.Text, editor, getAwareness())
    return () => binding?.destroy()
  }, [editor, sharedText, yjsReady])
}

function RemoteCursorStyles() {
  const peers = usePeers()
  const css = useMemo(() => remoteCursorCss(peers), [peers])
  return css ? <style>{css}</style> : null
}

const baseOptions = {
  fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12.5,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line' as const,
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'on' as const,
  padding: { top: 10, bottom: 10 },
  automaticLayout: true,
  tabSize: 2,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, alwaysConsumeMouseWheel: false },
  stickyScroll: { enabled: false },
  fixedOverflowWidgets: true,
}

function Fallback({ value, height }: { value: string; height: number }) {
  return (
    <pre className="m-0 overflow-hidden bg-card px-4 py-2.5 font-mono text-[12.5px] leading-5 text-muted-foreground" style={{ height }}>
      {value}
    </pre>
  )
}

export default function CodeEditorImpl({
  value,
  onChange,
  language = 'pgsql',
  readOnly = false,
  height = 'auto',
  minHeight = 80,
  maxHeight = 480,
  filename,
  schema,
  wordWrap = false,
  lineNumbers = true,
  statusBar = true,
  className,
  actions,
  ariaLabel,
  sharedText,
}: CodeEditorProps) {
  const shared = sharedText != null
  const { ready, yjsReady } = useMonacoReady(shared)
  const { resolved } = useTheme()
  const [contentHeight, setContentHeight] = useState(minHeight)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [editor, setEditor] = useState<StandaloneEditor | null>(null)
  const collabReadOnly = useCollabStore((s) => s.readOnly)
  if (shared && collabReadOnly) readOnly = true
  useSharedTextBinding(editor, sharedText, yjsReady)

  useEffect(() => setCompletionSchema(schema), [schema])

  const auto = height === 'auto'
  const editorHeight = auto ? Math.min(Math.max(contentHeight, minHeight), maxHeight) : height
  const lines = value.split('\n').length

  const onMount: OnMount = (ed) => {
    const update = () => setContentHeight(ed.getContentHeight())
    update()
    ed.onDidContentSizeChange(update)
    ed.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, col: e.position.column }))
    ed.onDidFocusEditorText(() => setCompletionSchema(schema))
    ed.onDidDispose(() => setEditor(null))
    setEditor(ed)
  }

  return (
    <div className={cn('overflow-hidden rounded-md border bg-card', className)}>
      {(filename || actions) && (
        <div className="flex h-9 items-stretch border-b bg-muted/40">
          {filename && (
            <div className="relative flex items-center gap-2 border-r bg-card px-3 text-xs text-foreground after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-brand">
              <FileIcon language={language} />
              <span className="font-mono">{filename}</span>
              {readOnly && <span className="text-muted-foreground">· solo lectura</span>}
            </div>
          )}
          {actions && <div className="ml-auto flex items-center gap-1 px-2">{actions}</div>}
        </div>
      )}
      {shared && <RemoteCursorStyles />}
      {ready && (!shared || yjsReady) ? (
        <Editor
          // Con texto compartido el contenido lo lleva y-monaco: editor no controlado y sin onChange
          // (el store se actualiza desde el documento Yjs).
          value={shared ? undefined : value}
          defaultValue={shared ? value : undefined}
          onChange={shared ? undefined : (v) => onChange?.(v ?? '')}
          language={language}
          theme={resolved === 'dark' ? 'dbt-dark' : 'dbt-light'}
          height={editorHeight}
          onMount={onMount}
          loading={<Fallback value={value} height={typeof editorHeight === 'number' ? editorHeight : minHeight} />}
          options={{
            ...baseOptions,
            readOnly,
            domReadOnly: readOnly,
            wordWrap: wordWrap ? 'on' : 'off',
            lineNumbers: lineNumbers ? 'on' : 'off',
            folding: true,
            ariaLabel: ariaLabel ?? filename ?? 'Editor de código',
            quickSuggestions: !readOnly,
            scrollbar: { ...baseOptions.scrollbar, handleMouseWheel: !auto || contentHeight > maxHeight },
          }}
        />
      ) : (
        <Fallback value={value} height={typeof editorHeight === 'number' ? editorHeight : minHeight} />
      )}
      {statusBar && (
        <div className="flex h-6 items-center gap-4 border-t bg-muted/40 px-3 text-[11px] text-muted-foreground tabular-nums">
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <span>{lines} líneas</span>
          <span className="ml-auto">UTF-8</span>
          <span>LF</span>
          <span>{LANGUAGE_LABEL[language] ?? language}</span>
        </div>
      )}
    </div>
  )
}

export function CodeDiffImpl({
  original,
  modified,
  language = 'pgsql',
  height = 360,
  sideBySide = true,
  originalLabel = 'Antes',
  modifiedLabel = 'Después',
  className,
}: CodeDiffProps) {
  const { ready } = useMonacoReady()
  const { resolved } = useTheme()
  const diffRef = useRef<Parameters<DiffOnMount>[0] | null>(null)

  // Los modelos se liberan a mano tras soltarlos del widget; si los libera la librería
  // antes del reset, Monaco avisa "TextModel got disposed before DiffEditorWidget model got reset".
  useEffect(
    () => () => {
      const editor = diffRef.current
      if (!editor) return
      const model = editor.getModel()
      editor.setModel(null)
      model?.original.dispose()
      model?.modified.dispose()
    },
    [],
  )

  return (
    <div className={cn('overflow-hidden rounded-md border bg-card', className)}>
      <div className="grid h-9 grid-cols-2 border-b bg-muted/40 text-xs">
        <span className="flex items-center gap-2 border-r px-3 font-mono text-muted-foreground">
          <span className="size-2 rounded-full bg-destructive/70" />
          {originalLabel}
        </span>
        <span className="flex items-center gap-2 px-3 font-mono text-muted-foreground">
          <span className="size-2 rounded-full bg-emerald-500/80" />
          {modifiedLabel}
        </span>
      </div>
      {ready ? (
        <DiffEditor
          original={original}
          modified={modified}
          language={language}
          theme={resolved === 'dark' ? 'dbt-dark' : 'dbt-light'}
          height={height}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          onMount={(editor) => {
            diffRef.current = editor
          }}
          options={{
            ...baseOptions,
            readOnly: true,
            originalEditable: false,
            renderSideBySide: sideBySide,
            renderOverviewRuler: false,
            diffWordWrap: 'on',
          }}
        />
      ) : (
        <Fallback value={modified} height={height} />
      )}
    </div>
  )
}

function FileIcon({ language }: { language: string }) {
  const color =
    language === 'json' ? 'text-amber-500' : language === 'markdown' ? 'text-sky-500' : language === 'prisma' ? 'text-teal-500' : 'text-brand'
  return (
    <svg viewBox="0 0 16 16" className={cn('size-3.5', color)} aria-hidden="true">
      <ellipse cx="8" cy="3.5" rx="5.5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
