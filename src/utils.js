export const RLM = "\u200F";
export const LRM = "\u200E";

export function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function stripHtml(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function startsWithPersian(text = "") {
  return /^[\s\u200F]*[\u0600-\u06FF]/.test(text);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
