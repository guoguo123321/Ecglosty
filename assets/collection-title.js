/**
 * Removes merchant-defined Metal titles and an immediately preceding "in".
 * Missing metadata leaves the product title intact.
 *
 * @param {string} title - Product or variant display title.
 * @param {string | undefined} metalsJson - Serialized Variant Color Title values.
 * @returns {string}
 */
export function stripCollectionTitle(title, metalsJson) {
  if (!title || !metalsJson) return title || '';

  let metals;
  try {
    metals = JSON.parse(metalsJson);
  } catch {
    return title;
  }
  if (!Array.isArray(metals)) return title;

  const phrases = metals
    .filter((metal) => typeof metal === 'string' && metal.trim())
    .map((metal) => metal.trim());
  if (!phrases.length) return title;

  let result = title;
  for (const phrase of phrases) {
    // Accept the legacy typo while keeping the matching colors metadata-driven.
    const escaped = phrase
      .toLowerCase()
      .replace(/whtie/g, 'white')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/white/g, '(?:white|whtie)');
    result = result.replace(new RegExp(`(?:\\bin\\s+)?${escaped}`, 'gi'), ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}
