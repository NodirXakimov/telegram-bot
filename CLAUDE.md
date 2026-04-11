# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram bot that scrapes vote data from OpenBudget.uz and stores it in Supabase. Part of a larger system: this bot collects data, a Vue 3 frontend (hosted on GitHub Pages) lets users search phone numbers across votes — something OpenBudget's own site doesn't support.

## How It Works

1. User sends `/scrape` → bot picks the best initiative and shows a captcha image
2. User solves the captcha → bot gets a token (valid 10 minutes)
3. Bot scrapes paginated vote data using that token and upserts to Supabase
4. After ~20 pages, OpenBudget freezes the initiative for 10 minutes → bot stops, user can `/scrape` another initiative

## OpenBudget API Constraints

- **Captcha flow**: `GET /api/v2/vote/captcha-2` → solve → `POST /api/v2/info/get-initiative-token` → token
- **Votes endpoint**: `GET /api/v2/info/votes/{token}?page=N` — returns 12 items per page
- **Rate limit**: ~20 pages per token, then initiative freezes for 10 minutes (HTTP 410)
- **Sort order**: Newest votes on page 0, oldest on last page
- **Auth headers**: `Authorization: Bearer {API_TOKEN}` and `Access-Captcha: {CAPTCHA_TOKEN}` on all requests
- While one initiative is frozen, a different initiative can be scraped with a separate token

## Running the Bot

```bash
npx ts-node src/bot.ts
```

No build/lint/test scripts in `package.json`. TypeScript runs on-the-fly via `ts-node`.

## Environment Variables

Configured in `.env` (loaded via `dotenv/config`):
- `BOT_TOKEN` — Telegram bot token (required, validated at startup)
- `API_TOKEN` — Bearer JWT for the OpenBudget API
- `CAPTCHA_TOKEN` — Access-Captcha header value
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_KEY` — Supabase service key
- `ALLOWED_USERS` — Comma-separated Telegram user IDs for access control

## Database (Supabase)

**`votes` table**: `initiative_id`, `phone_number`, `vote_date` — unique on all three columns

**`scrape_state` table**: Per-initiative tracking — `initiative_id`, `label`, `total_elements`, `current_page`, `total_pages`, `is_initial_done`, `frozen_until`, `last_scraped_at`

## Architecture

- `src/bot.ts` — Entry point. Creates TelegramBot instance (polling), registers handlers, DNS IPv4-first.
- `src/handlers/` — Each handler exports a `register*Handler(bot)` function that attaches listeners.
  - `scrape.ts` — `/scrape`: auto-picks initiative, captcha flow, triggers scraping
  - `status.ts` — `/status`: shows progress per initiative
  - `admin.ts` — `/add`, `/remove`: manage initiatives
- `src/services/` — Business logic and external APIs.
  - `captcha.service.ts` — Captcha fetch and initiative token API calls
  - `scraper.service.ts` — Page-by-page scraping, DB-backed state, catch-up mode
  - `supabase.service.ts` — Shared Supabase client, DB helpers

## Scraping Modes

- **Initial scrape** (`is_initial_done = false`): Sequential pages 0 → totalPages. Resumes from `current_page` after freeze/restart.
- **Catch-up scrape** (`is_initial_done = true`): Starts from page 0, stops when hitting all-known records. Efficient for grabbing only new votes.

## Handler Pattern

Create a handler in `src/handlers/`, export a `register*Handler(bot)` function, call it from `bot.ts`. Use `isAllowed(msg)` guard for access control.
