import { BadRequestException } from '@nestjs/common';

export type NoteNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: NoteNode[] };
export type NoteDocument = { version: 1; content: NoteNode };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const blocks = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'noteMedia']);
const fail = (message = 'This note contains unsupported formatting. Update the editor and try again.'): never => { throw new BadRequestException(message); };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const string = (v: unknown, max: number) => typeof v === 'string' && v.length <= max ? v : fail();

export function noteLink(value: unknown): string {
  const raw = string(value, 2000);
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.')) return fail('Use an http or https link without login details.');
    return u.href;
  } catch { return fail('Use an http or https link without login details.'); }
}

export function noteVideoLink(value: unknown): string {
  const url = noteLink(value), u = new URL(url), host = u.hostname.toLowerCase().replace(/^www\./, '');
  const youtube = host === 'youtu.be' ? u.pathname.slice(1) : host === 'youtube.com' ? u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1] : '';
  if (youtube && /^[\w-]{11}$/.test(youtube)) return `https://www.youtube.com/watch?v=${youtube}`;
  const vimeo = host === 'vimeo.com' ? u.pathname.match(/^\/(\d+)$/)?.[1] : '';
  if (vimeo) return `https://vimeo.com/${vimeo}`;
  if (/\.(mp4|webm)$/i.test(u.pathname) && u.protocol === 'https:') return url;
  return fail('Use a YouTube, Vimeo, or HTTPS MP4/WebM video link.');
}

/** Versioned, device-independent blocks. Media keeps its identity and private asset reference when text moves. */
export function validateNoteDocument(value: unknown, assets: Map<string, { mimeType: string }>): NoteDocument {
  if (JSON.stringify(value).length > 350_000) fail('This note is too large. Split it into smaller notes.');
  const doc = record(value);
  if (doc.version !== 1) fail('This note uses a newer format. Update the editor before saving.');
  let count = 0;
  const ids = new Set<string>();
  const visit = (input: unknown, parent: string, depth: number): NoteNode => {
    if (++count > 10000 || depth > 16) fail('This note is too complex. Split it into smaller notes.');
    const n = record(input), type = string(n.type, 40);
    const permitted = parent === 'root' ? type === 'doc' : ['paragraph', 'heading'].includes(parent) ? ['text', 'hardBreak'].includes(type) : parent === 'codeBlock' ? type === 'text' : ['bulletList', 'orderedList'].includes(parent) ? type === 'listItem' : blocks.has(type);
    if (!permitted) fail();
    const result: NoteNode = { type };
    if (type === 'text') { result.text = string(n.text, 60000); if (!result.text) fail(); }
    const attrs = n.attrs == null ? {} : record(n.attrs);
    if (type === 'heading') { if (![1, 2, 3].includes(Number(attrs.level))) fail(); result.attrs = { level: Number(attrs.level) }; }
    if (type === 'orderedList') { const start = attrs.start ?? 1; if (!Number.isInteger(start) || Number(start) < 1 || Number(start) > 10000) fail(); result.attrs = { start }; }
    if (type === 'codeBlock') result.attrs = { language: null };
    if (type === 'noteMedia') {
      const id = string(attrs.id, 36), kind = string(attrs.kind, 20);
      if (!uuid.test(id) || ids.has(id) || !['image', 'video', 'file', 'drawing'].includes(kind)) fail();
      ids.add(id);
      const caption = string(attrs.caption ?? '', 2000);
      if (attrs.assetId) {
        const assetId = string(attrs.assetId, 36), asset = assets.get(assetId) ?? fail('A media file is missing from this note. Reattach it before saving.');
        if ((['image', 'drawing'].includes(kind) && !asset.mimeType.startsWith('image/')) || (kind === 'video' && !asset.mimeType.startsWith('video/'))) fail('This media file does not match its block.');
        result.attrs = { id, kind, assetId, url: null, caption };
      } else {
        if (kind !== 'video') fail('Attach an image or file from your device.');
        result.attrs = { id, kind, assetId: null, url: noteVideoLink(attrs.url), caption };
      }
    }
    if (n.marks != null) {
      if (type !== 'text' || !Array.isArray(n.marks) || n.marks.length > 6) fail();
      result.marks = (n.marks as unknown[]).map(mark => {
        const m = record(mark), mt = string(m.type, 24);
        if (!['bold', 'italic', 'strike', 'underline', 'code', 'link'].includes(mt)) fail();
        return mt === 'link' ? { type: mt, attrs: { href: noteLink(record(m.attrs).href), target: '_blank', rel: 'noopener noreferrer' } } : { type: mt };
      });
    }
    if (!['text', 'hardBreak', 'horizontalRule', 'noteMedia'].includes(type)) {
      if (n.content != null && !Array.isArray(n.content)) fail();
      result.content = ((n.content ?? []) as unknown[]).map(child => visit(child, type, depth + 1));
      if (['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem'].includes(type) && !result.content.length) fail();
      if (type === 'listItem' && result.content[0]?.type !== 'paragraph') fail();
    } else if (n.content != null) fail();
    return result;
  };
  const content = visit(doc.content, 'root', 0);
  if (noteDocumentText(content).length > 60000) fail('Keep each note under 60,000 characters.');
  return { version: 1, content };
}

/** Keep a searchable text projection for CRM and Woody; formatting never replaces the requirement text. */
export function noteDocumentText(node: NoteNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'noteMedia') return [node.attrs?.caption, node.attrs?.url].filter(Boolean).join('\n');
  return (node.content ?? []).map(noteDocumentText).join(['paragraph', 'heading', 'codeBlock'].includes(node.type) ? '' : '\n');
}
