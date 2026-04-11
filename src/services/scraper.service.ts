import axios from 'axios'
import { PageResponse, ScrapeResult } from '../types'
import { upsertVotes, updateScrapeState, getScrapeState } from './supabase.service'

const BASE_URL = 'https://openbudget.uz'

async function fetchPage(token: string, page: number): Promise<PageResponse> {
  const res = await axios.get(`${BASE_URL}/api/v2/info/votes/${token}`, {
    params: { page },
  })
  return res.data
}

export async function scrapeWithToken(token: string, initiativeId: string): Promise<ScrapeResult> {
  const state = await getScrapeState(initiativeId)
  if (!state) {
    return { pagesScraped: 0, totalRecords: 0, lastPage: 0, stoppedReason: 'error', errorMessage: 'Initiative not found in scrape_state' }
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
        })
      }

      if (!data.content || data.content.length === 0) {
        if (!isInitialDone) {
          await updateScrapeState(initiativeId, { is_initial_done: true })
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
          await updateScrapeState(initiativeId, { is_initial_done: true })
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
