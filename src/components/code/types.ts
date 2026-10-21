import type { Schema } from '@/types/schema'

export type CodeLanguage = 'pgsql' | 'mysql' | 'sql' | 'json' | 'markdown' | 'dbml' | 'prisma' | 'mermaid' | 'plaintext'

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language?: CodeLanguage
  readOnly?: boolean
  /** 'auto' crece con el contenido entre minHeight y maxHeight. */
  height?: number | 'auto'
  minHeight?: number
  maxHeight?: number
  /** Nombre en la pestaña al estilo VS Code (p. ej. "schema.sql"). */
  filename?: string
  /** Esquema para autocompletar tablas, columnas, vistas y funciones. */
  schema?: Schema
  wordWrap?: boolean
  lineNumbers?: boolean
  /** Barra de estado inferior (Ln/Col, líneas, lenguaje). */
  statusBar?: boolean
  className?: string
  /** Botones a la derecha de la barra de pestañas (Copiar, Descargar…). */
  actions?: React.ReactNode
  ariaLabel?: string
}

export interface CodeDiffProps {
  original: string
  modified: string
  language?: CodeLanguage
  height?: number
  sideBySide?: boolean
  originalLabel?: string
  modifiedLabel?: string
  className?: string
}
