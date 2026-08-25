// Transient network faults reaching openbudget.uz. A request that never got an
// HTTP response is safe to repeat; one that came back with a 4xx is not.
const RETRYABLE_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ECONNREFUSED',
  'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK', 'EFATAL',
])

export function isRetryable(err: any): boolean {
  const status = err?.response?.status
  // 410/411 are the scraper's normal stop signals and 4xx generally means the
  // request itself was wrong — repeating either just burns the page budget.
  if (status) return status === 429 || status >= 500
  const code = err?.code ?? err?.cause?.code
  return typeof code === 'string' && RETRYABLE_CODES.has(code)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 600,
): Promise<T> {
  let lastErr: any
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      if (i === attempts || !isRetryable(err)) throw err
      // Exponential backoff with jitter so repeated failures don't sync up.
      const delay = baseDelayMs * 2 ** (i - 1) + Math.floor(Math.random() * 250)
      const reason = err?.response?.status ?? err?.code ?? err?.cause?.code ?? err?.message
      console.warn(`[retry] ${label} failed (${reason}), attempt ${i}/${attempts}, retrying in ${delay}ms`)
      await sleep(delay)
    }
  }
  throw lastErr
}
