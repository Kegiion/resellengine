import axios from 'axios';
import { log } from '../utils/logger.js';
import type { ScrapedItem } from '../types/index.js';

interface LlmEstimate {
  estimatedResellValue: number;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
}

export async function estimateWithAnthropic(item: ScrapedItem): Promise<LlmEstimate | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.anthropic;
  if (!apiKey) return null;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 256,
        temperature: 0.2,
        system:
          'You are a reselling price expert for the German market. Given a used item title, price, platform and condition, estimate the realistic resale value in EUR. Respond ONLY with a JSON object containing: estimatedResellValue (number), confidence ("low", "medium", "high"), reasoning (one sentence). Do not include markdown.',
        messages: [
          {
            role: 'user',
            content: `Title: "${item.title}"; Platform: ${item.platform}; Listed price: ${item.price} EUR; Condition: ${item.condition ?? 'unknown'}; Brand: ${item.brand ?? 'unknown'}.`,
          },
        ],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const text = response.data?.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text) as LlmEstimate;
    if (typeof parsed.estimatedResellValue === 'number') {
      log('info', 'Anthropic LLM estimate received', { itemId: item.id, value: parsed.estimatedResellValue });
      return parsed;
    }
    return null;
  } catch (error) {
    log('warn', 'Anthropic LLM estimate failed', { itemId: item.id, error: String(error) });
    return null;
  }
}

export async function estimateWithOpenAI(item: ScrapedItem): Promise<LlmEstimate | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.openai;
  if (!apiKey) return null;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        max_tokens: 256,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a reselling price expert for the German market. Given a used item title, price, platform and condition, estimate the realistic resale value in EUR. Respond ONLY with a JSON object containing: estimatedResellValue (number), confidence ("low", "medium", "high"), reasoning (one sentence). Do not include markdown.',
          },
          {
            role: 'user',
            content: `Title: "${item.title}"; Platform: ${item.platform}; Listed price: ${item.price} EUR; Condition: ${item.condition ?? 'unknown'}; Brand: ${item.brand ?? 'unknown'}.`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const text = response.data?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text) as LlmEstimate;
    if (typeof parsed.estimatedResellValue === 'number') {
      log('info', 'OpenAI LLM estimate received', { itemId: item.id, value: parsed.estimatedResellValue });
      return parsed;
    }
    return null;
  } catch (error) {
    log('warn', 'OpenAI LLM estimate failed', { itemId: item.id, error: String(error) });
    return null;
  }
}

export async function estimateWithLlm(item: ScrapedItem): Promise<LlmEstimate | null> {
  return (await estimateWithAnthropic(item)) ?? (await estimateWithOpenAI(item));
}
