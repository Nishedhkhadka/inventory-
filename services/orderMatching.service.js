/**
 * Order matching service.
 * ─────────────────────────
 * Turns raw OCR text off a package label into a ranked list of candidate
 * Sale orders with a 0-100 confidence score. Kept separate from
 * ocr.service.js on purpose: the text-extraction backend can change (see
 * ocr.service.js's header) without this matching logic — or its scoring
 * weights — needing to change at all.
 *
 * How a typical label reads (per Zeno's own packaging convention):
 *   Zeno            <- business name, ignored
 *   9803311634      <- business phone, ignored (see BUSINESS_PHONES)
 *   Popup Black     <- product/colour, ignored for matching
 *   Hari Bahadur     <- customer name
 *   9852365231      <- customer phone (not always present)
 * An order ID (e.g. "YGJ-020") isn't always handwritten on the package, so
 * matching leans on whichever signals are actually present — the score is
 * additive across order ID / phone / name so a label with only a name and
 * phone can still produce a confident match.
 */
import stringSimilarity from "string-similarity";

// The business's own numbers show up on every label and would otherwise
// get misread as a customer phone — filtered out before matching.
const BUSINESS_PHONES = (process.env.BUSINESS_PHONE_NUMBERS || "9803311634")
  .split(",")
  .map((p) => p.replace(/\D/g, ""))
  .filter(Boolean);

const ORDER_ID_REGEX = /\b[A-Za-z]{2,6}-?\d{2,6}\b/g;
const PHONE_REGEX = /\b\d{7,10}\b/g;

const normalizePhone = (p) => String(p || "").replace(/\D/g, "");
const normalizeOrderId = (id) => String(id || "").toUpperCase().replace(/[\s-]/g, "");

/**
 * Pulls likely order-id / phone-number / name-line candidates out of raw
 * OCR text. Deliberately permissive — false positives here just cost a
 * little scoring noise, false negatives cost a missed match entirely.
 */
function extractCandidates(rawText) {
  const text = rawText || "";

  const orderIds = [...new Set((text.match(ORDER_ID_REGEX) || []).map(normalizeOrderId))];

  const phones = [...new Set((text.match(PHONE_REGEX) || []).map(normalizePhone))].filter(
    (p) => p.length >= 7 && !BUSINESS_PHONES.includes(p)
  );

  // Name-ish lines: mostly-alphabetic, a couple of words, no digits — and
  // not the business's own name.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const nameLines = lines.filter(
    (l) => /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(l) && l.split(/\s+/).length <= 4 && !/^zeno$/i.test(l)
  );

  return { orderIds, phones, nameLines, rawLines: lines };
}

function scoreSale(sale, candidates) {
  let score = 0;
  const matchedOn = [];

  // Order ID — strongest signal when present, since it's unambiguous.
  const saleOrderId = normalizeOrderId(sale.orderId);
  if (candidates.orderIds.includes(saleOrderId)) {
    score += 55;
    matchedOn.push("order id");
  } else if (candidates.orderIds.length) {
    const best = Math.max(
      ...candidates.orderIds.map((id) => stringSimilarity.compareTwoStrings(id, saleOrderId))
    );
    if (best > 0.6) {
      score += Math.round(best * 30);
      matchedOn.push("order id (approx.)");
    }
  }

  // Phone — very strong signal, compared on the last 8 digits so a leading
  // 0 or country code doesn't break an otherwise exact match.
  const salePhone = normalizePhone(sale.customerPhone);
  if (salePhone && candidates.phones.length) {
    const tail = salePhone.slice(-8);
    if (candidates.phones.some((p) => p.slice(-8) === tail)) {
      score += 35;
      matchedOn.push("phone");
    }
  }

  // Customer name — fuzzy, since handwriting/OCR rarely matches casing or
  // spelling exactly.
  const saleName = String(sale.pointOfContact || "").trim();
  if (saleName && candidates.nameLines.length) {
    const best = Math.max(
      ...candidates.nameLines.map((l) =>
        stringSimilarity.compareTwoStrings(l.toLowerCase(), saleName.toLowerCase())
      )
    );
    if (best > 0.45) {
      score += Math.round(best * 25);
      matchedOn.push("customer name");
    }
  }

  return { score: Math.min(100, score), matchedOn };
}

/**
 * @param {String} ocrText - raw text from ocr.service.extractText
 * @param {Array} candidateSales - Sale documents to score against (the
 *   packaging page's own pending list — see packagingController.js)
 * @returns {{ extracted: Object, matches: Array }} matches sorted by
 *   confidence descending, each { sale, score, matchedOn }
 */
export function matchOrder(ocrText, candidateSales) {
  const extracted = extractCandidates(ocrText);

  const matches = candidateSales
    .map((sale) => ({ sale, ...scoreSale(sale, extracted) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  return { extracted, matches };
}
