/**
 * Reading an email for the inbox: its addresses, its Message-ID chain (for threading), a subject that matches
 * across "Re:" and "Fwd:", the text without the quoted history, and its HTML reduced to safe markup.
 */

export type EmailAddress = { address: string; name: string | null };

const ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const MAX_ID = 998;

/** The addresses in a header value: `"Doe, Jane" <jane@x.com>, bob@y.com`. Invalid entries are left out. */
export function parseAddressList(value: string | null | undefined): EmailAddress[] {
  const parts: string[] = [];
  let current = "", quoted = false, angle = 0;
  for (const character of String(value ?? "")) {
    if (character === '"') quoted = !quoted;
    else if (character === "<" && !quoted) angle += 1;
    else if (character === ">" && !quoted) angle = Math.max(0, angle - 1);
    if ((character === "," || character === ";") && !quoted && angle === 0) { parts.push(current); current = ""; continue; }
    current += character;
  }
  parts.push(current);
  const found: EmailAddress[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const bracket = /<([^<>]*)>\s*$/.exec(trimmed);
    const address = (bracket ? bracket[1] : trimmed).trim().toLowerCase();
    if (!ADDRESS.test(address) || address.length > 320) continue;
    const name = bracket ? trimmed.slice(0, bracket.index).trim().replace(/^"(.*)"$/s, "$1").replace(/\\(.)/g, "$1").replace(/[\r\n]+/g, " ").trim() : "";
    found.push({ address, name: name && name.toLowerCase() !== address ? name.slice(0, 240) : null });
  }
  return found;
}

/** The Message-IDs in a header (In-Reply-To, References), with their angle brackets, oldest first. */
export function parseMessageIds(value: string | null | undefined): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const bracketed = [...text.matchAll(/<([^<>\s]{1,996})>/g)].map((match) => `<${match[1]}>`);
  const ids = bracketed.length ? bracketed : /^[^\s<>]{3,996}$/.test(text) ? [`<${text}>`] : [];
  return [...new Set(ids)].filter((id) => id.length <= MAX_ID).slice(-50);
}

const PREFIX = /^\s*(?:(?:re|fw|fwd|aw|wg|sv|vs|antw|tr|rv|enc|ref|رد|إعادة توجيه)\s*(?:\[\d+\])?\s*[:：]\s*)+/iu;

/** The subject without its reply and forward prefixes ("Re: Fwd: Kitchen" reads "Kitchen"). */
export function baseSubject(subject: string | null | undefined): string {
  let text = String(subject ?? "").replace(/[\r\n\t]+/g, " ").trim();
  for (let index = 0; index < 10 && PREFIX.test(text); index += 1) text = text.replace(PREFIX, "").trim();
  return text.replace(/\s{2,}/g, " ").slice(0, 900);
}

/** The key two emails' subjects are compared by when they have no Message-ID in common. */
export function subjectKey(subject: string | null | undefined): string {
  return baseSubject(subject).toLowerCase();
}

/** The subject of our reply: "Re: " and the client's subject (never "Re: Re: …"). */
export function replySubject(subject: string | null | undefined, fallback: string): string {
  const base = baseSubject(subject) || fallback;
  return `Re: ${base}`.slice(0, 900);
}

/** Lines that start the quoted history a mail client appends under a reply. */
const QUOTE_START = [
  /^On .{4,300}wrote:\s*$/i,
  /^Le .{4,300}a écrit\s*:\s*$/i,
  /^Am .{4,300}schrieb .{0,200}:\s*$/i,
  /^El .{4,300}escribió:\s*$/i,
  /^في .{4,300}كتب.{0,100}:\s*$/u,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^From:\s.+$/i,
];

/**
 * The new part of an email, without the quoted history under it (for the chat view; the whole text is kept). A
 * "From:" line only starts the history when a "Sent:" or "Date:" line follows it, as Outlook writes it.
 */
export function stripQuotedText(text: string | null | undefined): string {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let end = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const next = lines.slice(index + 1, index + 4).map((value) => value.trim());
    const outlookHeader = /^From:\s/i.test(line) ? next.some((value) => /^(Sent|Date|Envoyé|Gesendet):\s/i.test(value)) : true;
    // "On … wrote:" can wrap over two lines in some clients.
    const wrapped = /^On\s.{4,200}$/i.test(line) && /wrote:\s*$/i.test(lines[index + 1]?.trim() ?? "");
    if ((QUOTE_START.some((pattern) => pattern.test(line)) && outlookHeader) || wrapped) { end = index; break; }
  }
  const kept = lines.slice(0, end);
  // Trailing "> …" lines are quoted too.
  while (kept.length && (/^\s*>/.test(kept.at(-1)!) || !kept.at(-1)!.trim())) kept.pop();
  const result = kept.join("\n").trim();
  return result || String(text ?? "").trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** The readable text of an HTML email, for one that came without a plain-text part. */
export function htmlToText(html: string | null | undefined): string {
  return decodeEntities(String(html ?? "")
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const ALLOWED_TAGS = new Set(["a", "b", "strong", "i", "em", "u", "s", "p", "br", "div", "span", "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "small", "sub", "sup"]);
const VOID_TAGS = new Set(["br", "hr"]);
/** Elements dropped with everything inside them. */
const DROPPED = /<(script|style|head|title|iframe|object|embed|applet|frameset|frame|noscript|template|svg|math|form|select|textarea|button|xml)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (value: string) => value.replace(/&(?!(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * An email's HTML reduced to a short list of formatting elements: no scripts, styles, forms, frames, images
 * (no tracking pixels), event handlers or inline styles; links keep only an http(s) or mailto address and open
 * in a new tab without a referrer. Every tag is rebuilt from scratch, so nothing malformed passes through.
 */
export function sanitizeEmailHtml(html: string | null | undefined): string | null {
  const source = String(html ?? "").slice(0, 400_000).replace(/<!--[\s\S]*?(-->|$)/g, "").replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, "").replace(/<![^>]*>/g, "").replace(/<\?[\s\S]*?(\?>|$)/g, "")
    .replace(DROPPED, "");
  const output: string[] = [];
  const open: string[] = [];
  const tag = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
  let last = 0;
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    output.push(escapeText(source.slice(last, match.index)));
    last = match.index + match[0].length;
    const name = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) continue;
    if (match[0][1] === "/") {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) output.push(`</${open.pop()}>`);
      continue;
    }
    let attributes = "";
    if (name === "a") {
      const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(match[2]);
      const value = decodeEntities((href?.[2] ?? href?.[3] ?? href?.[4] ?? "").trim()).replace(/[\x00-\x20]/g, "");
      if (/^(https?:\/\/|mailto:)/i.test(value)) attributes = ` href="${escapeAttribute(value.slice(0, 2000))}" target="_blank" rel="noopener noreferrer nofollow"`;
    }
    if (name === "td" || name === "th") {
      const span = /\b(colspan|rowspan)\s*=\s*["']?(\d{1,2})/gi;
      for (let found = span.exec(match[2]); found; found = span.exec(match[2])) attributes += ` ${found[1].toLowerCase()}="${found[2]}"`;
    }
    if (VOID_TAGS.has(name)) { output.push(`<${name}>`); continue; }
    output.push(`<${name}${attributes}>`);
    open.push(name);
  }
  output.push(escapeText(source.slice(last)));
  while (open.length) output.push(`</${open.pop()}>`);
  const clean = output.join("").replace(/\n{3,}/g, "\n\n").trim();
  return clean ? clean.slice(0, 200_000) : null;
}

/** Whether a message is an automatic one (an out-of-office or a bounce) by its headers. */
export function isAutomatic(headers: Map<string, string>): boolean {
  const submitted = (headers.get("auto-submitted") ?? "").trim().toLowerCase();
  const precedence = (headers.get("precedence") ?? "").trim().toLowerCase();
  return (submitted !== "" && submitted !== "no") || ["bulk", "junk", "auto_reply"].includes(precedence) || headers.has("x-autoreply") || headers.has("x-autorespond");
}
