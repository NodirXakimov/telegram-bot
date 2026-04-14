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

export async function pickNextInitiative(): Promise<ScrapeState | null> {
  const now = new Date().toISOString()

  // Get all unfrozen initiatives, prioritize incomplete initial scrapes, then least recently scraped
  const { data, error } = await supabase
    .from('scrape_state')
    .select('*')
    .eq('is_initial_done', false)
    .or(`frozen_until.is.null,frozen_until.lt.${now}`)
    .order('last_scraped_at', { ascending: true, nullsFirst: true })
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as ScrapeState
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
