import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'node:fs';
import axios from 'axios';
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

export interface ImageDamageAnalysis {
  isDamaged: boolean;
  flaws: string[];
  confidence: number;
}

export interface AnalyzeProductImageResult {
  success: boolean;
  result?: ImageDamageAnalysis;
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

export async function analyzeProductImage(
  imageUrl: string,
  model = 'gemini-2.5-flash'
): Promise<AnalyzeProductImageResult> {
  if (!GEMINI_API_KEY) {
    return { success: false, error: 'GEMINI_API_KEY is not configured' };
  }
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return { success: false, error: 'Valid imageUrl is required' };
  }

  const systemPrompt = `Du bist ein Experte für Second-Hand-Qualitätskontrolle. Analysiere das gegebene Produktbild eines gebrauchten Kleidungsstücks intensiv auf sichtbare Mängel.

Suche explizit nach:
- Löchern oder Rissen im Stoff
- Flecken, Schmutz, Verfärbungen, ausgeblichene Stellen
- Abgenutzte, ausgefranste Kanten, Nähte oder Pilling
- Kaputte oder fehlende Reißverschlüsse, Knöpfe, Kordeln, Patches
- Stark verbogene oder abgenutzte Formen, z. B. an Sneakern
- Jegliche anderen offensichtlichen optischen Schäden

Bewerte nur das, was DU mit Sicherheit auf dem Bild erkennen kannst. Vermeide Spekulation. Ein Artikel ohne erkennbare Mängel ist NICHT beschädigt.

Gib ausschließlich ein JSON-Objekt im folgenden Format zurück. Keine Erklärungen, keine Markdown-Code-Blöcke, keine zusätzliche Formatierung:

{
  "isDamaged": true | false,
  "flaws": ["kurze Beschreibung 1", "kurze Beschreibung 2"],
  "confidence": 0.0 bis 1.0
}

- isDamaged: true, wenn mindestens ein sichtbarer Mangel erkennbar ist, der den Wert oder die Verkaufbarkeit merklich mindert.
- flaws: Liste der erkannten Mängel auf Deutsch. Leer, wenn isDamaged false.
- confidence: Wahrscheinlichkeit der Einschätzung (0.0 = sehr unsicher, 1.0 = absolut sicher).`;

  try {
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: { Accept: 'image/*' },
    });
    const contentType = imageResponse.headers['content-type'];
    const mimeType = typeof contentType === 'string' && contentType.startsWith('image/') ? contentType : 'image/jpeg';
    const base64 = Buffer.from(imageResponse.data, 'binary').toString('base64');

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model,
      contents: {
        role: 'user',
        parts: [
          { text: systemPrompt },
          {
            inlineData: {
              data: base64,
              mimeType,
            },
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
      },
    });

    const text = response.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { success: false, error: 'LLM response did not contain valid JSON' };
    }

    const parsed = JSON.parse(match[0]) as ImageDamageAnalysis;
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
