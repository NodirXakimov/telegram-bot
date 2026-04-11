import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`${key} is missing in .env`)
  return val
}

export const config = {
  botToken: required('BOT_TOKEN'),
  apiToken: required('API_TOKEN'),
  captchaToken: required('CAPTCHA_TOKEN'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseKey: required('SUPABASE_KEY'),
  allowedUsers: (process.env.ALLOWED_USERS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number),
}
