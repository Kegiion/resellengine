import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
import {
  initDatabase,
  getDeals,
  getGlobalClient,
  saveOptimizedDescription,
  dealExists,
} from './services/database.js';
import { log } from './utils/logger.js';
import {
  generateProductImage,
  generateSEOText,
  loadGeminiApiKeyFromConfig,
} from './services/geminiService.js';
import { startRealtimeWorker, getWorkerStats } from './services/realtimeWorker.js';
import { startScheduler } from './services/scheduler.js';
import { initDiscordBot } from './discordBot.js';
import { runHealthChecks } from './services/healthChecks.js';
import type { VerifiedDeal } from './types/index.js';

const geminiApiKey = process.env.GEMINI_API_KEY || loadGeminiApiKeyFromConfig();
if (geminiApiKey && !process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = geminiApiKey;
}

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) return callback(null, true);

  const defaultPatterns = [
    /^https:\/\/resellengine.*\.vercel\.app$/,
    /^https:\/\/.*-nevrion-s-projects\.vercel\.app$/,
    /^http:\/\/localhost(:\d+)?$/,
    /^https:\/\/localhost(:\d+)?$/,
  ];

  const allPatterns = [
    ...defaultPatterns,
    ...allowedOrigins.map((o) => new RegExp(o.replace(/\./g, '\\.').replace(/\*/g, '.*'))),
  ];

  if (allPatterns.some((rx) => rx.test(origin))) {
    return callback(null, true);
  }

  log('warn', 'CORS blocked origin', { origin });
  callback(new Error('Not allowed by CORS'));
};

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.get('/config', async (_req, res) => {
  const client = getGlobalClient();
  if (!client) {
    res.status(503).json({ error: 'Database not initialized' });
    return;
  }
  try {
    const { data, error } = await client.from('app_config').select('*').eq('id', 1).single();
    if (error) throw error;
    const { data: jobs } = await client.from('jobs').select('*').eq('enabled', true);
    res.json({
      appConfig: data,
      jobs: jobs ?? [],
    });
  } catch (err) {
    log('error', 'Failed to load config', { error: String(err) });
    res.status(500).json({ error: 'Failed to load config' });
  }
});

app.post('/jobs', async (req, res) => {
  const client = getGlobalClient();
  if (!client) {
    res.status(503).json({ error: 'Database not initialized' });
    return;
  }

  const body = req.body as Partial<{
    id: string;
    platform: string;
    keywords: string | string[];
    maxPrice: number;
    minDesiredProfit: number;
    condition: string;
    enabled: boolean;
  }>;

  const id = (body.id ?? '').trim();
  const platform = (body.platform ?? 'vinted').trim() as 'vinted' | 'kleinanzeigen';
  const keywordsRaw = body.keywords;
  const keywords = Array.isArray(keywordsRaw)
    ? keywordsRaw.map((k) => String(k).trim()).filter(Boolean)
    : String(keywordsRaw ?? '')
        .split(/[,\s]+/)
        .map((k) => k.trim())
        .filter(Boolean);
  const maxPrice = Number(body.maxPrice);
  const minDesiredProfit = Number(body.minDesiredProfit ?? 15);
  const condition = (body.condition ?? '').trim() || undefined;
  const enabled = body.enabled !== false;

  if (!id || id.length > 120) {
    res.status(400).json({ error: 'Job ID is required and must be <= 120 characters' });
    return;
  }
  if (!['vinted', 'kleinanzeigen'].includes(platform)) {
    res.status(400).json({ error: 'platform must be vinted or kleinanzeigen' });
    return;
  }
  if (keywords.length === 0 || keywords.length > 10) {
    res.status(400).json({ error: 'Between 1 and 10 keywords are required' });
    return;
  }
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    res.status(400).json({ error: 'maxPrice must be a positive number' });
    return;
  }
  if (!Number.isFinite(minDesiredProfit)) {
    res.status(400).json({ error: 'minDesiredProfit must be a number' });
    return;
  }

  try {
    const { data, error } = await client
      .from('jobs')
      .upsert({
        id,
        platform,
        keywords,
        max_price: maxPrice,
        min_desired_profit: minDesiredProfit,
        condition,
        enabled,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    log('error', 'Failed to create job', { error: String(err) });
    res.status(500).json({ error: 'Failed to create job' });
  }
});

app.delete('/jobs/:id', async (req, res) => {
  const client = getGlobalClient();
  if (!client) {
    res.status(503).json({ error: 'Database not initialized' });
    return;
  }
  const { id } = req.params;
  try {
    const { error } = await client.from('jobs').delete().eq('id', id);
    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    log('error', 'Failed to delete job', { id, error: String(err) });
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

function mapDealToApi(deal: VerifiedDeal) {
  return {
    id: deal.id,
    platform: deal.platform,
    title: deal.title,
    price: deal.price,
    currency: deal.currency,
    estimated_resell_value: deal.estimatedResellValue,
    fees: deal.fees,
    shipping: deal.shipping,
    net_profit: deal.netProfit,
    roi_percent: deal.roiPercent,
    url: deal.url,
    image_url: deal.imageUrl,
    condition: deal.condition,
    seller: deal.seller,
    created_at: deal.createdAt,
    optimized_description: deal.optimizedDescription
      ? {
          title: deal.optimizedDescription.title,
          description: deal.optimizedDescription.description,
          hashtags: deal.optimizedDescription.hashtags,
          condition: deal.optimizedDescription.condition,
          tone: deal.optimizedDescription.tone,
          optimized_at: deal.optimizedDescription.optimizedAt,
        }
      : undefined,
  };
}

app.get('/deals', async (_req, res) => {
  const client = getGlobalClient();
  if (!client) {
    res.status(503).json({ error: 'Database not initialized' });
    return;
  }
  try {
    const deals = await getDeals(client, 100);
    res.json({ deals: deals.map(mapDealToApi), count: deals.length });
  } catch (err) {
    log('error', 'Failed to load deals', { error: String(err) });
    res.status(500).json({ error: 'Failed to load deals' });
  }
});

app.get('/stats', async (_req, res) => {
  try {
    res.json(getWorkerStats());
  } catch (err) {
    log('error', 'Failed to load stats', { error: String(err) });
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

app.get('/system/health', async (_req, res) => {
  const client = getGlobalClient();
  if (!client) {
    res.status(503).json({ error: 'Database not initialized' });
    return;
  }
  try {
    const health = await runHealthChecks(client);
    res.json(health);
  } catch (err) {
    log('error', 'Failed to run health checks', { error: String(err) });
    res.status(500).json({ error: 'Failed to run health checks' });
  }
});

app.post('/generate-image', async (req, res) => {
  const { prompt } = req.body as { prompt?: string };
  const result = await generateProductImage(prompt ?? '');
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({
    imageDataUrl: `data:${result.mimeType};base64,${result.imageBase64}`,
    mimeType: result.mimeType,
  });
});

app.post('/api/deals/:id/optimize-text', async (req, res) => {
  const client = getGlobalClient();
  if (!client) {
    res.status(503).json({ error: 'Database not initialized' });
    return;
  }

  const { id } = req.params;
  const { title, description } = req.body as { title?: string; description?: string };

  const exists = await dealExists(client, id);
  if (!exists) {
    res.status(404).json({ error: 'Deal not found' });
    return;
  }

  const inputTitle = title || id;
  const result = await generateSEOText(inputTitle, description ?? '');

  if (!result.success || !result.result) {
    res.status(400).json({ error: result.error || 'Text optimization failed' });
    return;
  }

  try {
    await saveOptimizedDescription(client, id, result.result);
    res.json(result.result);
  } catch (err) {
    log('error', 'Failed to save optimized description', { id, error: String(err) });
    res.status(500).json({ error: 'Failed to save optimized description' });
  }
});

async function main() {
  const client = initDatabase();
  log('info', 'Supabase client initialized');

  app.listen(port, '0.0.0.0', () => {
    log('info', `ResellEngine API listening on http://0.0.0.0:${port}`);
  });

  startRealtimeWorker(client);
  startScheduler(client, { intervalMs: 180_000 });
  initDiscordBot().catch((error) => {
    log('error', 'Discord bot initialization failed', { error: String(error) });
  });
}

main().catch((error) => {
  log('error', 'Fatal error in main', { error: String(error) });
  process.exit(1);
});
