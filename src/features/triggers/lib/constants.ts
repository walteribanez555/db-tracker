import type { TriggerEvent, TriggerTiming } from '@/types/schema'

export const EVENTS: TriggerEvent[] = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
export const TIMINGS: TriggerTiming[] = ['BEFORE', 'AFTER', 'INSTEAD OF']

/** Duración de cada paso de la simulación animada (ms). */
export const STEP_MS = 1100
