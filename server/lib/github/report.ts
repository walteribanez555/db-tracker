// Informe por rama/flujo a partir de la API de GitHub.
import type { Octokit } from '@octokit/rest'

import type { GithubBranchReport } from '../../../src/types/report.ts'
import type { GithubBranchMetrics, GithubReportResponse } from '../../../src/features/github/types.ts'
import { encodeRefPath } from './client.ts'
import { GhError, toGhError } from './errors.ts'

const MAX_DEFAULT_COMMITS = 1000
const HOUR = 3_600_000

interface CommitLike {
  sha: string
  commit: { author?: { date?: string } | null; committer?: { date?: string } | null }
}
interface FileLike {
  additions?: number
  deletions?: number
}
interface CompareLike {
  ahead_by: number
  behind_by: number
  commits: CommitLike[]
  files?: FileLike[]
  merge_base_commit?: CommitLike
}

const commitDate = (c: CommitLike) => c.commit.author?.date ?? c.commit.committer?.date ?? null

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

function timeStats(dates: string[]) {
  const ts = dates.map((d) => Date.parse(d)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
  if (!ts.length) return { first: null, last: null, avgHours: null, perDay: null }
  const first = ts[0]
  const last = ts[ts.length - 1]
  const spanH = (last - first) / HOUR
  return {
    first: new Date(first).toISOString(),
    last: new Date(last).toISOString(),
    avgHours: ts.length > 1 ? round(spanH / (ts.length - 1)) : null,
    perDay: ts.length > 1 && spanH > 0 ? round(ts.length / Math.max(spanH / 24, 1 / 24)) : null,
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

async function compare(octokit: Octokit, owner: string, repo: string, base: string, head: string): Promise<CompareLike> {
  const res = await octokit.request(
    `GET /repos/{owner}/{repo}/compare/${encodeRefPath(base)}...${encodeRefPath(head)}`,
    { owner, repo, per_page: 250 },
  )
  return res.data as CompareLike
}

const sumFiles = (files: FileLike[] = []) => ({
  additions: files.reduce((a, f) => a + (f.additions ?? 0), 0),
  deletions: files.reduce((a, f) => a + (f.deletions ?? 0), 0),
  filesChanged: files.length,
})

export async function buildReport(octokit: Octokit, owner: string, repo: string): Promise<GithubReportResponse> {
  try {
    const { data: info } = await octokit.repos.get({ owner, repo })
    const defaultBranch = info.default_branch
    const branches = await octokit.paginate(octokit.repos.listBranches, { owner, repo, per_page: 100 })
    // Rama por defecto primero, el resto alfabético.
    branches.sort((a, b) => (a.name === defaultBranch ? -1 : b.name === defaultBranch ? 1 : a.name.localeCompare(b.name)))

    const rows = await mapLimit(branches, 4, async (b): Promise<{ report: GithubBranchReport; metrics: GithubBranchMetrics }> => {
      if (b.name === defaultBranch) {
        let count = 0
        const commits = (await octokit.paginate(
          octokit.repos.listCommits,
          { owner, repo, sha: b.commit.sha, per_page: 100 },
          (res, done) => {
            count += res.data.length
            if (count >= MAX_DEFAULT_COMMITS) done()
            return res.data
          },
        )) as CommitLike[]
        const stats = timeStats(commits.map(commitDate).filter((d): d is string => !!d))
        // La rama por defecto no tiene contra quién compararse: se mide desde su primer commit.
        let diff = { additions: 0, deletions: 0, filesChanged: 0 }
        if (commits.length > 1) {
          const oldest = commits[commits.length - 1].sha
          diff = sumFiles((await compare(octokit, owner, repo, oldest, b.commit.sha)).files)
        }
        return {
          report: {
            branch: b.name,
            commits: commits.length,
            firstCommitAt: stats.first,
            lastCommitAt: stats.last,
            ...diff,
            aheadBy: 0,
            behindBy: 0,
          },
          metrics: {
            branch: b.name,
            isDefault: true,
            avgHoursBetweenCommits: stats.avgHours,
            commitsPerDay: stats.perDay,
            forkedAt: null,
            leadTimeHours: null,
          },
        }
      }

      const cmp = await compare(octokit, owner, repo, defaultBranch, b.name)
      const stats = timeStats(cmp.commits.map(commitDate).filter((d): d is string => !!d))
      const forkedAt = cmp.merge_base_commit ? commitDate(cmp.merge_base_commit) : null
      const leadTimeHours =
        forkedAt && stats.last && cmp.ahead_by > 0 ? round((Date.parse(stats.last) - Date.parse(forkedAt)) / HOUR) : null
      return {
        report: {
          branch: b.name,
          commits: cmp.ahead_by,
          firstCommitAt: stats.first,
          lastCommitAt: stats.last,
          ...sumFiles(cmp.files),
          aheadBy: cmp.ahead_by,
          behindBy: cmp.behind_by,
        },
        metrics: {
          branch: b.name,
          isDefault: false,
          avgHoursBetweenCommits: stats.avgHours,
          commitsPerDay: stats.perDay,
          forkedAt,
          leadTimeHours,
        },
      }
    })

    const metrics = rows.map((r) => r.metrics)
    const mean = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null)
      return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null
    }

    let rateLimit: GithubReportResponse['rateLimit'] = { remaining: null, resetAt: null }
    try {
      const rl = await octokit.rateLimit.get()
      rateLimit = { remaining: rl.data.rate.remaining, resetAt: new Date(rl.data.rate.reset * 1000).toISOString() }
    } catch {
      /* no crítico */
    }

    return {
      owner,
      repo,
      htmlUrl: info.html_url,
      networkUrl: `${info.html_url}/network`,
      defaultBranch,
      generatedAt: new Date().toISOString(),
      branches: rows.map((r) => r.report),
      metrics,
      summary: {
        branches: rows.length,
        totalCommits: rows.reduce((a, r) => a + r.report.commits, 0),
        avgHoursBetweenCommits: mean(metrics.map((m) => m.avgHoursBetweenCommits)),
        avgLeadTimeHours: mean(metrics.filter((m) => !m.isDefault).map((m) => m.leadTimeHours)),
      },
      rateLimit,
    }
  } catch (err) {
    const e = toGhError(err)
    if (e.code === 'repo_empty') {
      throw new GhError(409, 'repo_empty', 'El repositorio está vacío: sube el proyecto primero.')
    }
    throw e
  }
}
