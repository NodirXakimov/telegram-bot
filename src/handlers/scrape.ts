import TelegramBot, { Message } from 'node-telegram-bot-api'
import { config } from '../config'
import { fetchCaptcha, fetchInitiativeToken } from '../services/captcha.service'
import { scrapeWithToken } from '../services/scraper.service'
import { pickNextInitiative, getScrapedCount, getScrapeState } from '../services/supabase.service'

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
    } catch (error: any) {
      const reason = error.response?.status
        ?? error.code
        ?? error.cause?.code
        ?? error.message
      console.error('Captcha load failed:', reason, error.message)
      await bot.sendMessage(chatId, `Failed to load captcha (${reason}). Send /scrape to try again.`)
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

      const [scraped, state] = await Promise.all([
        getScrapedCount(pending.initiativeId),
        getScrapeState(pending.initiativeId),
      ])

      let startMsg: string
      if (state?.catchup_floor) {
        startMsg = `Token received. Resuming interrupted run — binary searching for the resume page...`
      } else if (state && !state.is_initial_done) {
        startMsg = `Token received. Backfill from page ${state.current_page}...`
      } else if (state && !state.coverage_newest) {
        startMsg = `Token received. Full re-verify — walking every page...`
      } else {
        startMsg = `Token received. Catch-up for new votes...`
      }
      await bot.sendMessage(chatId, `${startMsg} (${scraped} records in DB)`)

      const scrapeResult = await scrapeWithToken(result.token, pending.initiativeId)

      const lines = [
        `Scraping finished:`,
        `Pages fetched: ${scrapeResult.pagesScraped}`,
        `New records: ${scrapeResult.totalRecords}`,
        `Stopped at page: ${scrapeResult.lastPage}`,
        `Reason: ${scrapeResult.stoppedReason}`,
      ]
      if (scrapeResult.searchFetches > 0) {
        lines.splice(2, 0, `Resume-search probes: ${scrapeResult.searchFetches}`)
      }
      if (scrapeResult.errorMessage) {
        lines.push(`Error: ${scrapeResult.errorMessage}`)
      }
      if (scrapeResult.stoppedReason === 'expired') {
        lines.push('\nProgress saved. Send /scrape to resume where this left off.')
      }

      await bot.sendMessage(chatId, lines.join('\n'))
    } catch (error: any) {
      const errMsg = error.response?.data?.message || error.message
      console.error('Token/scrape failed:', errMsg)
      await bot.sendMessage(chatId, `Failed: ${errMsg}`)
    }
  })
}
