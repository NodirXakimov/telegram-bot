import axios from 'axios'
import { PageResponse, ScrapeResult, Vote } from '../types'
import { upsertVotes, updateScrapeState, getScrapeState, getNewestVoteDate } from './supabase.service'
import { withRetry } from './retry'

const BASE_URL = 'https://openbudget.uz'
const TIMEOUT_MS = 15000

// vote_date has minute precision, so votes sharing the boundary minute can straddle
// a page edge. After crossing the watermark we fetch this many extra pages.
const OVERSHOOT_PAGES = 1

// "2026-08-25T06:37:00" — ISO field order means lexicographic compare is chronological.
function normalizeDate(raw: string): string {
  return raw.trim().replace(' ', 'T')
}

function oldestOnPage(content: Vote[]): string | null {
  let oldest: string | null = null
  for (const v of content) {
    const d = normalizeDate(v.voteDate)
    if (oldest === null || d < oldest) oldest = d
  }
  return oldest
}

function newestOnPage(content: Vote[]): string | null {
  let newest: string | null = null
  for (const v of content) {
    const d = normalizeDate(v.voteDate)
    if (newest === null || d > newest) newest = d
  }
  return newest
}

interface Session {
  token: string
  initiativeId: string
  pagesFetched: number
  newRecords: number
  searchFetches: number
  totalPages: number
  totalElements: number
}

async function fetchPage(token: string, page: number): Promise<PageResponse> {
  // 410/411 are not retried — withRetry treats 4xx as final, so the freeze and
  // token-expiry paths still fire on the first response.
  const res = await withRetry(`votes page ${page}`, () => axios.get(
    `${BASE_URL}/api/v2/info/votes/${token}`,
    { params: { page }, timeout: TIMEOUT_MS },
  ))
  return res.data
}

// Fetches a page and stores it. Every page this touches counts toward progress,
// including search probes — the probes are not wasted requests.
async function fetchAndStore(s: Session, page: number): Promise<PageResponse> {
  const data = await fetchPage(s.token, page)
  s.pagesFetched++
  s.totalPages = data.totalPages
  s.totalElements = data.totalElements

  const inserted = await upsertVotes(s.initiativeId, data.content ?? [])
  s.newRecords += inserted
  console.log(`[scraper] page ${page}: ${inserted} new / ${data.content?.length ?? 0} on page`)
  return data
}

/**
 * Finds the lowest page index whose oldest vote is at or older than `floor` — the
 * page an interrupted run stopped on. Pages are sorted newest-first, so
 * oldestOnPage decreases monotonically as the index grows, which is what makes the
 * search valid.
 *
 * `hint` is the page index recorded when the run stopped. Votes cast since then
 * shift content toward higher indices, so the true boundary is usually within a
 * page or two of the hint. Galloping outward from it brackets the boundary in ~2
 * probes instead of the ~7 a full-range binary search costs, and every probe saved
 * is a page of real progress bought back from the 20-page budget.
 */
async function findResumePage(s: Session, floor: string, hint: number | null): Promise<number> {
  const maxPage = Math.max(0, s.totalPages - 1)
  if (maxPage === 0) return 0

  // True when page p has reached at or past the floor, i.e. the boundary is <= p.
  const reached = async (p: number): Promise<boolean> => {
    const data = await fetchAndStore(s, p)
    s.searchFetches++
    const oldest = oldestOnPage(data.content ?? [])
    // An empty page lies past the end of the data, so the boundary precedes it.
    return oldest === null || oldest <= floor
  }

  let lo = 0
  let hi = maxPage

  if (hint !== null && hint > 0 && hint <= maxPage) {
    let step = 1
    if (await reached(hint)) {
      // Boundary at or before the hint — gallop left.
      hi = hint
      let p = hint
      while (p > 0) {
        const next = Math.max(0, p - step)
        if (!(await reached(next))) {
          lo = next + 1
          break
        }
        hi = next
        p = next
        step *= 2
      }
    } else {
      // Boundary after the hint — gallop right.
      lo = hint + 1
      let p = hint
      while (p < maxPage) {
        const next = Math.min(maxPage, p + step)
        if (await reached(next)) {
          hi = next
          break
        }
        lo = next + 1
        p = next
        step *= 2
      }
    }
  }

  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (await reached(mid)) hi = mid
    else lo = mid + 1
  }

  console.log(`[scraper] resume page ${lo} (floor ${floor}, hint ${hint}, ${s.searchFetches} probes)`)
  return lo
}

function result(s: Session, lastPage: number, reason: ScrapeResult['stoppedReason'], errorMessage?: string): ScrapeResult {
  return {
    pagesScraped: s.pagesFetched,
    totalRecords: s.newRecords,
    searchFetches: s.searchFetches,
    lastPage,
    stoppedReason: reason,
    errorMessage,
  }
}

/**
 * A run covers a contiguous band from `top` (the newest vote when the run began)
 * down to wherever it finished. Votes cast during the run sit above `top` and are
 * not part of that band, so the watermark advances only to `top`, never to the
 * newest row in the table. The next catch-up picks up the remainder, which keeps
 * coverage genuinely gap-free instead of merely looking complete.
 */
async function completeRun(s: Session, lastPage: number, top: string | null, markInitialDone: boolean): Promise<ScrapeResult> {
  const watermark = top ?? await getNewestVoteDate(s.initiativeId)
  await updateScrapeState(s.initiativeId, {
    coverage_newest: watermark,
    catchup_floor: null,
    catchup_top: null,
    current_page: lastPage,
    total_elements: s.totalElements,
    total_pages: s.totalPages,
    last_scraped_at: new Date().toISOString(),
    ...(markInitialDone ? { is_initial_done: true } : {}),
  })
  console.log(`[scraper] ${s.initiativeId} run complete — watermark ${watermark}`)
  return result(s, lastPage, 'done')
}

async function handleError(s: Session, err: any, page: number): Promise<ScrapeResult> {
  const status = err.response?.status
  if (status !== 410 && status !== 411) {
    console.error('[scraper] error:', err.message)
    return result(s, page, 'error', err.message)
  }

  const now = new Date()
  // 411 — page budget spent, initiative frozen. 410 — token expired, no freeze.
  const frozen = status === 411
  await updateScrapeState(s.initiativeId, {
    current_page: page,
    last_scraped_at: now.toISOString(),
    frozen_until: frozen ? new Date(now.getTime() + 10 * 60 * 1000).toISOString() : null,
  })
  console.log(`[scraper] ${s.initiativeId} stopped at page ${page} (${status})`)

  return result(s, page, 'expired', frozen
    ? 'Rate limited — frozen for 10 minutes'
    : 'Token expired — ready for new captcha')
}

export async function scrapeWithToken(token: string, initiativeId: string): Promise<ScrapeResult> {
  const state = await getScrapeState(initiativeId)
  if (!state) {
    return {
      pagesScraped: 0, totalRecords: 0, searchFetches: 0, lastPage: 0,
      stoppedReason: 'error', errorMessage: 'Initiative not found in scrape_state',
    }
  }

  const s: Session = {
    token, initiativeId,
    pagesFetched: 0, newRecords: 0, searchFetches: 0,
    totalPages: state.total_pages || 1,
    totalElements: state.total_elements || 0,
  }

  // A backfill has never reached the bottom of the list, so it can only finish by
  // getting there. A catch-up finishes as soon as it reaches covered territory.
  const isBackfill = !state.is_initial_done
  const watermark = state.coverage_newest ? normalizeDate(state.coverage_newest) : null
  const floor = state.catchup_floor ? normalizeDate(state.catchup_floor) : null
  const resuming = floor !== null

  let page = 0
  try {
    // Page 0 always runs: it carries the newest votes and refreshes totalPages,
    // which the resume search needs as its upper bound.
    const first = await fetchAndStore(s, 0)
    const content = first.content ?? []

    // Fix the band's top on the first session of a run and carry it across resumes.
    const top = resuming
      ? (state.catchup_top ? normalizeDate(state.catchup_top) : newestOnPage(content))
      : newestOnPage(content)

    await updateScrapeState(initiativeId, {
      total_elements: s.totalElements,
      total_pages: s.totalPages,
      catchup_top: top,
      last_scraped_at: new Date().toISOString(),
    })

    if (content.length === 0 || first.last || s.totalPages <= 1) {
      return completeRun(s, 0, top, isBackfill)
    }

    const firstOldest = oldestOnPage(content)
    if (!isBackfill && !resuming && watermark && firstOldest && firstOldest < watermark) {
      return completeRun(s, 0, top, false)
    }

    // Resume an interrupted run at the page it died on rather than re-walking to it.
    page = resuming ? Math.max(1, await findResumePage(s, floor as string, state.current_page)) : 1

    let overshoot = OVERSHOOT_PAGES
    while (page < s.totalPages) {
      const data = await fetchAndStore(s, page)
      const rows = data.content ?? []
      if (rows.length === 0) return completeRun(s, page, top, isBackfill)

      const oldest = oldestOnPage(rows)
      // Persist the floor every page so a 411 mid-run costs nothing but the search.
      await updateScrapeState(initiativeId, {
        catchup_floor: oldest,
        current_page: page,
        last_scraped_at: new Date().toISOString(),
      })

      if (data.last || page >= s.totalPages - 1) return completeRun(s, page, top, isBackfill)

      if (!isBackfill && watermark && oldest && oldest < watermark) {
        if (overshoot === 0) return completeRun(s, page, top, false)
        overshoot--
      }
      page++
    }

    return completeRun(s, page, top, isBackfill)
  } catch (err: any) {
    return handleError(s, err, page)
  }
}
