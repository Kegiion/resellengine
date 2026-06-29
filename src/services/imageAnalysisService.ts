import OpenAI from "openai";
import { log } from "../utils/logger.js";

export interface AuthenticityResult {
  isAuthentic: boolean;
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT =
  `Du bist ein Experte für Secondhand-Mode. Analysiere das Bild des Artikels. Die meisten Vinted-/Kleinanzeigen-Fotos sind authentische gebrauchte Kleidung, oft mit schlechter Beleuchtung. Markiere ein Produkt als NICHT authentisch (isAuthentic: false) in diesen Fällen:
- Klare Anzeichen einer Fälschung (z. B. falscher Schriftzug, offensichtlich falsche Tags, sehr schlechte Verarbeitung, die nicht zum Preis passt).
- Das Bild ist so dunkel, unscharf oder entfernt aufgenommen, dass KEIN relevantes Detail (Logo, Etikett, Nähte, Material, Seriennummer) erkennbar ist. Dann kann die Authentizität nicht geprüft werden.

Bei normaler, aber schlechter Beleuchtung, wo Form, Logo oder Material trotzdem erkennbar sind, gilt: isAuthentic: true, confidence niedrig bis mittel. Wenn die Bildqualität die Prüfung verhindert, gilt: isAuthentic: false, reason muss das Problem nennen (z. B. "zu dunkel", "unscharf", "kein Detail erkennbar").

Antworte NUR in diesem JSON-Format: { isAuthentic: true/false, confidence: 0-100, reason: 'Deine Begründung auf Deutsch' }`;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeImageAuthenticity(
  imageUrl: string,
  description?: string
): Promise<{ success: boolean; result?: AuthenticityResult; error?: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { success: false, error: "OPENAI_API_KEY not configured" };
  }

  try {
    const textContent = description
      ? `Beschreibung: ${description}\n\nAnalysiere das Bild und bewerte Authentizität.`
      : "Analysiere das Bild und bewerte Authentizität.";

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: textContent },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 500,
    });

    const rawContent = response.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawContent) {
      return { success: false, error: "Empty response from OpenAI" };
    }

    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "No JSON object found in OpenAI response" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<AuthenticityResult>;
    const result: AuthenticityResult = {
      isAuthentic: Boolean(parsed.isAuthentic),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || "Keine Begründung geliefert."),
    };

    log("info", "OpenAI gpt-4o image authenticity analysis", {
      imageUrl,
      isAuthentic: result.isAuthentic,
      confidence: result.confidence,
    });

    return { success: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("warn", "OpenAI gpt-4o image authenticity analysis failed", { imageUrl, error: message });
    return { success: false, error: message };
  }
}

export interface MultiImageAuthenticityResult {
  isAuthentic: boolean;
  lowestConfidence: number;
  reasons: string[];
}

export async function analyzeMultipleImagesAuthenticity(
  imageUrls: string[],
  description?: string,
  maxImages = 5
): Promise<{ success: boolean; result?: MultiImageAuthenticityResult; error?: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { success: false, error: "OPENAI_API_KEY not configured" };
  }

  const urls = imageUrls.slice(0, maxImages).filter((url) => url.startsWith("http"));
  if (urls.length === 0) {
    return { success: false, error: "No valid image URLs provided" };
  }

  const results: AuthenticityResult[] = [];
  for (const imageUrl of urls) {
    const analysis = await analyzeImageAuthenticity(imageUrl, description);
    if (analysis.success && analysis.result) {
      results.push(analysis.result);
    } else {
      log("warn", "OpenAI gpt-4o authenticity analysis failed for one image", {
        imageUrl,
        error: analysis.error,
      });
    }
  }

  if (results.length === 0) {
    return { success: false, error: "All image authenticity analyses failed" };
  }

  const badQualityReasons = ['zu dunkel', 'unscharf', 'kein detail', 'keine details', 'nicht erkennbar', 'unerkennbar', 'zu weit entfernt', 'zu klein', 'schlechte qualität', 'nicht bewertbar', 'kein logo', 'kein etikett', 'authentizität bestätigen'];
  const isQualityFailure = (reason: string) =>
    badQualityReasons.some((indicator) => reason.toLowerCase().includes(indicator));

  const fakeOrDamaged = results.filter((r) => !r.isAuthentic && !isQualityFailure(r.reason));
  const qualityFailures = results.filter((r) => !r.isAuthentic && isQualityFailure(r.reason));
  const clearAuthentic = results.filter((r) => r.isAuthentic && r.confidence >= 70);
  const lowConfidence = results.filter((r) => r.isAuthentic && r.confidence < 70);

  const isAuthentic =
    fakeOrDamaged.length === 0 &&
    (clearAuthentic.length > 0 || (qualityFailures.length < results.length && lowConfidence.length < results.length));
  const lowestConfidence = Math.min(...results.map((r) => r.confidence));
  const reasons = isAuthentic ? [] : fakeOrDamaged.map((r) => r.reason);

  log("info", "OpenAI gpt-4o multi-image authenticity analysis", {
    imageCount: urls.length,
    analyzedCount: results.length,
    isAuthentic,
    lowestConfidence,
    clearAuthentic: clearAuthentic.length,
    qualityFailures: qualityFailures.length,
    fakeOrDamaged: fakeOrDamaged.length,
    lowConfidence: lowConfidence.length,
  });

  return {
    success: true,
    result: {
      isAuthentic,
      lowestConfidence,
      reasons,
    },
  };
}
