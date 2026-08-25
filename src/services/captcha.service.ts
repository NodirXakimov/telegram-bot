import axios from 'axios'
import { config } from '../config'
import { InitiativeTokenResponse } from '../types'
import { withRetry } from './retry'

const API_BASE = 'https://openbudget.uz/api/v2'
const TIMEOUT_MS = 15000

const authHeaders = () => ({
  Authorization: `Bearer ${config.apiToken}`,
  'Access-Captcha': config.captchaToken,
})

export async function fetchCaptcha(): Promise<{ image: Buffer; captchaKey: string }> {
  const res = await withRetry('fetchCaptcha', () => axios.get(`${API_BASE}/vote/captcha-2`, {
    headers: authHeaders(),
    timeout: TIMEOUT_MS,
  }))

  const base64: string = res.data.image
  const cleaned = base64.replace(/^data:image\/\w+;base64,/, '')

  return {
    image: Buffer.from(cleaned, 'base64'),
    captchaKey: res.data.captchaKey,
  }
}

export async function fetchInitiativeToken(
  initiativeId: string,
  captchaKey: string,
  captchaResult: string,
): Promise<InitiativeTokenResponse> {
  // Not retried on 4xx: a wrong captcha answer must surface immediately, and the
  // captchaKey is single-use so repeating it would fail anyway.
  const res = await withRetry('fetchInitiativeToken', () => axios.post(`${API_BASE}/info/get-initiative-token`, {
    initiativeId,
    captchaKey,
    captchaResult,
  }, {
    headers: authHeaders(),
    timeout: TIMEOUT_MS,
  }))

  return res.data
}
