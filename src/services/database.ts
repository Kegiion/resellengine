import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedDeal, AppConfig, SearchJob, OptimizedDescription } from '../types/index.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

let globalClient: SupabaseClient | null = null;

export function createSupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getGlobalClient(): SupabaseClient | null {
  return globalClient;
}

export function initDatabase(): SupabaseClient {
  const client = createSupabaseClient();
  globalClient = client;
  return client;
}

export async function getJobs(client: SupabaseClient): Promise<SearchJob[]> {
  const { data, error } = await client.from('jobs').select('*').eq('enabled', true).order('id');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    keywords: row.keywords ?? [],
    maxPrice: Number(row.max_price),
    minDesiredProfit: Number(row.min_desired_profit),
    condition: row.condition ?? undefined,
    enabled: row.enabled,
  }));
}

export async function getAppConfig(client: SupabaseClient): Promise<AppConfig> {
  const { data, error } = await client.from('app_config').select('*').eq('id', 1).single();
  if (error) throw error;
  if (!data) throw new Error('App config not found in Supabase');

  return {
    jobs: [],
    apiKeys: {
      removeBg: process.env.REMOVE_BG_API_KEY ?? '',
      anthropic: process.env.ANTHROPIC_API_KEY ?? '',
      openai: process.env.OPENAI_API_KEY ?? '',
      gemini: process.env.GEMINI_API_KEY ?? '',
    },
    notifications: {
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
    },
    antiBot: {
      minDelayMs: Number(data.min_delay_ms) || 2000,
      maxDelayMs: Number(data.max_delay_ms) || 5000,
      rotateUserAgents: data.rotate_user_agents ?? true,
    },
    fees: {
      vintedSellerFeePercent: Number(data.vinted_seller_fee_percent) || 0,
      vintedBuyerProtectionPercent: Number(data.vinted_buyer_protection_percent) || 0.05,
      shippingEstimate: Number(data.shipping_estimate) || 5.0,
    },
  };
}

export async function getFullConfig(client: SupabaseClient): Promise<AppConfig> {
  const [config, jobs] = await Promise.all([getAppConfig(client), getJobs(client)]);
  return { ...config, jobs };
}

export async function insertDeal(client: SupabaseClient, deal: VerifiedDeal): Promise<void> {
  const { error } = await client.from('deals').upsert(
    {
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
      image_url: deal.imageUrl ?? null,
      condition: deal.condition ?? null,
      seller: deal.seller ?? null,
      created_at: deal.createdAt,
    },
    { onConflict: 'id' }
  );
  if (error) throw error;
}

export async function getDeals(client: SupabaseClient, limit = 50): Promise<VerifiedDeal[]> {
  const { data, error } = await client
    .from('deals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    title: row.title,
    price: Number(row.price),
    currency: row.currency,
    estimatedResellValue: Number(row.estimated_resell_value),
    fees: Number(row.fees),
    shipping: Number(row.shipping),
    netProfit: Number(row.net_profit),
    roiPercent: Number(row.roi_percent),
    url: row.url,
    imageUrl: row.image_url ?? undefined,
    condition: row.condition ?? undefined,
    seller: row.seller ?? undefined,
    createdAt: row.created_at,
    optimizedDescription: row.optimized_title
      ? {
          title: row.optimized_title,
          description: row.optimized_description ?? '',
          hashtags: row.optimized_hashtags ?? [],
          condition: row.optimized_condition ?? '',
          tone: row.optimized_tone ?? '',
          optimizedAt: row.optimized_at ?? undefined,
        }
      : undefined,
  }));
}

export async function dealExists(client: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client.from('deals').select('id').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return !!data;
}

export async function saveOptimizedDescription(
  client: SupabaseClient,
  id: string,
  optimized: OptimizedDescription
): Promise<boolean> {
  const { error } = await client
    .from('deals')
    .update({
      optimized_title: optimized.title,
      optimized_description: optimized.description,
      optimized_hashtags: optimized.hashtags,
      optimized_condition: optimized.condition,
      optimized_tone: optimized.tone,
      optimized_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw error;
  return true;
}

export async function getDealById(client: SupabaseClient, id: string): Promise<VerifiedDeal | null> {
  const { data, error } = await client.from('deals').select('*').eq('id', id).single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  if (!data) return null;
  return {
    id: data.id,
    platform: data.platform,
    title: data.title,
    price: Number(data.price),
    currency: data.currency,
    estimatedResellValue: Number(data.estimated_resell_value),
    fees: Number(data.fees),
    shipping: Number(data.shipping),
    netProfit: Number(data.net_profit),
    roiPercent: Number(data.roi_percent),
    url: data.url,
    imageUrl: data.image_url ?? undefined,
    condition: data.condition ?? undefined,
    seller: data.seller ?? undefined,
    createdAt: data.created_at,
    optimizedDescription: data.optimized_title
      ? {
          title: data.optimized_title,
          description: data.optimized_description ?? '',
          hashtags: data.optimized_hashtags ?? [],
          condition: data.optimized_condition ?? '',
          tone: data.optimized_tone ?? '',
          optimizedAt: data.optimized_at ?? undefined,
        }
      : undefined,
  };
}
