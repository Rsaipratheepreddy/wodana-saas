import type {CommercialState, ProposalKit, Quote, QuoteCanvasElement, QuoteCanvasPage, QuotePresentation} from './types';

/**
 * The standard proposal layout (cover, letter, schedule, terms, closing). Every firm gets the same
 * Wodana-designed pages; what changes is the firm's own content — its name and logo, brand colour,
 * and the words and pictures in its proposal kit. Nothing here is specific to any tenant, and any
 * part the firm hasn't filled in is left out rather than borrowed.
 *
 * `REFERENCE_LAYOUT` is the stored layout id. Its value is historical (documents already saved
 * carry it), so it is kept as is; it names the layout, not a tenant.
 */
export const REFERENCE_LAYOUT = 'palm-reference-v1' as const;
export const isReferenceLayout = (template?: string) => template === REFERENCE_LAYOUT;

/** The short line a quote gets when the firm hasn't written terms of its own (mirrors business-core). */
export const FALLBACK_QUOTE_TERMS = 'Payment terms and delivery dates are subject to the agreed contract.';

/** Draft quotes still on the fallback line pick up the firm's own terms; anything written or issued stays. */
export const referenceTermsFor = (quote: Quote, kit?: ProposalKit | null) =>
  quote.status && quote.status !== 'draft' ? quote.terms
    : (!quote.terms?.trim() || quote.terms === FALLBACK_QUOTE_TERMS) && kit?.defaultTerms ? kit.defaultTerms : quote.terms;

const PAPER = '#ffffff', INK = '#2b2420', MUTED = '#6f6763', ON_BRAND = '#ffffff';
const text = (id: string, value: string, x: number, y: number, width: number, height: number, fontSize = 19, color = INK, align: 'left' | 'center' | 'right' = 'left'): QuoteCanvasElement => ({id, type: 'text', text: value, x, y, width, height, fontSize, color, align});
const image = (id: string, src: string, x: number, y: number, width: number, height: number): QuoteCanvasElement => ({id, type: 'image', src, x, y, width, height});
const page = (id: string, elements: QuoteCanvasElement[], background = PAPER, backgroundImage?: string): QuoteCanvasPage => ({id, kind: 'custom', background, elements, ...(backgroundImage ? {backgroundImage} : {})});
const termsColumn = (id: string, value: string, x: number, y: number, height: number, color: string): QuoteCanvasElement => ({
  ...text(id, value, x, y, 414, height, 10.7, color),
  richText: {type: 'doc', content: value.split('\n').map(line => ({type: 'paragraph', content: line ? [{type: 'text', text: line, ...(line === line.toUpperCase() && /\p{Lu}/u.test(line) ? {marks: [{type: 'bold'}]} : {})}] : []}))},
});
function textChunks(value: string) {
  const chunks: string[] = []; let remaining = value;
  while (remaining.length > 3200) { const space = remaining.lastIndexOf(' ', 3200), cut = space > 2000 ? space : 3200; chunks.push(remaining.slice(0, cut)); remaining = remaining.slice(cut).trimStart(); }
  chunks.push(remaining);
  return chunks;
}
/** Split terms into two balanced columns at a paragraph break when possible. */
function termColumns(value: string): string[] {
  const chunks = textChunks(value);
  if (chunks.length > 1) return chunks;
  const half = Math.floor(value.length / 2), breakAt = value.indexOf('\n\n', half);
  return breakAt > 0 && breakAt < value.length - 1 ? [value.slice(0, breakAt).trim(), value.slice(breakAt).trim()] : [value, ''];
}

/** A clean, editable proposal built from the firm's brand and proposal kit. No sample customer, scope or firm is copied. */
export function referencePresentation(quote: Quote, company: string, customer: string, context?: CommercialState): QuotePresentation {
  const kit = context?.proposalKit ?? null;
  const brand = company || context?.portalBrand?.name || '';
  const accent = context?.portalBrand?.primaryColor || INK;
  const companyLogo = context?.portalBrand?.logo || '';
  const contact = context?.contacts.find(item => item.name === customer) ?? context?.contacts[0];
  const terms = referenceTermsFor(quote, kit) ?? '';
  const columns = terms.trim() ? termColumns(terms) : [];
  const monogram = (x: number, y: number, size: number) => kit?.monogramImage ? [image('brand-mark', kit.monogramImage, x, y, size, size)] : [];
  const termsPictures = kit?.termsImages ?? [];
  const website = kit?.website?.replace(/^https?:\/\//i, '') ?? '';
  const contactBlock = [kit?.contactDetails?.trim(), context?.portalBrand?.supportPhone && !kit?.contactDetails?.includes(context.portalBrand.supportPhone) ? context.portalBrand.supportPhone : '', website]
    .filter(Boolean).join('\n\n');

  const pages: QuoteCanvasPage[] = [
    page('cover', [
      text('data:company-logo', brand, 110, 110, 720, 360, 56, ON_BRAND, 'center'),
      text('proposal-title', 'PROPOSAL', 100, 566, 740, 72, 49, ON_BRAND, 'center'),
      text('data:cover-client', '', 175, 696, 590, 92, 27, ON_BRAND, 'center'),
      text('data:client-logo', '', 790, 700, 100, 80),
      text('created-label', 'PREPARED BY', 43, 1080, 620, 40, 20, ON_BRAND),
      text('data:prepared-by', '', 43, 1129, 730, 81, 27, ON_BRAND),
      text('data:issued-date', '', 43, 1255, 690, 35, 19, ON_BRAND),
      ...monogram(773, 1163, 143),
    ], accent),
  ];
  // The introduction page only exists when the firm has written or pictured one.
  if (kit?.introduction || kit?.introductionImage) pages.push(page('custom:introduction', [
    ...(kit.introductionImage ? [image('introduction-picture', kit.introductionImage, 0, 0, 940, 760)] : []),
    ...(kit.introduction ? [text('introduction-copy', kit.introduction, 84, kit.introductionImage ? 820 : 140, 772, 420, 19, INK)] : []),
    ...monogram(800, 1200, 90),
  ]));
  pages.push(page('custom:letter', [
    ...monogram(800, 60, 80),
    text('data:project-details', '', 64, 195, 795, 86),
    text('letter-introduction', 'We are pleased to present the enclosed proposal for the project referenced above, which is submitted for your review and approval.', 64, 296, 812, 62),
    text('data:estimate', '', 64, 373, 812, 58),
    text('data:proposal-totals', '', 64, 449, 570, 140, 18),
    text('data:validity', '', 64, 642, 812, 50),
    ...(kit?.letterNote ? [text('letter-note', kit.letterNote, 64, 696, 812, 70)] : []),
    text('letter-help', 'Should you require any additional information or clarification during your review, please do not hesitate to contact us.', 64, 772, 812, 61),
    text('letter-closing', 'We look forward to working with you.\n\nKind regards,', 64, 846, 812, 90),
    text('data:prepared-by', '', 64, 1038, 740, 90),
    text('signature', '___________________________________\nClient Signature', 70, 1160, 700, 64, 18),
  ]));
  if (columns.length) {
    const pictured = termsPictures.length > 0;
    const top = pictured ? 470 : 90, bodyTop = top + 56, bodyHeight = (website ? 1270 : 1300) - bodyTop;
    const slot = termsPictures.length ? Math.floor((860 - (termsPictures.length - 1) * 24) / termsPictures.length) : 0;
    pages.push(page('terms', [
      ...termsPictures.map((src, index) => image(`terms-photo-${index + 1}`, src, 40 + index * (slot + 24), 69, slot, 362)),
      text('terms-heading', 'TERMS AND CONDITIONS', 40, top, 860, 50, 23, INK, 'center'),
      termsColumn('field:terms-left', columns[0] ?? '', 33, bodyTop, bodyHeight, INK),
      termsColumn('field:terms-right', columns[1] ?? '', 491, bodyTop, bodyHeight, INK),
      ...(website ? [text('website', website.toUpperCase(), 120, 1285, 700, 26, 15, MUTED, 'center')] : []),
    ]));
    pages.push(...columns.slice(2).map((chunk, index) => page(`custom:terms-${index}`, [text(`field:terms-extra-${index}`, chunk, 64, 100, 812, 1110, 18)])));
  }
  pages.push(...[quote.inclusions ? ['inclusions', 'Included in this proposal', quote.inclusions] : null, quote.exclusions ? ['exclusions', 'Excluded from this proposal', quote.exclusions] : null]
    .filter((entry): entry is string[] => Boolean(entry))
    .flatMap(([field, heading, body]) => textChunks(body).map((chunk, index) => page(`custom:${field}-${index}`, [text(`${field}-heading`, heading, 64, 70, 812, 80, 32), text(`field:${field}:${index}`, chunk, 64, 200, 812, 1050, 18)]))));
  pages.push(page('custom:closing', [
    ...(kit?.closingImage ? [image('closing-photo', kit.closingImage, 0, 0, 940, 900)] : []),
    text('closing-heading', contactBlock ? 'CONTACT US' : 'THANK YOU', 24, kit?.closingImage ? 960 : 520, 840, 62, 38, ON_BRAND),
    ...(contactBlock ? [text('closing-contact', contactBlock, 28, kit?.closingImage ? 1040 : 600, 820, 240, 16, ON_BRAND)] : []),
    text('closing-company', brand, 28, 1260, 700, 30, 16, ON_BRAND),
    ...monogram(800, 1180, 100),
  ], accent));

  const custom = pages.filter(item => !['cover', 'custom:introduction', 'custom:letter'].includes(item.id)).map(item => item.id);
  return {
    version: 1, template: REFERENCE_LAYOUT, pageBackground: PAPER, textColor: INK, accentColor: accent,
    details: {
      companyName: brand, companyLogo, clientName: quote.cover?.preparedFor || customer,
      clientPhone: context?.customerPhone || contact?.phone || '', clientEmail: context?.customerEmail || '',
      projectName: context?.title || quote.title, location: quote.cover?.location || context?.customerAddress || '',
      reference: `QT-${quote.id.slice(0, 8).toUpperCase()} · Rev ${quote.number}`, date: quote.createdAt?.slice(0, 10) || '',
      preparedBy: quote.cover?.signerName || '', estimator: '', manager: '',
    },
    scopeColumns: {hidden: [], custom: []},
    pageOrder: ['cover', ...(pages.some(item => item.id === 'custom:introduction') ? ['custom:introduction'] : []), 'custom:letter', 'scope', ...custom],
    pages,
  };
}

export function referenceItemPage(start: number): QuoteCanvasPage {
  return page(`items:${start}`, [...(start === 0 ? [text('data:item-letterhead', '', 79, 87, 782, 165, 11, '#333333')] : []), text(`data:reference-items:${start}`, '', 79, start === 0 ? 252 : 87, 782, start === 0 ? 984 : 1149, 10, '#333333')]);
}

/** Reserve space for wrapped specifications, room headings and the final totals. */
export function referenceItemGroups(lines: Quote['lines']): {start: number; count: number}[] {
  const groups: {start: number; count: number}[] = [];
  let start = 0, used = 0, count = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const description = [line.specification, line.material, line.finish, ...(line.materialRows ?? []).map(row => `${row.name} ${row.specification}`), ...(line.customMaterials ?? []).map(row => `${row.name} ${row.specification}`)].filter(Boolean).join(' · ');
    const row = Math.max(116, Math.ceil(description.length / 24) * 11 + 16, Math.ceil((line.title ?? '').length / 30) * 11 + 16);
    const room = (!count || lines[index - 1]?.room !== line.room) ? 22 : 0;
    if (count && (count >= 7 || used + row + room > (index === lines.length - 1 ? 830 : 940))) { groups.push({start, count}); start = index; used = 0; count = 0; }
    used += row + (!count ? 22 : room);
    count++;
  }
  groups.push({start, count});
  return groups;
}
