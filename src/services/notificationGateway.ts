import axios from 'axios';
import { log } from '../utils/logger.js';
import type { VerifiedDeal } from '../types/index.js';

export async function sendDealNotification(deal: VerifiedDeal): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || '';
  if (!webhookUrl) {
    log('info', 'No Discord webhook configured; skipping notification.', { dealId: deal.id });
    return;
  }

  const embed = {
    title: deal.title,
    url: deal.url,
    color: 0x00ff00,
    fields: [
      { name: 'Plattform', value: deal.platform, inline: true },
      { name: 'Einkaufspreis', value: `${deal.price.toFixed(2)} ${deal.currency}`, inline: true },
      { name: 'Geschätzter Resell-Wert', value: `${deal.estimatedResellValue.toFixed(2)} ${deal.currency}`, inline: true },
      { name: 'Netto-Profit', value: `${deal.netProfit.toFixed(2)} ${deal.currency}`, inline: true },
      { name: 'ROI', value: `${deal.roiPercent.toFixed(1)}%`, inline: true },
      { name: 'Zustand', value: deal.condition || 'unbekannt', inline: true },
    ],
    image: deal.imageUrl ? { url: deal.imageUrl } : undefined,
    footer: { text: 'ResellEngine • Phase 1' },
    timestamp: deal.createdAt,
  };

  try {
    await axios.post(webhookUrl, { embeds: [embed] });
    log('info', 'Discord notification sent', { dealId: deal.id });
  } catch (error) {
    log('error', 'Failed to send Discord notification', { dealId: deal.id, error: String(error) });
  }
}
