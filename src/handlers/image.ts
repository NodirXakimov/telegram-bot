// src/handlers/image.ts
import TelegramBot, { Message } from 'node-telegram-bot-api'
import { fetchImageBuffer } from '../services/image.service'

export const registerImageHandler = (bot: TelegramBot) => {
  bot.onText(/\/image/, async (msg: Message) => {
    const chatId = msg.chat.id

    try {
      // UX improvement
      const loadingMsg = await bot.sendMessage(chatId, 'Fetching image... ⏳')

      const buffer = await fetchImageBuffer()

      await bot.sendPhoto(chatId, buffer, {
        caption: 'Here is your image 📸',
      })

      // remove loading message
      await bot.deleteMessage(chatId, loadingMsg.message_id)

    } catch (error) {
      console.error(error)

      await bot.sendMessage(chatId, '❌ Failed to load image')
    }
  })
}
