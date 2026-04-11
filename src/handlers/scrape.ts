import TelegramBot, { Message } from 'node-telegram-bot-api'
import { config } from '../config'
import { fetchCaptcha, fetchInitiativeToken } from '../services/captcha.service'
import { scrapeWithToken } from '../services/scraper.service'
import { pickNextInitiative, getScrapedCount } from '../services/supabase.service'

// pending captcha per chat: chatId -> { captchaKey, initiativeId }
const pendingCaptchas = new Map<number, { captchaKey: string; initiativeId: string }>()

function isAllowed(msg: Message): boolean {
  if (config.allowedUsers.length === 0) return true
  return config.allowedUsers.includes(msg.from?.id ?? 0)
}

export function registerScrapeHandler(bot: TelegramBot) {
  bot.onText(/\/scrape/, async (msg: Message) => {
    if (!isAllowed(msg)) return

    const chatId = msg.chat.id

    try {
      const initiative = await pickNextInitiative()
      if (!initiative) {
        await bot.sendMessage(chatId, 'No available initiatives. All are frozen or none registered. Use /status to check.')
        return
      }

      const loadingMsg = await bot.sendMessage(chatId,
        `Fetching captcha for: ${initiative.label || initiative.initiative_id}...`
      )

      const { image, captchaKey } = await fetchCaptcha()

      await bot.sendPhoto(chatId, image, {
        caption: `Initiative: ${initiative.label || initiative.initiative_id}\nSolve the captcha:`,
      }, {
        filename: 'captcha.jpg',
        contentType: 'image/jpeg',
      })

      await bot.deleteMessage(chatId, loadingMsg.message_id)

      pendingCaptchas.set(chatId, { captchaKey, initiativeId: initiative.initiative_id })
    } catch (error) {
      console.error(error)
      await bot.sendMessage(chatId, 'Failed to load captcha')
    }
  })

  bot.on('message', async (msg: Message) => {
    if (!isAllowed(msg)) return

    const chatId = msg.chat.id
    const pending = pendingCaptchas.get(chatId)

    if (!pending || !msg.text || msg.text.startsWith('/')) return

    pendingCaptchas.delete(chatId)

    try {
      const result = await fetchInitiativeToken(pending.initiativeId, pending.captchaKey, msg.text.trim())

      const scraped = await getScrapedCount(pending.initiativeId)
      await bot.sendMessage(chatId,
        `Token received. Scraping from page... (${scraped} records in DB)`
      )

      const scrapeResult = await scrapeWithToken(result.token, pending.initiativeId)

      const lines = [
        `Scraping finished:`,
        `Pages: ${scrapeResult.pagesScraped}`,
        `New records: ${scrapeResult.totalRecords}`,
        `Stopped at page: ${scrapeResult.lastPage}`,
        `Reason: ${scrapeResult.stoppedReason}`,
      ]
      if (scrapeResult.errorMessage) {
        lines.push(`Error: ${scrapeResult.errorMessage}`)
      }
      if (scrapeResult.stoppedReason === 'expired') {
        lines.push('\nSend /scrape to continue with next initiative')
      }

      await bot.sendMessage(chatId, lines.join('\n'))
    } catch (error: any) {
      const errMsg = error.response?.data?.message || error.message
      console.error('Token/scrape failed:', errMsg)
      await bot.sendMessage(chatId, `Failed: ${errMsg}`)
    }
  })
}
