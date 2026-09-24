// Gemini API calls shared by the AI features (table fix, document restructure).

// "-latest" alias is updated by Google on each Flash release, so the app doesn't break
// when a pinned model version is shut down (as happened with gemini-2.0-flash).
// Flash-Lite is the fallback when Flash is overloaded: separate capacity and quota.
export const GEMINI_MODELS = ["gemini-flash-latest", "gemini-3.5-flash-lite"];
// Wait before each retry on the same model (overload spikes are usually short)
const GEMINI_RETRY_DELAYS_MS = [2000, 5000];
const KEY_STORAGE = "gemini_api_key";

export class GeminiKeyError extends Error {}
export class GeminiBusyError extends Error {}      // 429/500/503/504: retry, then try the next model
class GeminiModelError extends Error {}            // 404: model gone, skip to the next model
export class GeminiTruncatedError extends Error {} // answer hit the output token limit

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GeminiOptions {
  temperature?: number;
  onRetry?: (attempt: number) => void;
}

// Returns the stored key, or asks for one. null when the user cancels.
export function getGeminiKey(): string | null {
  const stored = localStorage.getItem(KEY_STORAGE);
  if (stored) return stored;
  const entered = prompt(
    "Masukkan Gemini API Key Anda:\n(Dapatkan gratis di https://aistudio.google.com/apikey)\n\nKey ini disimpan hanya di browser Anda, tidak dikirim ke server manapun selain Google."
  )?.trim();
  if (!entered) return null;
  localStorage.setItem(KEY_STORAGE, entered);
  return entered;
}

// User-facing (Indonesian) message for a failed call; forgets an invalid key.
export function describeGeminiError(err: unknown, unchanged: string): string {
  if (err instanceof GeminiKeyError) {
    localStorage.removeItem(KEY_STORAGE);
    return `API Key tidak valid atau sudah dicabut (${err.message}).\nKey telah dihapus — klik tombol lagi untuk memasukkan key baru.`;
  }
  if (err instanceof GeminiBusyError) {
    return `Server Gemini sedang sibuk atau kuota habis, dan sudah dicoba beberapa kali (termasuk model cadangan).\n${unchanged} — silakan coba lagi beberapa menit lagi.\n\nDetail: ${err.message}`;
  }
  return `Gagal: ${err instanceof Error ? err.message : String(err)}\n${unchanged}.`;
}

// When the primary model is overloaded, skip it for a while: a multi-part request would
// otherwise spend its retries on it again for every part (measured: 7.6 min for 10 parts).
const SKIP_BUSY_MODEL_MS = 5 * 60 * 1000;
const busyUntil = new Map<string, number>();

export async function callGemini(apiKey: string, prompt: string, options: GeminiOptions = {}): Promise<string> {
  let lastError: Error = new Error("Gemini tidak merespons.");
  let attempt = 0;
  const now = Date.now();
  const available = GEMINI_MODELS.filter((m) => (busyUntil.get(m) ?? 0) <= now);
  for (const model of available.length ? available : GEMINI_MODELS) {
    for (let i = 0; i <= GEMINI_RETRY_DELAYS_MS.length; i++) {
      if (attempt > 0) options.onRetry?.(attempt);
      attempt++;
      try {
        return await requestGemini(model, apiKey, prompt, options.temperature ?? 0.2);
      } catch (err) {
        if (!(err instanceof GeminiBusyError || err instanceof GeminiModelError)) throw err;
        // Keep the overload error for the user; a 404 on the fallback would only confuse
        if (err instanceof GeminiBusyError || !(lastError instanceof GeminiBusyError)) lastError = err;
        if (err instanceof GeminiModelError || i === GEMINI_RETRY_DELAYS_MS.length) {
          if (err instanceof GeminiBusyError && model !== GEMINI_MODELS[GEMINI_MODELS.length - 1]) {
            busyUntil.set(model, Date.now() + SKIP_BUSY_MODEL_MS);
          }
          break;
        }
        await sleep(GEMINI_RETRY_DELAYS_MS[i]);
      }
    }
  }
  throw lastError;
}

async function requestGemini(model: string, apiKey: string, prompt: string, temperature: number): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      // Key goes in a header, not the URL, so it doesn't end up in logs or history
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature },
      }),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    const message: string = err?.error?.message || `HTTP ${response.status}`;
    // An invalid key comes back as 400 with reason API_KEY_INVALID in details (not in the message);
    // revoked/leaked/restricted keys come back as 401/403.
    const invalidKey =
      response.status === 401 || response.status === 403 ||
      (err?.error?.details ?? []).some((d: { reason?: string }) => d?.reason === "API_KEY_INVALID");
    if (invalidKey) throw new GeminiKeyError(message);
    if ([429, 500, 503, 504].includes(response.status)) throw new GeminiBusyError(message);
    if (response.status === 404) throw new GeminiModelError(message);
    throw new Error(message);
  }
  const data = await response.json();
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    const reason = data?.promptFeedback?.blockReason;
    throw new Error(reason ? `Permintaan diblokir oleh Gemini (${reason}).` : "Gemini tidak mengembalikan jawaban.");
  }
  if (candidate.finishReason === "MAX_TOKENS") {
    throw new GeminiTruncatedError("Jawaban AI terpotong karena terlalu panjang.");
  }
  // Long answers can arrive split over several parts
  const text: string = (candidate.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  return text.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/g, "").trim();
}
