/** Words that don't narrow a search ("the Harriet sofa" looks for Harriet and sofa). */
const FILLER = new Set(["a", "an", "and", "the", "of", "for", "in", "with", "is", "any", "do", "we", "have"]);

/**
 * A search as separate words, each matched anywhere (in any order, in any of the fields searched): at most six,
 * each an ILIKE pattern with %, _ and \ escaped. A plural's trailing "s" is dropped so "sofas" finds "Sofa".
 * Empty when nothing is left to search for.
 */
export function searchTerms(text: string, max = 6): string[] {
  const words = text.normalize("NFKC").toLocaleLowerCase().split(/[\s,;:/|()"'“”]+/).map((word) => word.replace(/^[.\-]+|[.\-?!]+$/g, "")).filter(Boolean);
  const kept = words.filter((word) => !FILLER.has(word));
  const unique = [...new Set((kept.length ? kept : words).map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word)))];
  return unique.slice(0, max).map(likePattern);
}

/** Text as an ILIKE "contains" pattern. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}
