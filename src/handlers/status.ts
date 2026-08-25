import TelegramBot, { Message } from 'node-telegram-bot-api'
import { config } from '../config'
import { getAllScrapeStates, getScrapedCounts } from '../services/supabase.service'

function isAllowed(msg: Message): boolean {
  if (config.allowedUsers.length === 0) return true
  return config.allowedUsers.includes(msg.from?.id ?? 0)
}

function shortDate(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

export function registerStatusHandler(bot: TelegramBot) {
  bot.onText(/\/status/, async (msg: Message) => {
    if (!isAllowed(msg)) return

    const chatId = msg.chat.id
    const states = await getAllScrapeStates()

    if (states.length === 0) {
      await bot.sendMessage(chatId, 'No initiatives registered. Use /add <id> <label>')
      return
    }

    const counts = await getScrapedCounts(states.map(s => s.initiative_id))
    const lines: string[] = []

    states.forEach((s) => {
      const scraped = counts.get(s.initiative_id) ?? 0
      const total = s.total_elements || '?'
      const pct = s.total_elements ? Math.floor((scraped / s.total_elements) * 100) : '?'

      let status: string
      const frozenTime = s.frozen_until ? new Date(s.frozen_until).getTime() : 0
      const now = Date.now()

      if (frozenTime > now) {
        status = `🥶 frozen (${Math.ceil((frozenTime - now) / 60000)}m left)`
      } else if (s.catchup_floor) {
        status = `⏸ resumable — stopped at ${shortDate(s.catchup_floor)}`
      } else if (!s.is_initial_done) {
        status = `backfill page ${s.current_page}/${s.total_pages || '?'}`
      } else if (!s.coverage_newest) {
        status = '🔍 full re-verify queued'
      } else {
        status = `✅ covered to ${shortDate(s.coverage_newest)}`
      }

      const label = s.label || s.initiative_id.slice(0, 8)
      const star = config.priorityInitiatives.includes(s.initiative_id) ? '⭐ ' : ''
      lines.push(`${star}${label}: ${scraped}/${total} (${pct}%) - ${status}`)
    })

    await bot.sendMessage(chatId, lines.join('\n'))
  })
}
