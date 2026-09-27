/**
 * OCR provider: Tesseract.js (local, offline, printed-text OCR).
 * ──────────────────────────────────────────────────────────────
 * Selected by ocr.service.js when OCR_PROVIDER=tesseract, or as the
 * automatic fallback if no OpenAI key is configured. Tesseract runs fully
 * offline with no API cost, but its handwriting recognition is weak — it's
 * tuned for printed/typed text. Prefer ocr.openai.service.js for
 * hand-written package labels; keep this one as the no-API-key fallback.
 */
import { createWorker } from "tesseract.js";

/**
 * Runs OCR on an image file and returns the raw detected text.
 * @param {String} imagePath - absolute path to the image on disk
 * @returns {Promise<String>}
 */
export async function extractText(imagePath) {
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(imagePath);
    return (text || "").trim();
  } finally {
    await worker.terminate();
  }
}
