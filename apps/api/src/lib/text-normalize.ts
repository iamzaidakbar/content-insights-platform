/**
 * PDF.js often emits glyph-spaced names ("Z A I D A K B A R") when fonts use
 * per-character positioning. Collapse runs of ≥3 single letters so full-text
 * search can match the natural spelling ("ZAIDAKBAR" / users typing "Zaid").
 */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (match) => match.replace(/\s+/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
