/**
 * Category names as people write them: "BED & MATTRESS", "Beds and mattresses" and "Bed & Mattress" are one
 * category. The key ignores case, accents, "&"/"and", spacing, punctuation and a plural ending.
 */
const singular = (word: string) => {
  if (word.length <= 3 || /\d/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  return word.endsWith("s") ? word.slice(0, -1) : word;
};

/** The key two category names share when they name the same category. */
export function categoryKey(name: string): string {
  const plain = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = plain.split(/[^a-z0-9]+/).filter((word) => word && word !== "and");
  return words.length ? words.map(singular).join("") : plain.trim();
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

/**
 * A name as a new category shows it: one written in capitals ("DINING CHAIRS") in Title Case ("Dining Chairs");
 * short words without vowels stay capitals ("TV UNITS" → "TV Units"). A name already in mixed case is kept.
 */
export function categoryTitle(name: string): string {
  const text = name.replace(/\s+/g, " ").trim();
  if (!/\p{Lu}/u.test(text) || /\p{Ll}/u.test(text)) return text;
  let first = true;
  return text.replace(/\p{L}+/gu, (word, offset: number) => {
    const lower = word.toLocaleLowerCase();
    const afterApostrophe = offset > 0 && /['’]/.test(text[offset - 1]);
    const isFirst = first;
    first = false;
    if (afterApostrophe) return lower;
    if (word.length <= 4 && !/[aeiouy]/i.test(word)) return word;
    if (!isFirst && SMALL_WORDS.has(lower)) return lower;
    return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
  });
}
