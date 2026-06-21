import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
import { startScheduler } from './services/scheduler.js';

const geminiApiKey = process.env.GEMINI_API_KEY || loadGeminiApiKeyFromConfig();
if (geminiApiKey && !process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = geminiApiKey;
}

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(cors());
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

app.get('/deals', async (_req, res) => {
  const client = getGlobalClient();
  if (!client) {
    res.status(503).json({ error: 'Database not initialized' });
    return;
  }
  try {
    const deals = await getDeals(client, 100);
    res.json({ deals, count: deals.length });
  } catch (err) {
    log('error', 'Failed to load deals', { error: String(err) });
    res.status(500).json({ error: 'Failed to load deals' });
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

  startScheduler(client, { intervalMs: 180_000 });
}

main().catch((error) => {
  log('error', 'Fatal error in main', { error: String(error) });
  process.exit(1);
});
