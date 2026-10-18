/**
 * An Excel workbook (.xlsx) read in the browser for a linked import: each tab's cells as text, the cells'
 * hyperlinks, hidden tabs, and the pictures anchored to cells. The archive is read entry by entry from the
 * file (its central directory, then only the XML it needs), so a workbook full of pictures stays readable;
 * pictures are read one at a time, later, when they are uploaded. No dependency: the browser's
 * DecompressionStream inflates the entries.
 */

export type WorkbookImage = { row: number; col: number; path: string; type: string; size: number };
export type WorkbookSheet = {
  name: string; rows: string[][]; links?: Record<string, string>; hidden?: boolean;
  /** The first picture anchored in each row (by row, 0-based). */
  images?: WorkbookImage[];
};
/** Where the archive's bytes come from: a File (read in slices) or bytes in memory. */
export type ZipSource = { size: number; slice(start: number, end: number): Promise<Uint8Array> };
type Entry = { name: string; method: number; compressed: number; size: number; offset: number };
export type Zip = { source: ZipSource; entries: Map<string, Entry> };

export const WORKBOOK_LIMITS = { entries: 10_000, xml: 60_000_000, sheetXml: 40_000_000, sheets: 50, rows: 5000, columns: 100, links: 5000, images: 2000, image: 20 * 1024 * 1024 };
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export class WorkbookError extends Error {}

export const blobSource = (blob: Blob): ZipSource => ({ size: blob.size, slice: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()) });
export const bytesSource = (bytes: Uint8Array): ZipSource => ({ size: bytes.byteLength, slice: async (start, end) => bytes.subarray(start, end) });

/** The archive's entries, from its central directory. */
export async function openZip(source: ZipSource): Promise<Zip> {
  const tailStart = Math.max(0, source.size - 65_557);
  const tail = await source.slice(tailStart, source.size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let at = tail.byteLength - 22; at >= 0; at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new WorkbookError("This is not a valid Excel workbook.");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (!count || count > WORKBOOK_LIMITS.entries) throw new WorkbookError("This workbook has too many archive entries.");
  if (offset === 0xffffffff || offset + size > source.size) throw new WorkbookError("The workbook archive is damaged.");
  const directory = await source.slice(offset, offset + size);
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries = new Map<string, Entry>();
  const decoder = new TextDecoder();
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.byteLength || dir.getUint32(at, true) !== 0x02014b50) throw new WorkbookError("The workbook archive is damaged.");
    const nameLength = dir.getUint16(at + 28, true), extra = dir.getUint16(at + 30, true), comment = dir.getUint16(at + 32, true);
    const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { name, method: dir.getUint16(at + 10, true), compressed: dir.getUint32(at + 20, true), size: dir.getUint32(at + 24, true), offset: dir.getUint32(at + 42, true) });
    at += 46 + nameLength + extra + comment;
  }
  return { source, entries };
}

/** One entry's bytes, refused above `limit` (as the directory says, and as it inflates). */
export async function readEntry(zip: Zip, name: string, limit: number): Promise<Uint8Array> {
  const entry = zip.entries.get(name);
  if (!entry) throw new WorkbookError("The workbook archive is damaged.");
  if (entry.size > limit) throw new WorkbookError("The expanded workbook is too large. Remove unused sheets or export a smaller CSV.");
  const header = await zip.source.slice(entry.offset, entry.offset + 30);
  const local = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.byteLength < 30 || local.getUint32(0, true) !== 0x04034b50) throw new WorkbookError("The workbook archive is damaged.");
  const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const data = await zip.source.slice(start, start + entry.compressed);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new WorkbookError("This workbook uses a compression Wodana can't read.");
  const input = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
  const reader = input.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new WorkbookError("The expanded workbook is too large. Remove unused sheets or export a smaller CSV."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

// ---------- XML ----------

const decodeXml = (text: string) => text
  .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower === "lt") return "<"; if (lower === "gt") return ">"; if (lower === "amp") return "&"; if (lower === "quot") return "\""; if (lower === "apos") return "'";
    const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  })
  .replace(/_x([0-9a-f]{4})_/gi, (_whole, hex: string) => String.fromCharCode(parseInt(hex, 16)));
function attributes(text: string) {
  const found: Record<string, string> = {};
  for (const match of text.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) found[match[1]] = decodeXml(match[2]);
  return found;
}
const attr = (found: Record<string, string>, name: string) => found[name] ?? Object.entries(found).find(([key]) => key.endsWith(`:${name}`))?.[1];
const tag = (name: string) => `(?:[\\w-]+:)?${name}`;
/** The text of every <t> in a fragment (shared strings, inline strings), phonetic runs left out. */
const textOf = (fragment: string) => [...fragment.replace(new RegExp(`<${tag("rPh")}\\b[\\s\\S]*?</${tag("rPh")}>`, "g"), "")
  .matchAll(new RegExp(`<${tag("t")}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag("t")}>`, "g"))].map((match) => decodeXml(match[1])).join("");

/** "J4" → row 3, column 9 (0-based). */
export function cellAt(ref: string): { row: number; col: number } | null {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(ref.trim());
  if (!match) return null;
  let col = 0;
  for (const letter of match[1].toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, col: col - 1 };
}

function resolvePath(from: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
const relsPath = (path: string) => { const parts = path.split("/"); const file = parts.pop()!; return [...parts, "_rels", `${file}.rels`].join("/"); };
type Relation = { id: string; type: string; target: string; external: boolean };
function relations(xml: string): Map<string, Relation> {
  const found = new Map<string, Relation>();
  for (const match of xml.matchAll(new RegExp(`<${tag("Relationship")}\\b([^>]*)/?>`, "g"))) {
    const found_ = attributes(match[1]);
    if (found_.Id && found_.Target !== undefined) found.set(found_.Id, { id: found_.Id, type: found_.Type ?? "", target: found_.Target, external: found_.TargetMode === "External" });
  }
  return found;
}

/** Built-in date formats, and custom ones that write days, months or years. */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateCode = (code: string) => /[dmy]/i.test(code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").replace(/_.|\*./g, "")) && !/^general$/i.test(code.trim());
const isoDate = (serial: number, base1904: boolean) => {
  const days = base1904 ? serial + 1462 : serial;
  const ms = Math.round((days - 25569) * 86_400_000);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : String(serial);
};

export const httpLink = (text: string | undefined | null) => {
  const value = (text ?? "").trim();
  return value.length <= 2000 && /^https?:\/\/\S+$/i.test(value) ? value : null;
};

/** Reads every tab of a workbook (see the module note). Bounded: tabs, rows, columns, links, pictures and XML size. */
export async function readWorkbook(source: ZipSource): Promise<WorkbookSheet[]> {
  const zip = await openZip(source);
  let budget = WORKBOOK_LIMITS.xml;
  const text = async (name: string, limit = WORKBOOK_LIMITS.xml) => {
    if (!zip.entries.has(name)) return "";
    const bytes = await readEntry(zip, name, Math.min(limit, budget));
    budget -= bytes.byteLength;
    return new TextDecoder().decode(bytes);
  };
  const workbookXml = await text("xl/workbook.xml");
  if (!workbookXml) throw new WorkbookError("This is not a valid Excel workbook.");
  const workbookRels = relations(await text("xl/_rels/workbook.xml.rels"));
  const base1904 = /<(?:[\w-]+:)?workbookPr\b[^>]*date1904="(1|true)"/.test(workbookXml);
  const shared = [...(await text("xl/sharedStrings.xml")).matchAll(new RegExp(`<${tag("si")}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${tag("si")}>)`, "g"))].map((match) => textOf(match[1] ?? ""));
  const stylesXml = await text("xl/styles.xml");
  const custom = new Map([...stylesXml.matchAll(new RegExp(`<${tag("numFmt")}\\b([^>]*)/?>`, "g"))].map((match) => attributes(match[1]))
    .map((found) => [Number(found.numFmtId), found.formatCode ?? ""] as const));
  const xfsBlock = new RegExp(`<${tag("cellXfs")}\\b[^>]*>([\\s\\S]*?)</${tag("cellXfs")}>`).exec(stylesXml)?.[1] ?? "";
  const dateStyles = [...xfsBlock.matchAll(new RegExp(`<${tag("xf")}\\b([^>]*?)/?>`, "g"))].map((match) => {
    const id = Number(attributes(match[1]).numFmtId ?? 0);
    return DATE_FORMATS.has(id) || (custom.has(id) && isDateCode(custom.get(id)!));
  });

  const declared = [...workbookXml.matchAll(new RegExp(`<${tag("sheet")}\\b([^>]*)/?>`, "g"))].map((match) => attributes(match[1]));
  if (declared.length > WORKBOOK_LIMITS.sheets) throw new WorkbookError(`Use a workbook with at most ${WORKBOOK_LIMITS.sheets} worksheets.`);
  const sheets: WorkbookSheet[] = [];
  let images = 0;
  for (const found of declared) {
    const relation = workbookRels.get(attr(found, "id") ?? "");
    if (!relation || !/\/worksheet$/.test(relation.type)) continue;
    const path = resolvePath("xl/workbook.xml", relation.target);
    const xml = await text(path, WORKBOOK_LIMITS.sheetXml);
    if (!xml) continue;
    const name = found.name ?? path;
    const rels = relations(await text(relsPath(path)));

    const rows: string[][] = [];
    const links: Record<string, string> = {};
    let linkCount = 0;
    const addLink = (row: number, col: number, url: string | null) => {
      if (!url || col >= WORKBOOK_LIMITS.columns || linkCount >= WORKBOOK_LIMITS.links || links[`${row}:${col}`]) return;
      links[`${row}:${col}`] = url; linkCount += 1;
    };
    const data = new RegExp(`<${tag("sheetData")}\\b[^>]*>([\\s\\S]*?)</${tag("sheetData")}>`).exec(xml)?.[1] ?? "";
    let nextRow = 0;
    for (const rowMatch of data.matchAll(new RegExp(`<${tag("row")}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag("row")}>)`, "g"))) {
      const rowNumber = Number(attributes(rowMatch[1]).r);
      const rowIndex = Number.isInteger(rowNumber) && rowNumber > 0 ? rowNumber - 1 : nextRow;
      nextRow = rowIndex + 1;
      let nextCol = 0;
      const cells: string[] = [];
      for (const cellMatch of (rowMatch[2] ?? "").matchAll(new RegExp(`<${tag("c")}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag("c")}>)`, "g"))) {
        const found_ = attributes(cellMatch[1]);
        const col = (found_.r ? cellAt(found_.r)?.col : undefined) ?? nextCol;
        nextCol = col + 1;
        if (col >= WORKBOOK_LIMITS.columns) continue;
        const inner = cellMatch[2] ?? "";
        const raw = new RegExp(`<${tag("v")}\\b[^>]*>([\\s\\S]*?)</${tag("v")}>`).exec(inner)?.[1];
        const value = raw === undefined ? undefined : decodeXml(raw);
        let shown = "";
        switch (found_.t) {
          case "s": shown = shared[Number(value)] ?? ""; break;
          case "inlineStr": shown = textOf(new RegExp(`<${tag("is")}\\b[^>]*>([\\s\\S]*?)</${tag("is")}>`).exec(inner)?.[1] ?? ""); break;
          case "b": shown = value === undefined ? "" : value === "1" ? "true" : "false"; break;
          case "e": shown = ""; break;
          case "str": shown = value ?? ""; break;
          case "d": shown = (value ?? "").slice(0, 10); break;
          default: {
            if (value === undefined || value === "") break;
            const number = Number(value);
            shown = !Number.isFinite(number) ? value : dateStyles[Number(found_.s ?? 0)] ? isoDate(number, base1904) : String(number);
          }
        }
        cells[col] = shown;
        const formula = new RegExp(`<${tag("f")}\\b[^>]*>([\\s\\S]*?)</${tag("f")}>`).exec(inner)?.[1];
        const target = formula ? /HYPERLINK\(\s*"([^"]+)"/i.exec(decodeXml(formula))?.[1] : undefined;
        if (target) addLink(rowIndex, col, httpLink(target));
      }
      if (cells.some((cell) => cell && cell.trim())) {
        if (rowIndex >= WORKBOOK_LIMITS.rows) throw new WorkbookError(`${name}: use at most ${WORKBOOK_LIMITS.rows.toLocaleString("en")} source rows.`);
        rows[rowIndex] = Array.from(cells, (cell) => cell ?? "");
      }
    }
    for (let index = 0; index < rows.length; index++) rows[index] ??= [];

    for (const match of xml.matchAll(new RegExp(`<${tag("hyperlink")}\\b([^>]*)/?>`, "g"))) {
      const found_ = attributes(match[1]);
      const relation_ = rels.get(attr(found_, "id") ?? "");
      const url = relation_?.external ? httpLink(relation_.target) : null;
      const [from, to] = (found_.ref ?? "").split(":").map(cellAt);
      if (!from || !url) continue;
      for (let row = from.row; row <= (to?.row ?? from.row) && row < from.row + WORKBOOK_LIMITS.rows; row++)
        for (let col = from.col; col <= (to?.col ?? from.col) && col < WORKBOOK_LIMITS.columns; col++) addLink(row, col, url);
    }

    // Pictures anchored to a cell: the drawing the sheet names, each anchor's top-left cell and its image.
    const pictures: WorkbookImage[] = [];
    const drawingId = new RegExp(`<${tag("drawing")}\\b([^>]*)/?>`).exec(xml)?.[1];
    const drawingRelation = drawingId ? rels.get(attr(attributes(drawingId), "id") ?? "") : undefined;
    if (drawingRelation && images < WORKBOOK_LIMITS.images) {
      const drawingPath = resolvePath(path, drawingRelation.target);
      const drawingXml = await text(drawingPath, WORKBOOK_LIMITS.sheetXml);
      const drawingRels = relations(await text(relsPath(drawingPath)));
      const firstInRow = new Map<number, WorkbookImage>();
      for (const anchor of drawingXml.matchAll(new RegExp(`<${tag("(twoCellAnchor|oneCellAnchor)")}\\b[^>]*>([\\s\\S]*?)</${tag("(?:twoCellAnchor|oneCellAnchor)")}>`, "g"))) {
        const body = anchor[2];
        const from = new RegExp(`<${tag("from")}>([\\s\\S]*?)</${tag("from")}>`).exec(body)?.[1] ?? "";
        const row = Number(new RegExp(`<${tag("row")}>(\\d+)</${tag("row")}>`).exec(from)?.[1]);
        const col = Number(new RegExp(`<${tag("col")}>(\\d+)</${tag("col")}>`).exec(from)?.[1]);
        const embed = new RegExp(`<${tag("blip")}\\b([^>]*)/?>`).exec(body)?.[1];
        const media = embed ? drawingRels.get(attr(attributes(embed), "embed") ?? "") : undefined;
        if (!Number.isInteger(row) || !Number.isInteger(col) || !media || media.external) continue;
        const mediaPath = resolvePath(drawingPath, media.target);
        const type = IMAGE_TYPES[mediaPath.split(".").pop()?.toLowerCase() ?? ""];
        const size = zip.entries.get(mediaPath)?.size ?? 0;
        if (!type || !size || size > WORKBOOK_LIMITS.image) continue;
        const known = firstInRow.get(row);
        if (!known || col < known.col) firstInRow.set(row, { row, col, path: mediaPath, type, size });
      }
      for (const picture of [...firstInRow.values()].sort((a, b) => a.row - b.row)) {
        if (images >= WORKBOOK_LIMITS.images) break;
        pictures.push(picture); images += 1;
      }
    }

    const sheet: WorkbookSheet = { name, rows };
    if (linkCount) sheet.links = links;
    if (found.state === "hidden" || found.state === "veryHidden") sheet.hidden = true;
    if (pictures.length) sheet.images = pictures;
    sheets.push(sheet);
  }
  return sheets;
}

/** A picture of the workbook, as a file to upload. */
export async function readWorkbookImage(source: ZipSource, image: WorkbookImage, zip?: Zip): Promise<File> {
  const archive = zip ?? await openZip(source);
  const bytes = await readEntry(archive, image.path, WORKBOOK_LIMITS.image);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], image.path.split("/").pop() ?? "image", { type: image.type });
}
