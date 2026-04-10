import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'
import { registerImageHandler } from "./handlers/image";

import dns from 'dns'

dns.setDefaultResultOrder('ipv4first')

// validate env
const token = process.env.BOT_TOKEN
if (!token) throw new Error('BOT_TOKEN is missing')

const bot = new TelegramBot(token, {
  polling: {
    interval: 300, // faster response
    autoStart: true,
  },
})

// handlers
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Bot is running locally 🚀')
})

bot.on('message', (msg) => {
  if (msg.text && msg.text !== '/start') {
    bot.sendMessage(msg.chat.id, `Echo: ${msg.text}`)
  }
})

// error handling (important)
bot.on('polling_error', (error: any) => {
  if (error.code === 'EFATAL') return // ignore startup noise

  console.error('Polling error:', error.message)
})

registerImageHandler(bot)

console.log('Bot started...')
