export interface ScrapeState {
  initiative_id: string
  label: string
  total_elements: number
  current_page: number
  total_pages: number
  is_initial_done: boolean
  last_scraped_at: string | null
  frozen_until: string | null
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
  lastPage: number
  stoppedReason: 'expired' | 'done' | 'error'
  errorMessage?: string
}

export interface InitiativeTokenResponse {
  token: string
  date: string
  estimatedResultTime: string
}
