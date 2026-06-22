export type Platform = 'vinted' | 'kleinanzeigen';
export type Condition = 'new' | 'very_good' | 'good' | 'fair' | 'poor';

export interface SearchJob {
  id: string;
  platform: Platform;
  keywords: string[];
  maxPrice: number;
  minDesiredProfit: number;
  condition?: Condition;
  enabled: boolean;
}

export interface AntiBotConfig {
  minDelayMs: number;
  maxDelayMs: number;
  rotateUserAgents: boolean;
}

export interface FeeConfig {
  vintedSellerFeePercent: number;
  vintedBuyerProtectionPercent: number;
  shippingEstimate: number;
}

export interface AppConfig {
  jobs: SearchJob[];
  apiKeys: {
    removeBg: string;
    anthropic: string;
    openai: string;
    gemini: string;
  };
  notifications: {
    discordWebhookUrl: string;
  };
  antiBot: AntiBotConfig;
  fees: FeeConfig;
}

export interface SEOTextResult {
  title: string;
  description: string;
  hashtags: string[];
  condition: string;
  tone: string;
}

export interface OptimizedDescription {
  title: string;
  description: string;
  hashtags: string[];
  condition: string;
  tone: string;
}

export interface ScrapedItem {
  id: string;
  platform: Platform;
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl?: string;
  condition?: string;
  seller?: string;
  location?: string;
  brand?: string;
  size?: string;
  scrapedAt: string;
  listedAt?: string;
}

export interface VerifiedDeal {
  id: string;
  platform: Platform;
  title: string;
  price: number;
  currency: string;
  estimatedResellValue: number;
  fees: number;
  shipping: number;
  netProfit: number;
  roiPercent: number;
  url: string;
  imageUrl?: string;
  condition?: string;
  seller?: string;
  createdAt: string;
  optimizedDescription?: OptimizedDescription & { optimizedAt?: string };
}
