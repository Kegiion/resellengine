import OpenAI from "openai";
import { log } from "../utils/logger.js";

export interface AuthenticityResult {
  isAuthentic: boolean;
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT =
  "Du bist ein Experte für Streetwear-Reselling und Fake-Erkennung. Analysiere das Bild des Artikels und die Beschreibung. Überprüfe: Sieht das Produkt original aus? Stimmen die Nähte/Tags grob überein? Antworte NUR in einem standardisierten JSON-Format: { isAuthentic: true/false, confidence: 0-100, reason: 'Deine Begründung auf Deutsch' }";

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
