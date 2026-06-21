# ResellEngine

Automated reselling platform for marketplaces like Vinted and Kleinanzeigen. Phase 1 focuses on the modular scraper + value-check pipeline.

## Phase 1 Scope

- Project structure (Node.js + TypeScript)
- `config.json` driven search jobs
- Vinted scraper with anti-bot basics (random delays, rotating user agents)
- Value-checker stub with ROI calculation
- SQLite persistence + Discord notification gateway
- Express API skeleton

## Quick Start

1. Install dependencies:

```bash
cd Resell
npm install
npx playwright install chromium
```

2. Copy environment file and fill in your keys (optional for Phase 1):

```bash
cp .env.example .env
```

3. Run the first test search:

```bash
npm run test:search
```

This runs the first enabled Vinted job from `config.json`, prints found deals + ROI, saves them to SQLite and sends a Discord notification if `DISCORD_WEBHOOK_URL` is set.

## Scripts

- `npm run dev` — start the API server in dev mode
- `npm run build` — compile TypeScript to `dist/`
- `npm run test:search` — run a single Vinted test search
- `npm run db:init` — initialize the SQLite database
- `npm run scraper:install` — install Playwright Chromium browser

## Configuration

Edit `config.json` to add or modify search jobs:

```json
{
  "jobs": [
    {
      "id": "vinted-nike-dunk",
      "platform": "vinted",
      "keywords": ["nike", "dunk"],
      "maxPrice": 80,
      "minDesiredProfit": 15,
      "condition": "good",
      "enabled": true
    }
  ]
}
```

## Notes

- Keep API keys and webhook URLs in `.env`, never in `config.json`.
- The Vinted scraper uses Playwright with randomized delays and rotating user agents. If you hit a bot wall, reduce search frequency and consider residential proxies.
- You are responsible for complying with each marketplace's terms of service.
