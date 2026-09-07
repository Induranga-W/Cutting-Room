import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null | undefined;

function getClient(): GoogleGenAI | null {
  if (client !== undefined) return client;
  const apiKey = process.env.GOOGLE_API_KEY;
  client = apiKey && apiKey !== "ADD_YOUR_API_KEY_HERE" ? new GoogleGenAI({ apiKey }) : null;
  return client;
}

export function hasGemini(): boolean {
  return getClient() !== null;
}

/** Calls Gemini and returns trimmed text, or null if unavailable / it fails. */
export async function generateText(
  model: string,
  contents: string | Array<Record<string, unknown>>
): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const response = await c.models.generateContent({ model, contents: contents as never });
    return (response.text ?? "").trim();
  } catch {
    return null;
  }
}

/** Transcribes an audio file (as base64) using Gemini's multimodal input. */
export async function transcribeAudio(
  base64Audio: string,
  mimeType: string
): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const prompt = `Transcribe the speech in this audio file. Return ONLY a valid SRT
(SubRip) subtitle file as plain text — no markdown fences, no commentary.
Break the transcript into short caption-friendly cues (roughly 3-8 words or
one clause each), each with an accurate start/end timestamp in
HH:MM:SS,mmm --> HH:MM:SS,mmm format, numbered sequentially starting at 1.
If there is no speech, return an empty string.`;
    const response = await c.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Audio } },
          ],
        },
      ] as never,
    });
    return (response.text ?? "").trim();
  } catch {
    return null;
  }
}
