import type { Trigger } from '@/types/schema'

export const triggerSummary = (trigger: Trigger, functionName: string | null) =>
  `${trigger.timing} · ${trigger.events.join(', ') || '—'} → ${functionName ?? '¿función?'}()`
