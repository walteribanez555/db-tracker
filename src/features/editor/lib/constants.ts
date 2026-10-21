import { TABLE_COLORS } from '@/store/project'
import type { Cardinality, ReferentialAction } from '@/types/schema'

export const GRID_SIZE = 16
export const TABLE_WIDTH = 240
export const TABLE_HEADER_HEIGHT = 40
export const ROW_HEIGHT = 28
export const ADD_ROW_HEIGHT = 24
export const NOTE_WIDTH = 208
export const VIEW_WIDTH = 240
export const TRIGGER_WIDTH = 260
export const TRIGGER_HEIGHT = 52
/** Color de datos por defecto de las vistas (gris pizarra de la paleta de tablas). */
export const VIEW_COLOR = TABLE_COLORS[TABLE_COLORS.length - 1]

export const MAX_VIEW_ROWS = 12

/** Encuadre: el margen superior deja libre la barra de herramientas flotante (top-3 + 40px). */
export const FIT_PADDING = { top: '76px', right: '40px', bottom: '40px', left: '40px' } as const

/** Colores de interfaz: tokens del tema (cambian con claro/oscuro). */
export const HIGHLIGHT_COLOR = 'var(--brand)'
export const EDGE_COLOR = 'color-mix(in oklch, var(--muted-foreground) 70%, transparent)'

/** Colores de datos de las notas (se guardan en el esquema); en oscuro se atenúan con color-mix. */
export const NOTE_COLORS = ['#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#ede9fe', '#f4f4f5']

export const CARDINALITIES: Cardinality[] = ['1:1', '1:N', 'N:M']

export const REFERENTIAL_ACTIONS: ReferentialAction[] = ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT']

export const viewHeight = (columnCount: number) => TABLE_HEADER_HEIGHT + Math.max(Math.min(columnCount, MAX_VIEW_ROWS + 1), 1) * ROW_HEIGHT + 2

export const tableHeight = (columnCount: number) => TABLE_HEADER_HEIGHT + Math.max(columnCount, 1) * ROW_HEIGHT + ADD_ROW_HEIGHT + 2

export const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE

/** Clave del panel Explorador (y de su hoja móvil, que se abre desde la barra flotante). */
export const EXPLORER_PANEL_KEY = 'editor-sidebar'
