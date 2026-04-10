# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram bot built with TypeScript and `node-telegram-bot-api`. It connects via long-polling (not webhooks) and currently supports:
- `/start` — greeting message
- `/image` — fetches a captcha image from the OpenBudget API (`openbudget.uz`), decodes it from base64, and sends it as a photo
- Echo — replies with any non-command text

## Running the Bot

```bash
npx ts-node src/bot.ts
```

There are no build/lint/test scripts configured in `package.json`. TypeScript is compiled on-the-fly via `ts-node`.

## Environment Variables

Configured in `.env` (loaded via `dotenv/config`):
- `BOT_TOKEN` — Telegram bot token (required, validated at startup)
- `API_TOKEN` — Bearer token for the OpenBudget API
- `CAPTCHA_TOKEN` — Access-Captcha header value for the OpenBudget API

## Architecture

- `src/bot.ts` — Entry point. Creates the `TelegramBot` instance, registers handlers, sets DNS to IPv4-first.
- `src/handlers/` — Each handler exports a `register*Handler(bot)` function that attaches listeners to the bot instance.
- `src/services/` — External API integrations. `image.service.ts` calls the OpenBudget captcha endpoint and returns a decoded `Buffer`.

The pattern for adding new bot commands: create a handler in `src/handlers/`, export a registration function, and call it from `bot.ts`.
