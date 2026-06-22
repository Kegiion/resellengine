import axios from 'axios';
import { log } from '../utils/logger.js';

export interface AuthenticityResult {
  isAuthentic: boolean;
  confidence: number;
  reason: string;
}

interface BluesMindsResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const SYSTEM_PROMPT =
  'Du bist ein Experte für Streetwear-Reselling und Fake-Erkennung. Analysiere das Bild des Artikels und die Beschreibung. Überprüfe: Sieht das Produkt original aus? Stimmen die Nähte/Tags grob überein? Antworte NUR in einem standardisierten JSON-Format: { isAuthentic: true/false, confidence: 0-100, reason: \'Deine Begründung auf Deutsch\' }';

export async function analyzeImageAuthenticity(
  imageUrl: string,
  description?: string
): Promise<{ success: boolean; result?: AuthenticityResult; error?: string }> {
  const apiKey = process.env.BLUESMINDS_API_KEY;
  const baseUrl = process.env.BLUESMINDS_BASE_URL || 'https://api.bluesminds.com/v1';

  if (!apiKey) {
    return { success: false, error: 'BLUESMINDS_API_KEY not configured' };
  }

  try {
    const content = description
      ? `Beschreibung: ${description}\n\nAnalysiere das Bild und bewerte Authentizität.`
      : 'Analysiere das Bild und bewerte Authentizität.';

    const response = await axios.post<BluesMindsResponse>(
      `${baseUrl}/chat/completions`,
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: content },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      }
    );

    const rawContent = response.data?.choices?.[0]?.message?.content?.trim() ?? '';
    if (!rawContent) {
      return { success: false, error: 'Empty response from BluesMinds' };
    }

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: 'No JSON object found in BluesMinds response' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<AuthenticityResult>;
    const result: AuthenticityResult = {
      isAuthentic: Boolean(parsed.isAuthentic),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || 'Keine Begründung geliefert.'),
    };

    log('info', 'BluesMinds image authenticity analysis', {
      imageUrl,
      isAuthentic: result.isAuthentic,
      confidence: result.confidence,
    });

    return { success: true, result };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? `${error.message} (${error.response?.status ?? 'no status'})`
      : String(error);
    log('warn', 'BluesMinds image authenticity analysis failed', { imageUrl, error: message });
    return { success: false, error: message };
  }
}
