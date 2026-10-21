// Hook público para consumir el informe de GitHub desde otras features (p. ej. reports/github-slot.tsx).
//   const { reports, metrics, loading, error } = useGithubReport()
//   <GithubSlot reports={reports} />
import { useCallback, useEffect, useState } from 'react'

import { useProjectStore } from '@/store/project'
import type { GithubBranchReport } from '@/types/report'

import { githubApi, GithubApiError } from './api'
import type { GithubBranchMetrics, GithubReportResponse } from './types'

const TTL_MS = 60_000
const cache = new Map<string, { at: number; data: GithubReportResponse }>()
const inflight = new Map<string, Promise<GithubReportResponse>>()

function fetchReport(owner: string, repo: string, force = false): Promise<GithubReportResponse> {
  const key = `${owner}/${repo}`
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data)
  const pending = inflight.get(key)
  if (pending) return pending
  const p = githubApi
    .report(owner, repo)
    .then((data) => {
      cache.set(key, { at: Date.now(), data })
      return data
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Invalida la caché (p. ej. tras sincronizar). */
export function invalidateGithubReport(owner?: string, repo?: string) {
  if (owner && repo) cache.delete(`${owner}/${repo}`)
  else cache.clear()
}

export interface UseGithubReport {
  /** Repo consultado (por defecto, el vinculado al proyecto). */
  link: { owner: string; repo: string } | null
  data: GithubReportResponse | null
  reports: GithubBranchReport[] | undefined
  metrics: GithubBranchMetrics[] | undefined
  loading: boolean
  error: GithubApiError | null
  /** true si el servidor no tiene sesión de GitHub (hay que conectar en /github). */
  needsAuth: boolean
  refresh: () => void
}

/**
 * Informe por rama del repo vinculado (`project.github`) o del indicado.
 * Pasa `null` para no consultar (p. ej. mientras no hay sesión).
 */
export function useGithubReport(target?: { owner: string; repo: string } | null): UseGithubReport {
  const github = useProjectStore((s) => s.project.github)
  // undefined => repo vinculado al proyecto; null => desactivado (no consulta).
  const owner = target === null ? undefined : (target?.owner ?? github?.owner)
  const repo = target === null ? undefined : (target?.repo ?? github?.repo)
  const key = owner && repo ? `${owner}/${repo}` : null

  const [nonce, setNonce] = useState(0)
  const reqId = key ? `${key}#${nonce}` : null
  const [state, setState] = useState<{ reqId: string | null; data: GithubReportResponse | null; error: GithubApiError | null }>(
    () => ({ reqId: null, data: key ? (cache.get(key)?.data ?? null) : null, error: null }),
  )

  useEffect(() => {
    if (!owner || !repo) return
    let cancelled = false
    const id = `${owner}/${repo}#${nonce}`
    fetchReport(owner, repo, nonce > 0)
      .then((data) => !cancelled && setState({ reqId: id, data, error: null }))
      .catch((err: unknown) => {
        if (cancelled) return
        const e = err instanceof GithubApiError ? err : new GithubApiError(0, 'github_error', String(err))
        setState({ reqId: id, data: null, error: e })
      })
    return () => {
      cancelled = true
    }
  }, [owner, repo, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  const loading = !!reqId && state.reqId !== reqId
  // Mientras recarga se conservan los datos anteriores del mismo repo.
  const sameRepo = !!key && (state.reqId?.startsWith(`${key}#`) ?? false)
  const current = sameRepo ? state : { data: key ? (cache.get(key)?.data ?? null) : null, error: null }

  return {
    link: owner && repo ? { owner, repo } : null,
    data: current.data,
    reports: current.data?.branches,
    metrics: current.data?.metrics,
    loading,
    error: current.error,
    needsAuth: current.error?.code === 'unauthorized',
    refresh,
  }
}
