import { createContext } from 'react'

/** En la hoja inferior móvil la cabecera la pinta la propia hoja: los inspectores omiten la suya. */
export const InspectorChromeContext = createContext<{ hideHeader: boolean }>({ hideHeader: false })
