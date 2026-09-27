/**
 * OCR service.
 * ─────────────
 * The only place in the codebase that knows HOW text gets extracted from a
 * package photo. Everything else (the packaging controller, the order
 * matcher) only calls `extractText(imagePath)` and gets a plain string
 * back — it never talks to a specific OCR provider directly.
 *
 * Two providers exist today:
 *   - ocr.openai.service.js   — OpenAI Vision. Default. Far better at
 *     handwriting than Tesseract, which is why this is the default for
 *     package labels (see that module's header).
 *   - ocr.tesseract.service.js — local/offline, no API key or cost, but
 *     weak on handwriting. Used automatically if OPENAI_API_KEY isn't set,
 *     or explicitly via OCR_PROVIDER=tesseract.
 *
 * Adding a third provider (Google Vision, Azure Vision, ...) means writing
 * a new module with the same `extractText(imagePath): Promise<String>`
 * signature and adding one line to PROVIDERS below — no controller changes.
 */
import * as openaiProvider from "./ocr.openai.service.js";
import * as tesseractProvider from "./ocr.tesseract.service.js";

const PROVIDERS = {
  openai: openaiProvider,
  tesseract: tesseractProvider,
};

function resolveProviderName() {
  const configured = (process.env.OCR_PROVIDER || "").toLowerCase();
  if (configured && PROVIDERS[configured]) return configured;
  // No explicit choice: use OpenAI whenever a key is available (better
  // handwriting recognition), otherwise fall back to the offline engine.
  return process.env.OPENAI_API_KEY ? "openai" : "tesseract";
}

/**
 * Runs OCR on an image file and returns the raw detected text, using
 * whichever provider is configured/available.
 * @param {String} imagePath - absolute path to the image on disk
 * @returns {Promise<String>}
 */
export async function extractText(imagePath) {
  const providerName = resolveProviderName();
  const provider = PROVIDERS[providerName];

  try {
    return await provider.extractText(imagePath);
  } catch (err) {
    // If the preferred provider is unusable (e.g. no API key, or a
    // transient API error) and it wasn't the offline fallback already,
    // don't fail the whole upload — degrade to Tesseract so packers can
    // still work, just with lower-quality text on hand-written labels.
    if (providerName !== "tesseract") {
      console.warn(`[ocr] ${providerName} provider failed (${err.message}), falling back to tesseract`);
      return tesseractProvider.extractText(imagePath);
    }
    throw err;
  }
}
