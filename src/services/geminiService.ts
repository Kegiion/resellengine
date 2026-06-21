import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import type { SEOTextResult } from '../types/index.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';

export interface GenerateImageResult {
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
}

export interface GenerateSEOTextResult {
  success: boolean;
  result?: SEOTextResult;
  error?: string;
}

export async function generateProductImage(
  prompt: string,
  model = 'gemini-2.0-flash-exp-image-generation'
): Promise<GenerateImageResult> {
  if (!GEMINI_API_KEY) {
    return { success: false, error: 'GEMINI_API_KEY is not configured' };
  }

  if (!prompt || prompt.trim().length === 0) {
    return { success: false, error: 'Prompt is required' };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseModalities: ['image'],
      },
    });

    const candidates = response.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data && part.inlineData.mimeType) {
          return {
            success: true,
            imageBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          };
        }
      }
    }

    return { success: false, error: 'No image returned by Gemini' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function generateSEOText(
  title: string,
  originalDescription = '',
  model = 'gemini-2.5-flash'
): Promise<GenerateSEOTextResult> {
  if (!GEMINI_API_KEY) {
    return { success: false, error: 'GEMINI_API_KEY is not configured' };
  }

  if (!title || title.trim().length === 0) {
    return { success: false, error: 'Title is required' };
  }

  const systemPrompt = `Du bist ein E-Commerce-Redakteur für einen Reselling-Shop. Verfasse aus den spartanischen Verkäuferdaten einen professionellen, verkaufsstarken Listing-Text für den deutschen Markt.

Gib ein JSON-Objekt im folgenden Format zurück:
{
  "title": "maximal 80 Zeichen, optimiert für Vinted/Kleinanzeigen",
  "description": "2-3 kurze Absätze, freundlich, konkret, ohne Floskeln",
  "hashtags": ["5-8 relevante Hashtags ohne #"],
  "condition": "new | very_good | good | fair | poor",
  "tone": "kurze Beschreibung des Stils, z.B. casual, sportlich, elegant"
}

Regeln:
- Bleibe wahrheitsgetreu zu den Originaldaten.
- Erfinde keine Marken oder Materialien, wenn sie nicht genannt sind.
- Zustand ist Pflicht; wenn unklar, wähle den vorsichtigeren Wert.
- Keine Markdown-Formatierung außerhalb des JSON.`;

  const userPrompt = `Originaltitel: ${title}\nOriginalbeschreibung: ${originalDescription || 'nicht vorhanden'}`;

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    const text = response.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { success: false, error: 'LLM response did not contain valid JSON' };
    }

    const parsed = JSON.parse(match[0]) as SEOTextResult;
    return { success: true, result: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export function loadGeminiApiKeyFromConfig(configPath = './config.json'): string {
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.apiKeys?.gemini ?? '';
  } catch {
    return '';
  }
}
