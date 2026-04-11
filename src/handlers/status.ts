import TelegramBot, { Message } from 'node-telegram-bot-api'
import { config } from '../config'
import { getAllScrapeStates, getScrapedCount } from '../services/supabase.service'

function isAllowed(msg: Message): boolean {
  if (config.allowedUsers.length === 0) return true
  return config.allowedUsers.includes(msg.from?.id ?? 0)
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

    const lines: string[] = []

    for (const s of states) {
      const scraped = await getScrapedCount(s.initiative_id)
      const total = s.total_elements || '?'
      const pct = s.total_elements ? Math.round((scraped / s.total_elements) * 100) : '?'

      let status = ''
      if (s.frozen_until) {
        const frozenTime = new Date(s.frozen_until).getTime()
        const now = Date.now()
        if (frozenTime > now) {
          const mins = Math.ceil((frozenTime - now) / 60000)
          status = `🥶 frozen (${mins}m left)`
        } else {
          const minsSince = Math.floor((now - frozenTime) / 60000)
          status = `🟢 ready (unfrozen ${minsSince}m ago)`
        }
      } else if (s.is_initial_done) {
        status = 'initial done'
      } else {
        status = `page ${s.current_page}/${s.total_pages || '?'}`
      }

      const label = s.label || s.initiative_id.slice(0, 8)
      lines.push(`${label}: ${scraped}/${total} (${pct}%) - ${status}`)
    }

    await bot.sendMessage(chatId, lines.join('\n'))
  })
}
