import type { JSONContent } from '@tiptap/react';
import type { CaseAsset, ScopeEntry } from '../pre-project/content';

export type NoteDocument = { version: 1; content: JSONContent };
export type RequirementNote = { storage?: 'case'; scope?: ScopeEntry; id: string; version: number; title: string; note: string; archived: boolean; pinned?: boolean; document?: NoteDocument; assets?: CaseAsset[]; links?: string[]; updatedAt?: string; updatedByName?: string };
export const NOTE_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,application/pdf,video/mp4,video/webm';
export function textDocument(text: string): NoteDocument {
  return { version: 1, content: { type: 'doc', content: text.split(/\r?\n/).map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) } };
}
export function documentText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'noteMedia') return [node.attrs?.caption, node.attrs?.url].filter(Boolean).join('\n');
  return (node.content ?? []).map(documentText).join(['paragraph', 'heading', 'codeBlock'].includes(node.type ?? '') ? '' : '\n');
}
export function mediaIds(node: JSONContent): Set<string> {
  return new Set([...(node.type === 'noteMedia' && node.attrs?.assetId ? [String(node.attrs.assetId)] : []), ...(node.content ?? []).flatMap(child => [...mediaIds(child)])]);
}
export function safeNoteLink(value: string): string {
  const raw = value.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!raw || raw.length > 2000 || !['https:', 'http:'].includes(u.protocol) || u.username || u.password || !u.hostname.includes('.')) throw new Error();
    return u.href;
  } catch { throw new Error('Use an http or https website link without login details.'); }
}
export function videoSource(value: string): { url: string; embed?: string } {
  const url = safeNoteLink(value), u = new URL(url), host = u.hostname.toLowerCase().replace(/^www\./, '');
  const youtube = host === 'youtu.be' ? u.pathname.slice(1) : host === 'youtube.com' ? u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1] : '';
  if (youtube && /^[\w-]{11}$/.test(youtube)) return { url: `https://www.youtube.com/watch?v=${youtube}`, embed: `https://www.youtube-nocookie.com/embed/${youtube}` };
  const vimeo = host === 'vimeo.com' ? u.pathname.match(/^\/(\d+)$/)?.[1] : '';
  if (vimeo) return { url: `https://vimeo.com/${vimeo}`, embed: `https://player.vimeo.com/video/${vimeo}` };
  if (u.protocol === 'https:' && /\.(mp4|webm)$/i.test(u.pathname)) return { url };
  throw new Error('Use a YouTube, Vimeo, or HTTPS MP4/WebM video link.');
}
export function noteMedia(asset: CaseAsset): JSONContent {
  return { type: 'noteMedia', attrs: { id: crypto.randomUUID(), assetId: asset.id, kind: asset.mimeType.startsWith('image/') ? 'image' : asset.mimeType.startsWith('video/') ? 'video' : 'file', url: null, caption: '' } };
}
export function noteDocument(note: RequirementNote): NoteDocument {
  if (note.document) return note.document;
  const doc = textDocument(note.note);
  // Legacy attachments become inline blocks on first edit, without changing existing records on read.
  doc.content.content!.push(...(note.assets ?? []).map(noteMedia));
  for (const url of note.links ?? []) doc.content.content!.push({ type: 'paragraph', content: [{ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url, target: '_blank', rel: 'noopener noreferrer' } }] }] });
  return doc;
}

/** Preserve destinations hidden behind rich-text labels when switching to plain forms. */
export function requirementNoteLinks(note: RequirementNote): string[] {
  const links = new Set<string>();
  const add = (value: unknown) => { if (typeof value === 'string') { try { links.add(safeNoteLink(value)); } catch { /* Never render unsafe legacy URLs. */ } } };
  (note.links ?? []).forEach(add);
  const visit = (node: JSONContent) => {
    node.marks?.filter(mark => mark.type === 'link').forEach(mark => add(mark.attrs?.href));
    if (node.type === 'noteMedia' && node.attrs?.url) add(node.attrs.url);
    node.content?.forEach(visit);
  };
  if (note.document) visit(note.document.content);
  return [...links];
}

/** Title-only edits keep existing rich content intact; edited text becomes plain text. */
export function plainNoteDraft(original: RequirementNote, draft: RequirementNote): RequirementNote {
  if (draft.note.length > 60000) throw new Error('Keep each note under 60,000 characters.');
  const assetIds = new Set((draft.assets ?? []).map(asset => asset.id));
  const links = new Set(draft.links ?? []);
  const hasLink = (value: unknown) => { try { return typeof value === 'string' && links.has(safeNoteLink(value)); } catch { return false; } };
  const keep = (node: JSONContent): JSONContent[] => {
    if (node.type === 'noteMedia' && node.attrs?.assetId && !assetIds.has(node.attrs.assetId)) return [];
    if (node.type === 'noteMedia' && node.attrs?.url && !hasLink(node.attrs.url)) return [];
    const content = node.content?.flatMap(keep);
    const marks = node.marks?.filter(mark => mark.type !== 'link' || hasLink(mark.attrs?.href));
    // Container blocks require at least one child in the document schema.
    if (content && !content.length && ['blockquote', 'bulletList', 'orderedList', 'listItem'].includes(node.type ?? '')) return [];
    return [{ ...node, ...(content ? { content: node.type === 'doc' && !content.length ? [{ type: 'paragraph' }] : content } : {}), ...(marks ? { marks } : {}) }];
  };
  const document = original.document && draft.note === original.note
    ? { version: 1 as const, content: keep(original.document.content)[0] }
    : textDocument(draft.note);
  return { ...draft, document };
}

type Mark = { type: string; attrs?: Record<string, unknown> };
/** Inline markdown (**bold**, *italic* / _italic_, `code`, [label](https://…)) as text nodes with marks. */
function inlineMarkdown(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*|_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0; let match: RegExpExecArray | null;
  const push = (value: string, marks?: Mark[]) => { if (value) nodes.push({ type: "text", text: value, ...(marks ? { marks } : {}) }); };
  while ((match = pattern.exec(text))) {
    push(text.slice(last, match.index));
    if (match[2]) push(match[2], [{ type: "bold" }]);
    else if (match[4] ?? match[5]) push((match[4] ?? match[5])!, [{ type: "italic" }]);
    else if (match[7]) push(match[7], [{ type: "code" }]);
    else if (match[9]) push(match[9], [{ type: "link", attrs: { href: match[10] } }]);
    last = match.index + match[0].length;
  }
  push(text.slice(last));
  return nodes;
}

/**
 * Plain-text notes written with markdown habits (# headings, - lists, 1. lists, > quotes, **bold**)
 * as a document, so they read the same as notes written in the editor.
 */
export function markdownDocument(text: string): JSONContent {
  const blocks: JSONContent[] = [];
  let list: JSONContent | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const item = task ?? bullet ?? ordered;
    if (item) {
      const type = ordered && !bullet ? "orderedList" : "bulletList";
      if (!list || list.type !== type) { list = { type, content: [] }; blocks.push(list); }
      const content = task ? task[2] : item[1];
      list.content!.push({ type: "listItem", attrs: task ? { checked: task[1].toLowerCase() === "x" } : undefined, content: [{ type: "paragraph", content: inlineMarkdown(content) }] });
      continue;
    }
    list = null;
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) { blocks.push({ type: "heading", attrs: { level: heading[1].length }, content: inlineMarkdown(heading[2]) }); continue; }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { blocks.push({ type: "blockquote", content: [{ type: "paragraph", content: inlineMarkdown(quote[1]) }] }); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { blocks.push({ type: "horizontalRule" }); continue; }
    if (!line.trim()) continue;
    blocks.push({ type: "paragraph", content: inlineMarkdown(line) });
  }
  return { type: "doc", content: blocks };
}
