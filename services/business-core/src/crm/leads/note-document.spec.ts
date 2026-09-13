import { describe, expect, it } from 'vitest';
import { noteDocumentText, validateNoteDocument, noteVideoLink, type NoteNode } from './note-document';
import { noteMediaRange } from './requirement-note-assets.controller';
import { prepareReferenceUpload, referenceVideoType } from '../../workspaces/reference-upload';

const id = '9ac7dcf5-9264-4eb6-8b67-174ba33225ea';
const assetId = 'a19e247c-d25c-4676-82a9-7e134f1dca80';
const doc = (content: NoteNode[]) => ({ version: 1, content: { type: 'doc', content } });
const p = (text: string): NoteNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const media = (kind = 'image'): NoteNode => ({ type: 'noteMedia', attrs: { id, kind, assetId, caption: 'Client sketch' } });
describe('Requirement note document', () => {
  it('round trips formatting, private media and ordered text for Woody', () => {
    const result = validateNoteDocument(doc([{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Kitchen' }] }, p('Deep drawers'), media(), { type: 'bulletList', content: [{ type: 'listItem', content: [p('Matte finish')] }] }]), new Map([[assetId, { mimeType: 'image/png' }]]));
    expect(noteDocumentText(result.content)).toBe('Kitchen\nDeep drawers\nClient sketch\nMatte finish');
    expect(result.content.content?.[2].attrs).toMatchObject({ id, assetId, caption: 'Client sketch' });
    expect(validateNoteDocument(result, new Map([[assetId, { mimeType: 'image/png' }]]))).toEqual(result);
  });
  it('keeps a mobile drawing as a stable media block between paragraphs', () => {
    const result = validateNoteDocument(doc([p('Before'), media('drawing'), p('After')]), new Map([[assetId, { mimeType: 'image/png' }]]));
    expect(result.content.content?.map(n => n.type)).toEqual(['paragraph', 'noteMedia', 'paragraph']);
    expect(result.content.content?.[1].attrs?.id).toBe(id);
  });
  it('requires every media asset to belong to the note', () => {
    expect(() => validateNoteDocument(doc([media()]), new Map())).toThrow('missing');
    expect(() => validateNoteDocument(doc([media('video')]), new Map([[assetId, { mimeType: 'image/png' }]]))).toThrow('does not match');
  });
  it('rejects duplicate block identities and unknown formats without silently dropping them', () => {
    expect(() => validateNoteDocument(doc([media(), media()]), new Map([[assetId, { mimeType: 'image/png' }]]))).toThrow();
    expect(() => validateNoteDocument({ ...doc([p('text')]), version: 2 }, new Map())).toThrow('newer format');
    expect(() => validateNoteDocument(doc([{ type: 'iframe', attrs: { src: 'https://example.com' } }]), new Map())).toThrow('unsupported');
  });
  it.each(['javascript:alert(1)', 'data:text/html,hello', 'https://user:password@example.com'])('rejects unsafe link %s', href => {
    expect(() => validateNoteDocument(doc([{ type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }] }]), new Map())).toThrow('http or https');
  });
  it('drops arbitrary attributes and fixes link relationship attributes', () => {
    const result = validateNoteDocument(doc([{ type: 'paragraph', attrs: { onclick: 'evil' }, content: [{ type: 'text', text: 'Reference', marks: [{ type: 'link', attrs: { href: 'https://example.com', onclick: 'evil', target: '_self' } }] }] }]), new Map());
    expect(result.content.content?.[0].attrs).toBeUndefined();
    expect(result.content.content?.[0].content?.[0].marks?.[0].attrs).toEqual({ href: 'https://example.com/', target: '_blank', rel: 'noopener noreferrer' });
  });
  it('rejects incompatible nesting and excessive size', () => {
    expect(() => validateNoteDocument(doc([{ type: 'paragraph', content: [p('invalid')] }]), new Map())).toThrow();
    expect(() => validateNoteDocument(doc([p('a'.repeat(60001))]), new Map())).toThrow();
    let nested: NoteNode = p('deep'); for (let i = 0; i < 20; i++) nested = { type: 'blockquote', content: [nested] };
    expect(() => validateNoteDocument(doc([nested]), new Map())).toThrow('too complex');
  });
  it('supports approved video links and rejects arbitrary embeds', () => {
    expect(noteVideoLink('https://youtu.be/abcdefghijk')).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(noteVideoLink('https://vimeo.com/123456')).toBe('https://vimeo.com/123456');
    expect(noteVideoLink('https://example.com/site.mp4')).toBe('https://example.com/site.mp4');
    expect(() => noteVideoLink('https://youtube.com.evil.test/watch?v=abcdefghijk')).toThrow();
  });
});
describe('Private note videos', () => {
  it('supports byte ranges for seeking and rejects invalid ranges', () => {
    expect(noteMediaRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(noteMediaRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(noteMediaRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    for (const range of ['bytes=100-', 'bytes=20-10', 'bytes=-0', 'bytes=1-3,5-6', 'bytes=-', 'invalid']) expect(noteMediaRange(range, 100)).toBeNull();
  });
  it('does not accept a filename or MIME as proof of video content', async () => {
    const buffer = Buffer.from('<script>alert(1)</script>');
    expect(referenceVideoType(buffer)).toBeNull();
    await expect(prepareReferenceUpload({ buffer, size: buffer.length, originalname: 'clip.mp4', mimetype: 'video/mp4' }, { allowVideo: true })).rejects.toThrow('supported');
  });
  it('finds a real MP4 video handler and excludes audio-only containers', async () => {
    const box = (name: string, content: Buffer) => { const size = Buffer.alloc(4); size.writeUInt32BE(content.length + 8); return Buffer.concat([size, Buffer.from(name), content]); };
    const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.alloc(4), Buffer.from('mp42')]));
    const movie = (handler: string) => Buffer.concat([ftyp, box('moov', box('trak', box('mdia', box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from(handler), Buffer.alloc(12)]))))) ]);
    expect(referenceVideoType(movie('vide'))).toBe('video/mp4');
    expect(referenceVideoType(movie('soun'))).toBeNull();
    const buffer = movie('vide');
    expect((await prepareReferenceUpload({ buffer, size: buffer.length, originalname: 'site.mp4', mimetype: 'application/octet-stream' }, { allowVideo: true })).mimeType).toBe('video/mp4');
    await expect(prepareReferenceUpload({ buffer, size: buffer.length, originalname: 'site.mp4', mimetype: 'video/mp4' })).rejects.toThrow();
  });
});
