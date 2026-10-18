import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "@pdf-lib/fontkit";
import type { Font as FontkitFont, Glyph, GlyphPosition } from "@pdf-lib/fontkit";
import {
  PDFHexString, beginText, endText, popGraphicsState, pushGraphicsState, rgb, setFillingColor, setFontAndSize, setTextMatrix, showText,
  type PDFDocument, type PDFFont, type PDFName, type PDFPage, type RGB,
} from "pdf-lib";

/**
 * Text for server-made PDFs in any script the fonts cover: Latin, Greek and Cyrillic (Noto Sans), Arabic (Noto Naskh
 * Arabic) and Devanagari (Noto Sans Devanagari). Each run of one script is shaped by the font's own OpenType tables
 * (fontkit: Arabic joining forms and lam-alef, Indic conjuncts and matra reordering, marks and kerning), lines are
 * ordered for display with the Unicode bidi algorithm (bidi-js), and right-to-left paragraphs align to the end of
 * their box. Glyphs are placed with their shaped offsets, which pdf-lib's own drawText ignores. Fonts are subset.
 */

// fontkit's Indic shaper is compiled to generator code that expects the regenerator runtime as a global.
(globalThis as { regeneratorRuntime?: unknown }).regeneratorRuntime ??= require("regenerator-runtime");

type Bidi = {
  getEmbeddingLevels(text: string, direction?: "ltr" | "rtl"): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> };
  getMirroredCharacter(char: string): string | null;
};
// bidi-js ships no types; its only export is a factory.
const bidi: Bidi = (require("bidi-js") as () => Bidi)();

export type TextWeight = "regular" | "bold" | "italic";
type Face = "latin" | "arabic" | "devanagari";

const FONT_DIR = join(__dirname, "..", "..", "assets", "fonts");
const FILES: Record<Face, Partial<Record<TextWeight, string>>> = {
  latin: { regular: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf", italic: "NotoSans-Italic.ttf" },
  arabic: { regular: "NotoNaskhArabic-Regular.ttf", bold: "NotoNaskhArabic-Bold.ttf" },
  devanagari: { regular: "NotoSansDevanagari-Regular.ttf", bold: "NotoSansDevanagari-Bold.ttf" },
};
const SCRIPT: Record<Face, string> = { latin: "latn", arabic: "arab", devanagari: "deva" };

// The font files are read and parsed once per process; each document gets its own subset of them.
const bytesCache = new Map<string, Uint8Array>();
const parsed = new Map<Uint8Array, FontkitFont>();
const fileBytes = (file: string) => {
  let bytes = bytesCache.get(file);
  if (!bytes) { bytes = new Uint8Array(readFileSync(join(FONT_DIR, file))); bytesCache.set(file, bytes); }
  return bytes;
};
const cachingFontkit = {
  create(bytes: Uint8Array) {
    let font = parsed.get(bytes);
    if (!font) { font = fontkit.create(bytes); parsed.set(bytes, font); }
    return font;
  },
};

/** The parts of pdf-lib 1.17's subset embedder used to place pre-shaped glyphs (it only exposes drawText). */
type SubsetEmbedder = {
  font: FontkitFont;
  subset: { includeGlyph(glyph: Glyph): number };
  glyphs: Array<Pick<Glyph, "id" | "advanceWidth" | "codePoints">>;
  glyphIdMap: Map<number, number>;
  glyphCache: { invalidate(): void };
};

const ARABIC = /\p{Script=Arabic}/u, DEVANAGARI = /\p{Script=Devanagari}/u, NEUTRAL = /[\p{Script=Common}\p{Script=Inherited}]/u;
const strongFace = (char: string): Face | null => (ARABIC.test(char) ? "arabic" : DEVANAGARI.test(char) ? "devanagari" : NEUTRAL.test(char) ? null : "latin");

/** One paragraph as printable text: NFC, whitespace collapsed to single spaces, control characters dropped (ZWJ/ZWNJ kept for shaping). */
export function cleanText(value: string) {
  return value.normalize("NFC").replace(/[\t\n\r\f\v\u2028\u2029]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/ {2,}/g, " ");
}

type ShapedRun = { face: Face; glyphs: Glyph[]; positions: GlyphPosition[]; unitsPerEm: number };
/** A line ready to draw: its runs in visual order, its width, and the direction of the paragraph it came from. */
export type TextLine = { text: string; rtl: boolean; width: number; size: number; weight: TextWeight; runs: ShapedRun[] };

export class PdfText {
  private readonly fonts = new Map<string, PDFFont>();
  private readonly pageKeys = new WeakMap<PDFPage, Map<PDFFont, PDFName>>();

  private constructor() {}

  /** Registers fontkit on the document and embeds each script's font in the given weights (regular always); all are subset on save. */
  static async embed(document: PDFDocument, weights: TextWeight[] = ["regular", "bold"]): Promise<PdfText> {
    document.registerFontkit(cachingFontkit as unknown as Parameters<PDFDocument["registerFontkit"]>[0]);
    const text = new PdfText();
    for (const face of Object.keys(FILES) as Face[]) {
      for (const weight of new Set<TextWeight>(["regular", ...weights])) {
        const file = FILES[face][weight];
        if (file) text.fonts.set(`${face}:${weight}`, await document.embedFont(fileBytes(file), { subset: true }));
      }
    }
    return text;
  }

  private font(face: Face, weight: TextWeight) {
    const font = this.fonts.get(`${face}:${weight}`) ?? this.fonts.get(`${face}:regular`);
    if (!font) throw new Error(`No ${face} ${weight} font embedded.`);
    return font;
  }

  private shaper(face: Face, weight: TextWeight) {
    return (this.font(face, weight) as unknown as { embedder: SubsetEmbedder }).embedder;
  }

  /** Whether a paragraph reads right to left (its first strong character is RTL). */
  isRtl(text: string) {
    const clean = cleanText(text);
    return bidi.getEmbeddingLevels(clean).paragraphs[0]?.level === 1;
  }

  /** Which font draws each character: its script's, or for spaces, digits and punctuation the neighbouring script's. */
  private faces(chars: string[], weight: TextWeight): Array<Face | "missing"> {
    const has = (face: Face, char: string) => this.shaper(face, weight).font.hasGlyphForCodePoint(char.codePointAt(0)!);
    const strong = chars.map(strongFace);
    const before: Array<Face | null> = [], after: Array<Face | null> = [];
    for (let index = 0, last: Face | null = null; index < chars.length; index += 1) { before[index] = last; last = strong[index] ?? last; }
    for (let index = chars.length - 1, next: Face | null = null; index >= 0; index -= 1) { after[index] = next; next = strong[index] ?? next; }
    return chars.map((char, index) => {
      const candidates: Array<Face | null> = strong[index] ? [strong[index]] : [before[index], after[index], "latin", "arabic", "devanagari"];
      return candidates.find((face): face is Face => face !== null && has(face, char)) ?? "missing";
    });
  }

  /** Shapes one line for display: bidi levels, runs of one font and level, each shaped, then reordered visually (UAX #9 L2). */
  layout(text: string, size: number, weight: TextWeight = "regular", direction?: "ltr" | "rtl"): TextLine {
    const clean = cleanText(text).trim();
    const levels = bidi.getEmbeddingLevels(clean, direction);
    const rtl = (levels.paragraphs[0]?.level ?? (direction === "rtl" ? 1 : 0)) % 2 === 1;
    const chars: string[] = [];
    const charLevels: number[] = [];
    let unit = 0;
    for (const char of clean) { chars.push(char); charLevels.push(levels.levels[unit]); unit += char.length; }
    const faces = this.faces(chars, weight);

    const logical: Array<{ face: Face; level: number; text: string }> = [];
    chars.forEach((char, index) => {
      const face = faces[index] === "missing" ? "latin" : faces[index] as Face;
      const level = charLevels[index];
      const shown = faces[index] === "missing" ? "?" : level % 2 ? bidi.getMirroredCharacter(char) ?? char : char;
      const last = logical.at(-1);
      if (last && last.face === face && last.level === level) last.text += shown; else logical.push({ face, level, text: shown });
    });

    const shaped = logical.map((run) => {
      const font = this.shaper(run.face, weight).font as FontkitFont & {
        layout(text: string, features: Record<string, boolean>, script: string, language: string | undefined, direction: "ltr" | "rtl"): { glyphs: Glyph[]; positions: GlyphPosition[] };
      };
      const odd = run.level % 2 === 1;
      // Mirroring is done above from the Unicode data; the font's own rtlm would mirror the brackets back.
      const result = font.layout(run.text, odd ? { rtlm: false } : {}, SCRIPT[run.face], undefined, odd ? "rtl" : "ltr");
      return { level: run.level, run: { face: run.face, glyphs: result.glyphs, positions: result.positions, unitsPerEm: font.unitsPerEm } };
    });

    // L2: from the highest level down to the lowest odd one, reverse every sequence of runs at that level or higher.
    const order = shaped.slice();
    const highest = Math.max(0, ...order.map((item) => item.level));
    const lowestOdd = Math.min(...order.map((item) => item.level).filter((level) => level % 2 === 1), highest + 1);
    for (let level = highest; level >= lowestOdd; level -= 1) {
      for (let start = 0; start < order.length; start += 1) {
        if (order[start].level < level) continue;
        let end = start;
        while (end + 1 < order.length && order[end + 1].level >= level) end += 1;
        order.splice(start, end - start + 1, ...order.slice(start, end + 1).reverse());
        start = end;
      }
    }
    const runs = order.map((item) => item.run);
    const width = runs.reduce((sum, run) => sum + run.positions.reduce((total, position) => total + position.xAdvance, 0) * size / run.unitsPerEm, 0);
    return { text: clean, rtl, width, size, weight, runs };
  }

  /** The drawn width of one line. */
  width(text: string, size: number, weight: TextWeight = "regular") {
    return this.layout(text, size, weight).width;
  }

  /** Breaks a paragraph into lines no wider than `width` (at spaces; a word longer than the line is cut between graphemes). */
  lines(text: string, size: number, width: number, weight: TextWeight = "regular"): TextLine[] {
    const clean = cleanText(text).trim();
    const direction = this.isRtl(clean) ? "rtl" : "ltr";
    const fit = (candidate: string) => this.layout(candidate, size, weight, direction);
    const result: TextLine[] = [];
    let current: TextLine | null = null;
    for (const word of clean.split(" ").filter(Boolean)) {
      const candidate = fit(current ? `${current.text} ${word}` : word);
      if (candidate.width <= width) { current = candidate; continue; }
      if (current) result.push(current);
      current = null;
      let rest = fit(word);
      while (rest.width > width) {
        const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(rest.text), (part) => part.segment);
        if (graphemes.length < 2) break;
        let cut = graphemes.length - 1;
        while (cut > 1 && fit(graphemes.slice(0, cut).join("")).width > width) cut -= 1;
        result.push(fit(graphemes.slice(0, cut).join("")));
        rest = fit(graphemes.slice(cut).join(""));
      }
      current = rest;
    }
    if (current) result.push(current);
    return result.length ? result : [fit("")];
  }

  /**
   * Draws one line at the baseline `y`. `align: "start"` begins at `x`; `"end"` ends at `x`. With a `width`, a line from a
   * right-to-left paragraph aligns to the end of the box [x, x + width] instead of its start.
   */
  draw(page: PDFPage, line: TextLine | string, options: { x: number; y: number; size?: number; weight?: TextWeight; color?: RGB; align?: "start" | "end"; width?: number }) {
    const shaped = typeof line === "string" ? this.layout(line, options.size ?? 10, options.weight ?? "regular") : line;
    if (!shaped.runs.length) return shaped;
    const left = options.align === "end" ? options.x - shaped.width
      : options.width !== undefined && shaped.rtl ? options.x + options.width - shaped.width : options.x;
    const operators = [pushGraphicsState(), beginText(), setFillingColor(options.color ?? rgb(0, 0, 0))];
    let pen = left;
    for (const run of shaped.runs) {
      const embedder = this.shaper(run.face, shaped.weight);
      const key = this.fontKey(page, this.font(run.face, shaped.weight));
      const scale = shaped.size / run.unitsPerEm;
      operators.push(setFontAndSize(key, shaped.size));
      // Consecutive glyphs that sit where the font's own advance puts them share one show-text; others get their own position.
      let batch: string[] = [];
      let batchOpen = false;
      const flush = () => { if (batch.length) operators.push(showText(PDFHexString.of(batch.join("")))); batch = []; };
      run.glyphs.forEach((glyph, index) => {
        const position = run.positions[index];
        const placed = position.xOffset !== 0 || position.yOffset !== 0;
        if (placed || !batchOpen) {
          flush();
          operators.push(setTextMatrix(1, 0, 0, 1, pen + position.xOffset * scale, options.y + position.yOffset * scale));
        }
        batch.push(this.encode(embedder, glyph));
        // The next glyph can follow on only if this one advanced exactly by its width from where it was drawn.
        batchOpen = !placed && position.xAdvance === glyph.advanceWidth;
        pen += position.xAdvance * scale;
      });
      flush();
    }
    operators.push(endText(), popGraphicsState());
    page.pushOperators(...operators);
    return shaped;
  }

  /**
   * Draws a wrapped paragraph from `y` down; returns the baseline below its last line. A right-to-left paragraph aligns
   * to the end of its box: the column (`width`), or with `hug` its own widest line, so a field anchored at x (a header
   * line) stays where a left-to-right one would start.
   */
  paragraph(page: PDFPage, text: string, options: { x: number; y: number; width: number; size: number; weight?: TextWeight; color?: RGB; lineHeight?: number; hug?: boolean }) {
    const lineHeight = options.lineHeight ?? options.size + 4;
    const lines = this.lines(text, options.size, options.width, options.weight);
    const box = options.hug ? Math.max(...lines.map((line) => line.width)) : options.width;
    let y = options.y;
    for (const line of lines) {
      this.draw(page, line, { x: options.x, y, width: box, color: options.color });
      y -= lineHeight;
    }
    return y;
  }

  private fontKey(page: PDFPage, font: PDFFont) {
    let keys = this.pageKeys.get(page);
    if (!keys) { keys = new Map(); this.pageKeys.set(page, keys); }
    let key = keys.get(font);
    if (!key) { key = page.node.newFontDictionary(font.name, font.ref); keys.set(font, key); }
    return key;
  }

  /** The glyph's id in the document's subset, as pdf-lib's encodeText records it (for widths and the ToUnicode map). */
  private encode(embedder: SubsetEmbedder, glyph: Glyph) {
    const id = embedder.subset.includeGlyph(glyph);
    if (!embedder.glyphs[id - 1]) {
      // Marks the shaper split off (e.g. Naskh's dots) carry no characters; an empty ToUnicode entry is not valid, so map to ZWNJ.
      embedder.glyphs[id - 1] = glyph.codePoints.length ? glyph : { id: glyph.id, advanceWidth: glyph.advanceWidth, codePoints: [0x200c] };
      embedder.glyphIdMap.set(glyph.id, id);
      embedder.glyphCache.invalidate();
    }
    return id.toString(16).padStart(4, "0");
  }
}
