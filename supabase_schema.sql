-- ResellEngine Supabase Schema (PostgreSQL)
-- Run this in the Supabase SQL Editor to initialize tables, indexes and RLS.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Search jobs / configuration
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('vinted', 'kleinanzeigen')),
  keywords TEXT[] NOT NULL,
  max_price NUMERIC NOT NULL,
  min_desired_profit NUMERIC NOT NULL,
  condition TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Application configuration (single-row table)
CREATE TABLE IF NOT EXISTS app_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  min_delay_ms INTEGER NOT NULL DEFAULT 2000,
  max_delay_ms INTEGER NOT NULL DEFAULT 5000,
  rotate_user_agents BOOLEAN NOT NULL DEFAULT true,
  scheduler_interval_ms INTEGER NOT NULL DEFAULT 180000,
  shipping_estimate NUMERIC NOT NULL DEFAULT 5.0,
  vinted_seller_fee_percent NUMERIC NOT NULL DEFAULT 0,
  vinted_buyer_protection_percent NUMERIC NOT NULL DEFAULT 0.05,
  discord_webhook_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deals
CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('vinted', 'kleinanzeigen')),
  title TEXT NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  estimated_resell_value NUMERIC NOT NULL,
  fees NUMERIC NOT NULL,
  shipping NUMERIC NOT NULL,
  net_profit NUMERIC NOT NULL,
  roi_percent NUMERIC NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT,
  condition TEXT,
  seller TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  optimized_title TEXT,
  optimized_description TEXT,
  optimized_hashtags TEXT[],
  optimized_condition TEXT,
  optimized_tone TEXT,
  optimized_at TIMESTAMPTZ
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_deals_created_at ON deals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_platform ON deals(platform);
CREATE INDEX IF NOT EXISTS idx_deals_enabled ON jobs(enabled);

-- Insert default app config if not present
INSERT INTO app_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Row Level Security (RLS) - enable, but allow all for service-key usage
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_jobs' AND tablename = 'jobs'
  ) THEN
    CREATE POLICY allow_all_jobs ON jobs FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_app_config' AND tablename = 'app_config'
  ) THEN
    CREATE POLICY allow_all_app_config ON app_config FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_deals' AND tablename = 'deals'
  ) THEN
    CREATE POLICY allow_all_deals ON deals FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;

-- Trigger function to update updated_at automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_config_updated_at ON app_config;
CREATE TRIGGER update_app_config_updated_at
  BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_deals_updated_at ON deals;
CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
