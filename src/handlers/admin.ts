import TelegramBot, { Message } from 'node-telegram-bot-api'
import { config } from '../config'
import { addInitiative, removeInitiative } from '../services/supabase.service'

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
}
