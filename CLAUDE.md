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
- `PRIORITY_INITIATIVES` — Comma-separated initiative ids that `/scrape` prefers, earliest = highest priority (optional)
- `PRIORITY_COOLDOWN_MINUTES` — How long a caught-up priority initiative yields its turn to the rotation (optional, default 30)

## Initiative Selection

`pickNextInitiative` skips frozen initiatives, then orders: priority initiatives that have work, by listed order → unfinished backfills → least recently scraped.

"Has work" means a pending resume (`catchup_floor` set), an unfinished backfill, or nothing scraped within the cooldown. The guard is what stops a caught-up priority initiative from winning every captcha and starving the rest of the list.

## Database (Supabase)

**`votes` table**: `initiative_id`, `phone_number`, `vote_date` — unique on all three columns

**`vote_counts` view**: `SELECT initiative_id, count(*) AS vote_count FROM votes GROUP BY initiative_id`. Backs `getScrapedCounts`, which fetches every initiative's total in one round trip — PostgREST cannot express GROUP BY from the client. `/status` and `/resync` use it; the code falls back to per-initiative counts if the view is absent.

**`scrape_state` table**: Per-initiative tracking — `initiative_id`, `label`, `total_elements`, `current_page`, `total_pages`, `is_initial_done`, `frozen_until`, `last_scraped_at`, plus the coverage cursors:
- `coverage_newest` — newest vote covered by a contiguous block reaching down to the oldest vote. A catch-up stops when it reaches this point.
- `catchup_floor` — oldest vote fetched by a run that was cut short. Non-null means a run is pending.
- `catchup_top` — newest vote at the moment that pending run began.

Page numbers are not stable identifiers: the API sorts newest-first, so every new vote shifts existing votes to higher indices. All resume logic keys off `vote_date`, never off a stored page number. `current_page` is a search hint and a display value only.

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

One code path (`scrapeWithToken`), two finishing conditions:

- **Backfill** (`is_initial_done = false`): can only finish by reaching the bottom of the list (`last: true`). Sets `is_initial_done` on arrival.
- **Catch-up** (`is_initial_done = true`): finishes as soon as a page's oldest vote falls below `coverage_newest`, plus one overshoot page (`vote_date` has minute precision, so boundary-minute votes can straddle a page edge).

Both persist `catchup_floor` after every page, so a 411 mid-run loses nothing.

**Resuming**: when `catchup_floor` is set, the next run galloping-searches from the `current_page` hint for the page holding that date, then binary-searches the bracket — ~2 probes typically, vs ~7 for a blind full-range search and ~20 for re-walking. Probed pages are upserted, so probes still contribute data.

**Watermark advance**: on completion `coverage_newest` moves to `catchup_top` — the newest vote when the run *began* — not to the newest row in the table. Votes cast mid-run sit above that band and are left for the next catch-up. Advancing to the newest row instead would claim coverage over a gap.

`/resync` clears all three cursors, which makes the next run walk every page to the bottom: a full re-verify.

## Handler Pattern

Create a handler in `src/handlers/`, export a `register*Handler(bot)` function, call it from `bot.ts`. Use `isAllowed(msg)` guard for access control.
