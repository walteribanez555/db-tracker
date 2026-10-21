// Carga diferida de Monaco (el editor de VS Code) empaquetado localmente, sin CDN.
import type * as Monaco from 'monaco-editor'

import type { Schema } from '@/types/schema'

export type MonacoApi = typeof Monaco

let ready: Promise<MonacoApi> | null = null

/** Esquema activo para el autocompletado (lo actualiza cada editor que recibe `schema`). */
let completionSchema: Schema | null = null
export const setCompletionSchema = (schema: Schema | null | undefined) => {
  if (schema) completionSchema = schema
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CREATE INDEX',
  'CREATE VIEW', 'CREATE MATERIALIZED VIEW', 'CREATE OR REPLACE FUNCTION', 'CREATE TRIGGER', 'RETURNS trigger',
  'LANGUAGE plpgsql', 'BEGIN', 'END', 'RETURN NEW', 'RETURN OLD', 'RETURN NULL', 'DECLARE', 'IF', 'THEN', 'ELSE',
  'COALESCE', 'COUNT', 'SUM', 'AVG', 'DISTINCT', 'AS', 'AND', 'OR', 'NOT NULL', 'PRIMARY KEY', 'REFERENCES',
  'FOREIGN KEY', 'DEFAULT', 'CASCADE', 'RESTRICT', 'BEFORE', 'AFTER', 'FOR EACH ROW', 'FOR EACH STATEMENT',
  'EXECUTE FUNCTION', 'NEW', 'OLD', 'TG_OP', 'TG_TABLE_NAME', 'now()', 'gen_random_uuid()',
]

function defineThemes(monaco: MonacoApi) {
  monaco.editor.defineTheme('dbt-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '0000ff' },
      { token: 'string', foreground: 'a31515' },
      { token: 'number', foreground: '098658' },
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editorLineNumber.foreground': '#a3a3a3',
      'editorLineNumber.activeForeground': '#404040',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editorGutter.background': '#ffffff',
    },
  })
  // Oscuro: VS Code Dark+ sobre el azul noche de Telegram.
  monaco.editor.defineTheme('dbt-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '569cd6' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'operator', foreground: 'd4d4d4' },
    ],
    colors: {
      'editor.background': '#17212b',
      'editorGutter.background': '#17212b',
      'editorLineNumber.foreground': '#4d6072',
      'editorLineNumber.activeForeground': '#c4cfda',
      'editor.lineHighlightBackground': '#1c2733',
      'editor.selectionBackground': '#2b4a66',
      'editorWidget.background': '#17212b',
      'editorWidget.border': '#22303d',
      'editorSuggestWidget.background': '#17212b',
      'editorSuggestWidget.selectedBackground': '#2b4a66',
      'scrollbarSlider.background': '#22303d99',
      'diffEditor.insertedTextBackground': '#4fd1a522',
      'diffEditor.removedTextBackground': '#ef6b6b22',
    },
  })
}

function registerLanguages(monaco: MonacoApi) {
  const ids = new Set(monaco.languages.getLanguages().map((l) => l.id))

  if (!ids.has('dbml')) {
    monaco.languages.register({ id: 'dbml' })
    monaco.languages.setMonarchTokensProvider('dbml', {
      ignoreCase: true,
      keywords: ['table', 'ref', 'enum', 'note', 'indexes', 'project', 'tablegroup', 'as', 'pk', 'unique', 'not', 'null', 'increment', 'default'],
      tokenizer: {
        root: [
          [/\/\/.*$/, 'comment'],
          [/'''/, 'string', '@multi'],
          [/'[^']*'/, 'string'],
          [/"[^"]*"/, 'string'],
          [/`[^`]*`/, 'string'],
          [/\d+(\.\d+)?/, 'number'],
          [/[<>-]/, 'operator'],
          [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        ],
        multi: [
          [/'''/, 'string', '@pop'],
          [/./, 'string'],
        ],
      },
    })
  }

  if (!ids.has('prisma')) {
    monaco.languages.register({ id: 'prisma' })
    monaco.languages.setMonarchTokensProvider('prisma', {
      keywords: ['model', 'enum', 'datasource', 'generator', 'view'],
      types: ['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes'],
      tokenizer: {
        root: [
          [/\/\/.*$/, 'comment'],
          [/"[^"]*"/, 'string'],
          [/@@?[\w.]+/, 'annotation'],
          [/\d+/, 'number'],
          [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@types': 'type', '@default': 'identifier' } }],
        ],
      },
    })
  }

  if (!ids.has('mermaid')) {
    monaco.languages.register({ id: 'mermaid' })
    monaco.languages.setMonarchTokensProvider('mermaid', {
      keywords: ['erDiagram', 'graph', 'flowchart', 'classDiagram', 'PK', 'FK', 'UK'],
      tokenizer: {
        root: [
          [/%%.*$/, 'comment'],
          [/"[^"]*"/, 'string'],
          [/[|}{o]{2}--[|}{o]{2}|[|}{o]{2}\.\.[|}{o]{2}/, 'operator'],
          [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        ],
      },
    })
  }

  // Autocompletado de tablas, columnas, vistas y funciones del esquema activo.
  for (const lang of ['sql', 'pgsql', 'mysql']) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.', ' '],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1)
        const K = monaco.languages.CompletionItemKind
        const schema = completionSchema
        const dotted = before.match(/([A-Za-z_][\w]*)\.$/)
        if (dotted && schema) {
          const owner = dotted[1].toLowerCase()
          const table = schema.tables.find((t) => t.name.toLowerCase() === owner)
          const view = schema.views?.find((v) => v.name.toLowerCase() === owner)
          const columns = table?.columns.map((c) => ({ name: c.name, type: c.type })) ?? view?.columns ?? []
          return {
            suggestions: columns.map((c) => ({ label: c.name, kind: K.Field, detail: c.type, insertText: c.name, range })),
          }
        }
        const suggestions: Monaco.languages.CompletionItem[] = SQL_KEYWORDS.map((k) => ({
          label: k,
          kind: K.Keyword,
          insertText: k,
          range,
        }))
        if (schema) {
          for (const t of schema.tables) {
            suggestions.push({ label: t.name, kind: K.Class, detail: `tabla · ${t.columns.length} col.`, insertText: t.name, range })
            for (const c of t.columns)
              suggestions.push({ label: c.name, kind: K.Field, detail: `${t.name} · ${c.type}`, insertText: c.name, range, sortText: `z${c.name}` })
          }
          for (const v of schema.views ?? [])
            suggestions.push({ label: v.name, kind: K.Interface, detail: v.materialized ? 'vista materializada' : 'vista', insertText: v.name, range })
          for (const f of schema.functions)
            suggestions.push({ label: `${f.name}()`, kind: K.Function, detail: `función · ${f.returns}`, insertText: `${f.name}()`, range })
          for (const e of schema.enums)
            suggestions.push({ label: e.name, kind: K.Enum, detail: e.values.join(', '), insertText: e.name, range })
        }
        return { suggestions }
      },
    })
  }
}

/** Devuelve Monaco listo (temas y lenguajes registrados). Solo se descarga la primera vez que se usa. */
export function loadMonaco(): Promise<MonacoApi> {
  ready ??= (async () => {
    const [monaco, { loader }, { default: EditorWorker }, { default: JsonWorker }] = await Promise.all([
      import('./monaco-slim.js') as Promise<MonacoApi>,
      import('@monaco-editor/react'),
      import('monaco-editor/editor/editor.worker?worker'),
      import('monaco-editor/language/json/json.worker?worker'),
    ])
    self.MonacoEnvironment = {
      getWorker: (_id: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
    }
    loader.config({ monaco })
    defineThemes(monaco)
    registerLanguages(monaco)
    return monaco
  })()
  return ready
}

/** Lenguaje de Monaco según el dialecto del proyecto. */
export const sqlLanguageFor = (dialect?: string) => (dialect === 'postgresql' ? 'pgsql' : dialect === 'mysql' ? 'mysql' : 'sql')
