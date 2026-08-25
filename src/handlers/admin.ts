import TelegramBot, { Message } from 'node-telegram-bot-api'
import { config } from '../config'
import { addInitiative, removeInitiative, getAllScrapeStates, getScrapedCounts, updateScrapeState } from '../services/supabase.service'

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

    const id = match?.[1].trim()
    if (!id) return

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

    // Clearing the watermark makes the next run walk every page down to the bottom
    // instead of stopping once it reaches covered territory — a full re-verify.
    const counts = await getScrapedCounts(states.map(s => s.initiative_id))

    for (const s of states) {
      const scraped = counts.get(s.initiative_id) ?? 0

      await updateScrapeState(s.initiative_id, {
        coverage_newest: null,
        catchup_floor: null,
        catchup_top: null,
        frozen_until: null,
      })

      const label = s.label || s.initiative_id.slice(0, 8)
      lines.push(`${label}: ${scraped}/${s.total_elements || '?'} — full re-verify queued`)
    }

    await bot.sendMessage(msg.chat.id, [
      `Queued ${lines.length} initiative(s) for full re-verify:`,
      '',
      ...lines,
    ].join('\n'))
  })
}
