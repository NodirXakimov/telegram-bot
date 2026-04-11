import { config } from './config'
import TelegramBot from 'node-telegram-bot-api'
import { registerScrapeHandler } from './handlers/scrape'
import { registerStatusHandler } from './handlers/status'
import { registerAdminHandler } from './handlers/admin'

import dns from 'dns'
dns.setDefaultResultOrder('ipv4first')

const bot = new TelegramBot(config.botToken, {
  polling: {
    interval: 300,
    autoStart: true,
  },
})

// handlers
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Bot is running 🚀\n\nCommands:\n/scrape - Start scraping\n/status - View progress\n/add <id> <label> - Add initiative\n/remove <id> - Remove initiative')
})

registerScrapeHandler(bot)
registerStatusHandler(bot)
registerAdminHandler(bot)

bot.on('polling_error', (error: any) => {
  if (error.code === 'EFATAL' || error.cause?.code === 'ETIMEDOUT') return
  console.error('Polling error:', error.message)
})

process.on('uncaughtException', (err: any) => {
  if (err.cause?.code === 'ETIMEDOUT' || err.code === 'EFATAL') return
  console.error('Uncaught:', err.message)
})

console.log('Bot started...')
