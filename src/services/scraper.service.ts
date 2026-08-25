import axios from 'axios'
import { PageResponse, ScrapeResult, ScrapeState } from '../types'
import { upsertVotes, updateScrapeState, getScrapeState, getScrapedCount } from './supabase.service'

// Sentinel value stored in current_page to trigger gap scan
const GAP_SCAN_SENTINEL = -1
const MAX_PAGES_PER_SESSION = 20

const BASE_URL = 'https://openbudget.uz'

async function fetchPage(token: string, page: number): Promise<PageResponse> {
  const res = await axios.get(`${BASE_URL}/api/v2/info/votes/${token}`, {
    params: { page },
  })
  return res.data
}

async function gapScrapeWithToken(token: string, initiativeId: string, state: ScrapeState): Promise<ScrapeResult> {
  let pagesScraped = 0
  let totalRecords = 0
  let latestTotalElements = state.total_elements

  const scraped = await getScrapedCount(initiativeId)
  const missing = latestTotalElements - scraped

  // Missing votes were added to the initiative while the initial scrape was running.
  // Because the API sorts newest-first, those votes landed on page 0 and pushed
  // everything else down — so we never revisited them. They are now at the very
  // beginning of the pagination. Scan only as many pages as needed to cover them.
  const pagesToScan = Math.ceil(missing / 12) + 2   // +2 page buffer
  console.log(`[gap-scan] missing ${missing} records — scanning pages 0–${pagesToScan - 1}`)

  for (let page = 0; page < pagesToScan; page++) {
    try {
      const data = await fetchPage(token, page)
      pagesScraped++
      latestTotalElements = data.totalElements
      const inserted = await upsertVotes(initiativeId, data.content)
      totalRecords += inserted
      console.log(`[gap-scan] page ${page}: ${inserted} new`)

      await updateScrapeState(initiativeId, { last_scraped_at: new Date().toISOString() })
    } catch (err: any) {
      return await handleScrapeError(err, initiativeId, pagesScraped, totalRecords, page)
    }
  }

  // After scanning, check actual count against what the API reports now.
  const finalScraped = await getScrapedCount(initiativeId)
  console.log(`[gap-scan] done — have ${finalScraped}/${latestTotalElements}`)

  await updateScrapeState(initiativeId, {
    is_initial_done: true,
    total_elements: latestTotalElements,
    last_scraped_at: new Date().toISOString(),
  })

  return { pagesScraped, totalRecords, lastPage: pagesToScan - 1, stoppedReason: 'done' }
}

async function handleScrapeError(
  err: any,
  initiativeId: string,
  pagesScraped: number,
  totalRecords: number,
  page: number,
): Promise<ScrapeResult> {
  const status = err.response?.status
  if (status === 410 || status === 411) {
    const now = new Date()
    const updates: any = { current_page: page, last_scraped_at: now.toISOString() }
    if (status === 411) {
      console.log(`Initiative ${initiativeId} frozen (411)`)
      updates.frozen_until = new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    } else {
      console.log(`Token expired for initiative ${initiativeId} (410)`)
      updates.frozen_until = null
    }
    await updateScrapeState(initiativeId, updates)
    return {
      pagesScraped, totalRecords, lastPage: page,
      stoppedReason: 'expired',
      errorMessage: status === 411 ? 'Rate limited — frozen for 10 minutes' : 'Token expired — ready for new captcha',
    }
  }
  console.error('Gap scan error:', err.message)
  return { pagesScraped, totalRecords, lastPage: page, stoppedReason: 'error', errorMessage: err.message }
}

// Marks initial scrape as done only if count matches total.
// If records are missing, queues gap scan instead of marking done.
async function markInitialDone(initiativeId: string, totalElements: number): Promise<void> {
  const scraped = await getScrapedCount(initiativeId)
  if (scraped >= totalElements) {
    await updateScrapeState(initiativeId, { is_initial_done: true, total_elements: totalElements })
    console.log(`[scraper] ${initiativeId} marked initial done (${scraped}/${totalElements})`)
  } else {
    // Missing records — update total_elements from API and queue gap scan.
    // Gap scan will confirm whether records are truly missing or gone from the API.
    await updateScrapeState(initiativeId, { current_page: GAP_SCAN_SENTINEL, total_elements: totalElements })
    console.log(`[scraper] ${initiativeId} queued for gap scan — missing ${totalElements - scraped} records (${scraped}/${totalElements})`)
  }
}

export async function scrapeWithToken(token: string, initiativeId: string): Promise<ScrapeResult> {
  const state = await getScrapeState(initiativeId)
  if (!state) {
    return { pagesScraped: 0, totalRecords: 0, lastPage: 0, stoppedReason: 'error', errorMessage: 'Initiative not found in scrape_state' }
  }

  if (!state.is_initial_done && state.current_page === GAP_SCAN_SENTINEL) {
    return gapScrapeWithToken(token, initiativeId, state)
  }

  const isInitialDone = state.is_initial_done
  let currentPage = isInitialDone ? 0 : state.current_page
  let pagesScraped = 0
  let totalRecords = 0

  while (true) {
    try {
      const data = await fetchPage(token, currentPage)

      // Update total info from API on first page
      if (pagesScraped === 0) {
        await updateScrapeState(initiativeId, {
          total_elements: data.totalElements,
          total_pages: data.totalPages,
          last_scraped_at: new Date().toISOString(),
        })
      }

      if (!data.content || data.content.length === 0) {
        if (!isInitialDone) {
          await markInitialDone(initiativeId, data.totalElements)
        }
        return { pagesScraped, totalRecords, lastPage: currentPage, stoppedReason: 'done' }
      }

      const inserted = await upsertVotes(initiativeId, data.content)

      console.log(`Page ${currentPage} → ${inserted} new / ${data.content.length} total`)

      totalRecords += inserted
      pagesScraped++

      // Catch-up mode: stop when a full page has 0 new records
      if (isInitialDone && inserted === 0) {
        return { pagesScraped, totalRecords, lastPage: currentPage, stoppedReason: 'done' }
      }

      // Initial mode: update current_page in DB
      if (!isInitialDone) {
        currentPage++
        await updateScrapeState(initiativeId, {
          current_page: currentPage,
          last_scraped_at: new Date().toISOString(),
        })

        // Check if we reached the end
        if (data.last || currentPage >= data.totalPages) {
          await markInitialDone(initiativeId, data.totalElements)
          return { pagesScraped, totalRecords, lastPage: currentPage, stoppedReason: 'done' }
        }
      } else {
        currentPage++
      }
    } catch (err: any) {
      const status = err.response?.status
      if (status === 410 || status === 411) {
        const now = new Date()
        const updates: any = { last_scraped_at: now.toISOString() }

        if (status === 411) {
          // limit hit, 10 min not passed — set frozen
          console.log(`Initiative ${initiativeId} frozen (411)`)
          updates.frozen_until = new Date(now.getTime() + 10 * 60 * 1000).toISOString()
        } else {
          // 410 — 10 min passed, token expired, clear freeze
          console.log(`Token expired for initiative ${initiativeId} (410)`)
          updates.frozen_until = null
        }

        await updateScrapeState(initiativeId, updates)
        return {
          pagesScraped, totalRecords, lastPage: currentPage,
          stoppedReason: 'expired',
          errorMessage: status === 411 ? 'Rate limited — frozen for 10 minutes' : 'Token expired — ready for new captcha',
        }
      }

      console.error('Scrape error:', err.message)
      return {
        pagesScraped, totalRecords, lastPage: currentPage,
        stoppedReason: 'error', errorMessage: err.message,
      }
    }
  }
}
