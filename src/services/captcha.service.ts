import axios from 'axios'
import { config } from '../config'
import { InitiativeTokenResponse } from '../types'

const API_BASE = 'https://openbudget.uz/api/v2'

const authHeaders = () => ({
  Authorization: `Bearer ${config.apiToken}`,
  'Access-Captcha': config.captchaToken,
})

export async function fetchCaptcha(): Promise<{ image: Buffer; captchaKey: string }> {
  const res = await axios.get(`${API_BASE}/vote/captcha-2`, {
    headers: authHeaders(),
  })

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
  const res = await axios.post(`${API_BASE}/info/get-initiative-token`, {
    initiativeId,
    captchaKey,
    captchaResult,
  }, {
    headers: authHeaders(),
  })

  return res.data
}
