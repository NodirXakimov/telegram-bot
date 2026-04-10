// src/services/image.service.ts
import axios from 'axios'

export async function fetchImageBuffer(): Promise<Buffer> {
  const res = await axios.get('https://openbudget.uz/api/v2/vote/captcha-2', {
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN}`,
      'Access-Captcha': process.env.CAPTCHA_TOKEN,
    },
  })

  console.log('response')
  console.log(res.data)
  const base64: string = res.data.image

  // remove base64 prefix if exists
  const cleaned = base64.replace(/^data:image\/\w+;base64,/, '')

  return Buffer.from(cleaned, 'base64')
}
