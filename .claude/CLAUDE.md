# ResellEngine — Claude Code Guidance

Project-specific guidance for the ResellEngine reselling platform in `C:\Users\firea\Desktop\Coding\Resell`.

## Tech Stack

- **Backend**: Node.js 20+, TypeScript, Express, `tsx` for dev execution
- **Database**: Supabase (PostgreSQL) via `@supabase/supabase-js`
- **Scrapers**: Playwright (Chromium), axios, user-agents, anti-bot delays
- **AI**: Google GenAI (`@google/genai`) for image generation and SEO text optimization
- **Frontend**: Next.js 16.2.9, React 19, Tailwind CSS 4
- **Notifications**: Discord webhook (optional)

## Project Structure

```
Resell/
├── src/
│   ├── index.ts               # Express server + scheduler init
│   ├── scrapers/
│   │   ├── vintedScraper.ts
│   │   ├── kleinanzeigenScraper.ts
│   │   └── baseScraper.ts
│   ├── services/
│   │   ├── database.ts        # Supabase client + DB operations
│   │   ├── scheduler.ts       # Automated sourcing loop
│   │   ├── valueChecker.ts    # ROI / resell value estimation
│   │   ├── geminiService.ts   # Image + SEO text generation
│   │   ├── notificationGateway.ts
│   │   ├── ebayValueLookup.ts
│   │   └── llmValueLookup.ts
│   ├── utils/
│   │   ├── delay.ts
│   │   ├── logger.ts
│   │   └── userAgents.ts
│   ├── types/
│   │   └── index.ts
│   └── types/
│       └── modules.d.ts
├── web/                       # Next.js dashboard
│   └── src/app/page.tsx
├── scripts/
│   ├── db-init.ts
│   └── test-search.ts
├── supabase_schema.sql        # PostgreSQL schema for Supabase
├── .env.example               # All env vars
├── package.json
├── tsconfig.json
└── .claude/CLAUDE.md          # This file
```

## Important Commands

```bash
# Backend (runs Express + scheduler automatically)
npm run dev

# Production build
npm run build
npm run start

# One-off scraper test
npm run test:search

# Initialize Supabase schema
npm run db:init

# Install Playwright Chromium
npm run scraper:install

# Frontend
 cd web
 npm run dev        # port 3000 by default, or use --port
 npm run build
 npm run start
```

## Environment Variables

All sensitive config and runtime variables live in `.env` (see `.env.example`):

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `GEMINI_API_KEY`, `REMOVE_BG_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- `DISCORD_WEBHOOK_URL`
- `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_MS`
- `MIN_DELAY_MS`, `MAX_DELAY_MS`
- `VINTED_SESSION_COOKIE`
- `SHIPPING_ESTIMATE`, `VINTED_SELLER_FEE_PERCENT`, `VINTED_BUYER_PROTECTION_PERCENT`
- `PORT`, `NODE_ENV`

## Domain Rules

- **Never hardcode secrets or API keys** — always use `process.env` or Supabase config.
- **Anti-bot behavior**: keep delays between jobs (`MIN_DELAY_MS`/`MAX_DELAY_MS`), rotate user agents, and avoid aggressive loops.
- **Scheduler**: started automatically in `src/index.ts` via `startScheduler(client, { intervalMs: 180_000 })`. The scheduler reads jobs and config from Supabase on every cycle.
- **Deals**: inserted with `ON CONFLICT` / `upsert` semantics so re-running scrapers updates existing deals without duplicates.
- **Text optimization**: `POST /api/deals/:id/optimize-text` uses Claude to generate SEO text and stores it in the `deals` table (`optimized_*` columns).
- **Image generation**: `POST /generate-image` returns a base64 data URL.
- **Job creation**: `POST /jobs` creates or updates a search job in Supabase. Body fields: `id`, `platform`, `keywords` (array or comma/space string), `maxPrice`, `minDesiredProfit`, `condition`, `enabled`.
- **Image damage analysis**: `verifyDeal()` in `src/services/valueChecker.ts` calls `analyzeProductImage()` from `src/services/geminiService.ts` before sending a deal. If damage is detected, the estimated resell value is reduced by 70% (factor 0.3), usually blocking the 15€ profit threshold and the Discord alert.

## Next.js Frontend Notes

- The frontend is a Next.js 16 App Router app in `web/`.
- Tailwind CSS 4 is used; there is no `tailwind.config.js` by default (v4 config lives in CSS).
- Dashboard tabs are responsive; short labels are shown on mobile.
- UI changes require desktop + mobile screenshots via Playwright MCP before marking done.

## Useful Files to Check

- `src/services/database.ts` for Supabase table operations
- `src/services/scheduler.ts` for the sourcing loop
- `supabase_schema.sql` for the database schema
- `src/index.ts` for server/endpoint/scheduler wiring
- `web/src/app/page.tsx` for the dashboard UI

## Common Pitfalls

- `config.json` is no longer the source of truth for runtime config; Supabase `app_config` and `jobs` tables are.
- `src/services/database.ts` no longer uses SQLite/sql.js; it now expects `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
- The frontend relies on `NEXT_PUBLIC_API_URL` or falls back to `http://localhost:3000`.
