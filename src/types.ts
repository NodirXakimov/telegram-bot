export interface ScrapeState {
  initiative_id: string
  label: string
  total_elements: number
  current_page: number
  total_pages: number
  is_initial_done: boolean
  last_scraped_at: string | null
  frozen_until: string | null
  // Newest vote covered by a contiguous block reaching down to the oldest vote.
  // A catch-up run stops once it reaches this point.
  coverage_newest: string | null
  // Oldest vote fetched by a run that was cut short. Null when no run is pending.
  catchup_floor: string | null
  // Newest vote at the moment the pending run began. The run's covered band is
  // (catchup_floor, catchup_top]; votes above it arrived mid-run and stay uncovered.
  catchup_top: string | null
  created_at: string
}

export interface Vote {
  phoneNumber: string
  voteDate: string
}

export interface PageResponse {
  content: Vote[]
  totalPages: number
  totalElements: number
  last: boolean
  number: number
  numberOfElements: number
}

export interface ScrapeResult {
  pagesScraped: number
  totalRecords: number
  // Pages spent locating the resume point rather than making forward progress.
  searchFetches: number
  lastPage: number
  stoppedReason: 'expired' | 'done' | 'error'
  errorMessage?: string
}

export interface InitiativeTokenResponse {
  token: string
  date: string
  estimatedResultTime: string
}
