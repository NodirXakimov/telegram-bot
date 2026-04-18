import TelegramBot, { Message } from 'node-telegram-bot-api'
import { config } from '../config'
import { addInitiative, removeInitiative, getAllScrapeStates, getScrapedCount, updateScrapeState } from '../services/supabase.service'

function isAllowed(msg: Message): boolean {
  if (config.allowedUsers.length === 0) return true
  return config.allowedUsers.includes(msg.from?.id ?? 0)
}

export function registerAdminHandler(bot: TelegramBot) {
  bot.onText(/\/add (.+)/, async (msg: Message, match: RegExpExecArray | null) => {
    if (!isAllowed(msg)) return
    if (!match) return

    const parts = match[1].trim().split(/\s+/)
    const id = parts[0]
    const label = parts.slice(1).join(' ') || ''

    if (!id) {
      await bot.sendMessage(msg.chat.id, 'Usage: /add <initiative_id> <label>')
      return
    }

    const ok = await addInitiative(id, label)
    await bot.sendMessage(msg.chat.id, ok
      ? `Added: ${label || id}`
      : `Failed to add. Already exists?`
    )
  })

  bot.onText(/\/remove (.+)/, async (msg: Message, match: RegExpExecArray | null) => {
    if (!isAllowed(msg)) return
    if (!match) return

    const id = match[1].trim()
    const ok = await removeInitiative(id)
    await bot.sendMessage(msg.chat.id, ok ? `Removed: ${id}` : `Failed to remove`)
  })

  bot.onText(/\/resync/, async (msg: Message) => {
    if (!isAllowed(msg)) return

    const states = await getAllScrapeStates()
    if (states.length === 0) {
      await bot.sendMessage(msg.chat.id, 'No initiatives registered.')
      return
    }

    const lines: string[] = []

    for (const s of states) {
      if (!s.total_elements) continue
      const scraped = await getScrapedCount(s.initiative_id)
      const missing = s.total_elements - scraped
      if (missing <= 0) continue

      await updateScrapeState(s.initiative_id, {
        is_initial_done: false,
        current_page: -1,
        frozen_until: null,
      })

      const label = s.label || s.initiative_id.slice(0, 8)
      lines.push(`${label}: ${scraped}/${s.total_elements} — missing ${missing}, reset to page 0`)
    }

    if (lines.length === 0) {
      await bot.sendMessage(msg.chat.id, 'All initiatives are complete. Nothing to resync.')
    } else {
      await bot.sendMessage(msg.chat.id, `Reset ${lines.length} incomplete initiative(s):\n\n${lines.join('\n')}`)
    }
  })
}
