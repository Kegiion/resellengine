# ResellEngine

Automated reselling platform for marketplaces like Vinted and Kleinanzeigen. The backend runs on a Linux VM, the frontend on Vercel, and the database on Supabase (PostgreSQL).

## Architecture

- **Frontend**: Next.js 16 + React 19 + Tailwind CSS 4 → hosted on Vercel
- **Backend**: Node.js + TypeScript + Express + Playwright → hosted on a Linux VM
- **Database**: Supabase PostgreSQL (cloud)
- **AI**: Google GenAI for image generation and SEO text optimization
- **Notifications**: Discord webhook (optional)

## Project Structure

```
Resell/
├── src/                  # Express backend + scrapers + services
├── web/                  # Next.js dashboard
├── scripts/              # One-off helpers (db-init, test-search)
├── supabase_schema.sql   # PostgreSQL schema for Supabase
├── .env.example          # Required environment variables
├── package.json
└── README.md
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-key
DISCORD_WEBHOOK_URL=
SCHEDULER_ENABLED=true
SCHEDULER_INTERVAL_MS=180000
MIN_DELAY_MS=2000
MAX_DELAY_MS=5000
PORT=3000
NODE_ENV=production
```

## Backend Setup (VM)

1. Clone the repo:

```bash
git clone https://github.com/Kegiion/resellengine.git
cd resellengine
```

2. Install dependencies and Playwright Chromium:

```bash
npm install
npx playwright install chromium
```

3. Fill in `.env` (see `.env.example`).

4. Run the database schema in the Supabase SQL Editor (`supabase_schema.sql`).

5. Insert jobs and app config into Supabase tables.

6. Start the server:

```bash
npm run build
npm start
```

The scheduler starts automatically and runs the scrapers every `SCHEDULER_INTERVAL_MS`.

## Frontend Setup (Vercel)

1. Import the GitHub repo in Vercel: `https://github.com/Kegiion/resellengine`
2. In the project settings, set:
   - **Framework Preset**: Next.js
   - **Root Directory**: `web`
   - **Build Command**: `npm run build`
   - **Install Command**: `npm install`
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL`: URL of your VM backend (e.g. `https://vm.yourdomain.com` or `http://your-vm-ip:3000`)
4. Deploy

## Local Development

```bash
# Backend
npm run dev

# Frontend (in a second terminal)
cd web
npm run dev
```

## Important API Endpoints

- `GET /health` — health check
- `GET /deals` — list deals from Supabase
- `POST /generate-image` — generate a product image with Gemini
- `POST /api/deals/:id/optimize-text` — optimize deal text with Gemini and save to DB

## Notes

- Keep API keys and webhook URLs in `.env`, never in source code.
- The scheduler reads jobs and config from Supabase on every cycle.
- Respect marketplace terms of service and avoid aggressive scraping.
