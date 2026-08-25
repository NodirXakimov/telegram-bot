import { createClient } from '@supabase/supabase-js'
import { config } from '../config'
import { ScrapeState, Vote } from '../types'

export const supabase = createClient(config.supabaseUrl, config.supabaseKey)

export async function upsertVotes(initiativeId: string, records: Vote[]): Promise<number> {
  if (records.length === 0) return 0

  const formatted = records.map(r => ({
    initiative_id: initiativeId,
    phone_number: r.phoneNumber,
    vote_date: r.voteDate,
  }))

  const { data, error } = await supabase
    .from('votes')
    .upsert(formatted, { onConflict: 'initiative_id,phone_number,vote_date', ignoreDuplicates: true })
    .select()

  if (error) {
    console.error('Supabase upsert error:', error)
    return 0
  }

  return data?.length ?? 0
}

export async function getScrapedCount(initiativeId: string): Promise<number> {
  const { count, error } = await supabase
    .from('votes')
    .select('*', { count: 'exact', head: true })
    .eq('initiative_id', initiativeId)

  if (error) {
    console.error('Count error:', error)
    return 0
  }

  return count ?? 0
}

/**
 * One round trip for every initiative's row count, via the `vote_counts` view
 * (GROUP BY is not expressible through PostgREST from the client). Initiatives
 * with no votes yet have no row in the view, so callers get 0 from the default.
 *
 * Falls back to per-initiative counts if the view is missing, so the bot still
 * works on a database where the migration has not been applied.
 */
export async function getScrapedCounts(initiativeIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(initiativeIds.map(id => [id, 0]))

  const { data, error } = await supabase
    .from('vote_counts')
    .select('initiative_id,vote_count')

  if (error) {
    console.warn('vote_counts view unavailable, falling back to per-initiative counts:', error.message)
    const fallback = await Promise.all(initiativeIds.map(id => getScrapedCount(id)))
    initiativeIds.forEach((id, i) => counts.set(id, fallback[i]))
    return counts
  }

  for (const row of (data ?? []) as { initiative_id: string; vote_count: number | string }[]) {
    // count(*) is a bigint, which PostgREST serialises as a string.
    if (counts.has(row.initiative_id)) counts.set(row.initiative_id, Number(row.vote_count))
  }
  return counts
}

export async function getNewestVoteDate(initiativeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('votes')
    .select('vote_date')
    .eq('initiative_id', initiativeId)
    .order('vote_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return (data as { vote_date: string }).vote_date
}

export async function getScrapeState(initiativeId: string): Promise<ScrapeState | null> {
  const { data, error } = await supabase
    .from('scrape_state')
    .select('*')
    .eq('initiative_id', initiativeId)
    .single()

  if (error) return null
  return data as ScrapeState
}

export async function getAllScrapeStates(): Promise<ScrapeState[]> {
  const { data, error } = await supabase
    .from('scrape_state')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Get all states error:', error)
    return []
  }

  return (data ?? []) as ScrapeState[]
}

export async function updateScrapeState(
  initiativeId: string,
  updates: Partial<Omit<ScrapeState, 'initiative_id' | 'created_at'>>,
): Promise<void> {
  const { error } = await supabase
    .from('scrape_state')
    .update(updates)
    .eq('initiative_id', initiativeId)

  if (error) console.error('Update state error:', error)
}

// True when scraping this initiative would plausibly achieve something: a run is
// pending, the backfill is unfinished, or enough time has passed that new votes
// may have landed. A caught-up initiative inside its cooldown yields its turn.
export function hasWork(s: ScrapeState, cooldownMs: number): boolean {
  if (!s.is_initial_done || s.catchup_floor) return true
  if (!s.last_scraped_at) return true
  return Date.now() - new Date(s.last_scraped_at).getTime() >= cooldownMs
}

const NO_PRIORITY = Number.MAX_SAFE_INTEGER

function priorityRank(s: ScrapeState): number {
  const i = config.priorityInitiatives.indexOf(s.initiative_id)
  return i === -1 ? NO_PRIORITY : i
}

export async function pickNextInitiative(): Promise<ScrapeState | null> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('scrape_state')
    .select('*')
    .or(`frozen_until.is.null,frozen_until.lt.${now}`)

  if (error || !data || data.length === 0) return null

  const cooldownMs = config.priorityCooldownMinutes * 60 * 1000

  // Dozens of rows at most, so ordering in JS keeps the whole rule in one place
  // rather than splitting it between PostgREST sort clauses and code.
  const sorted = (data as ScrapeState[]).slice().sort((a, b) => {
    // Priority initiatives go first, but only while they have work to do.
    // Without that guard a caught-up favourite would win every captcha forever
    // and the rest of the list would never be scraped at all.
    const aFirst = priorityRank(a) !== NO_PRIORITY && hasWork(a, cooldownMs)
    const bFirst = priorityRank(b) !== NO_PRIORITY && hasWork(b, cooldownMs)
    if (aFirst !== bFirst) return aFirst ? -1 : 1
    if (aFirst && bFirst) {
      const byRank = priorityRank(a) - priorityRank(b)
      if (byRank !== 0) return byRank
    }

    // Then unfinished backfills, then least recently scraped.
    if (a.is_initial_done !== b.is_initial_done) return a.is_initial_done ? 1 : -1

    const at = a.last_scraped_at ? Date.parse(a.last_scraped_at) : -Infinity
    const bt = b.last_scraped_at ? Date.parse(b.last_scraped_at) : -Infinity
    return at - bt
  })

  return sorted[0]
}

export async function addInitiative(initiativeId: string, label: string): Promise<boolean> {
  const { error } = await supabase
    .from('scrape_state')
    .insert({ initiative_id: initiativeId, label })

  if (error) {
    console.error('Add initiative error:', error)
    return false
  }
  return true
}

export async function removeInitiative(initiativeId: string): Promise<boolean> {
  const { error } = await supabase
    .from('scrape_state')
    .delete()
    .eq('initiative_id', initiativeId)

  if (error) {
    console.error('Remove initiative error:', error)
    return false
  }
  return true
}
