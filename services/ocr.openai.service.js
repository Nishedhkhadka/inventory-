/**
 * OCR provider: OpenAI Vision.
 * ─────────────────────────────
 * Selected by ocr.service.js by default whenever OPENAI_API_KEY is set.
 * A multimodal model reads the photo directly and transcribes it, which
 * handles handwritten package labels far better than Tesseract (a
 * traditional OCR engine tuned for printed/typed text) — handwriting is
 * exactly the case that motivated adding this provider.
 *
 * Uses axios against the REST API directly (axios is already a project
 * dependency — see services/pickndrop.service.js) rather than pulling in
 * the full openai SDK for a single endpoint.
 */
import fs from "fs";
import axios from "axios";

const MODEL = process.env.OPENAI_OCR_MODEL || "gpt-4o-mini";

const TRANSCRIBE_PROMPT = `You are transcribing a photo of a handwritten (or printed) package shipping label for a small business named Zeno.
Transcribe every piece of text visible in the image exactly as written — names, phone numbers, product names/colours, and any order codes.
Preserve each distinct piece of text on its own line, in the order it appears.
If the photo shows multiple package labels, transcribe all of them, in order, top to bottom / left to right.
Do not translate, correct spelling, or add commentary — output ONLY the transcribed text, nothing else. If truly nothing is legible, output an empty string.`;

function imageToDataUrl(imagePath) {
  const buffer = fs.readFileSync(imagePath);
  const ext = imagePath.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * Runs OCR on an image file via OpenAI's vision model and returns the raw
 * detected text.
 * @param {String} imagePath - absolute path to the image on disk
 * @returns {Promise<String>}
 */
export async function extractText(imagePath) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not set");
    err.code = "OCR_PROVIDER_UNAVAILABLE";
    throw err;
  }

  const dataUrl = imageToDataUrl(imagePath);

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: TRANSCRIBE_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  const text = response.data?.choices?.[0]?.message?.content || "";
  return text.trim();
}
