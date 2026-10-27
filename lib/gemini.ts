import { GoogleGenAI } from "@google/genai";

/** Model used for every Gemini call. Override with GEMINI_MODEL in .env.local. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

let client: GoogleGenAI | null | undefined;
let lastError: string | null = null;

/** Reason the most recent Gemini call failed (null if it didn't). */
export function getLastGeminiError(): string | null {
  return lastError;
}

function recordError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  lastError = msg.replace(/\s+/g, " ").slice(0, 300);
  console.error("[gemini] call failed:", lastError);
}

const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
const RETRY_DELAYS_MS = [2000, 5000, 12000];

/** Overload / rate-limit style errors that are worth retrying. */
function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(503|500|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(msg);
}

/** Runs a Gemini call, retrying with backoff on temporary overload, then
 * trying the fallback model once before giving up. */
async function withRetry(model: string, run: (m: string) => Promise<string>): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await run(model);
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === RETRY_DELAYS_MS.length) break;
      console.warn(`[gemini] ${model} busy, retrying in ${RETRY_DELAYS_MS[attempt] / 1000}s...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  if (isTransient(lastErr) && FALLBACK_MODEL && FALLBACK_MODEL !== model) {
    console.warn(`[gemini] ${model} still busy, trying ${FALLBACK_MODEL}`);
    return await run(FALLBACK_MODEL);
  }
  throw lastErr;
}

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
  lastError = null;
  try {
    return await withRetry(model, async (m) => {
      const response = await c.models.generateContent({ model: m, contents: contents as never });
      return (response.text ?? "").trim();
    });
  } catch (err) {
    recordError(err);
    return null;
  }
}

export interface UploadedVideo {
  name: string;
  uri: string;
  mimeType: string;
}

/** Uploads a video to Gemini's Files API and waits until it is ready, so the
 * model can watch it (frames and audio), not just read a transcript. */
export async function uploadVideo(filePath: string): Promise<UploadedVideo | null> {
  const c = getClient();
  if (!c) return null;
  lastError = null;
  try {
    let file = await c.files.upload({ file: filePath, config: { mimeType: "video/mp4" } });
    const deadline = Date.now() + 10 * 60 * 1000;
    while (String(file.state) === "PROCESSING" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      file = await c.files.get({ name: file.name as string });
    }
    if (String(file.state) !== "ACTIVE") {
      throw new Error(`video upload ended in state ${String(file.state)}`);
    }
    return {
      name: file.name as string,
      uri: file.uri as string,
      mimeType: file.mimeType ?? "video/mp4",
    };
  } catch (err) {
    recordError(err);
    return null;
  }
}

/** Removes an uploaded video from Gemini's storage (best effort). */
export async function deleteUploadedVideo(name: string): Promise<void> {
  try {
    await getClient()?.files.delete({ name });
  } catch {
    // files expire on their own after 48 hours
  }
}

/** Asks Gemini a question about an uploaded video. */
export async function generateWithVideo(
  video: UploadedVideo,
  prompt: string
): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  lastError = null;
  try {
    return await withRetry(GEMINI_MODEL, async (m) => {
      const response = await c.models.generateContent({
        model: m,
        contents: [
          {
            role: "user",
            parts: [
              { fileData: { fileUri: video.uri, mimeType: video.mimeType } },
              { text: prompt },
            ],
          },
        ] as never,
      });
      return (response.text ?? "").trim();
    });
  } catch (err) {
    recordError(err);
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
  lastError = null;
  try {
    const prompt = `Transcribe the speech in this audio file. Return ONLY a valid SRT
(SubRip) subtitle file as plain text — no markdown fences, no commentary.
Break the transcript into short caption-friendly cues (roughly 3-8 words or
one clause each), each with an accurate start/end timestamp in
HH:MM:SS,mmm --> HH:MM:SS,mmm format, numbered sequentially starting at 1.
If there is no speech, return an empty string.`;
    return await withRetry(GEMINI_MODEL, async (m) => {
      const response = await c.models.generateContent({
        model: m,
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
    });
  } catch (err) {
    recordError(err);
    return null;
  }
}
