import { open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import type { SourceSheet } from "./linked-import-source";

/**
 * A spreadsheet file read on the server, exactly as the browser reads one for a linked import
 * (apps/web/lib/linked-imports/import-file.ts and xlsx-workbook.ts): each tab's cells as text, the cells'
 * hyperlinks, hidden tabs and the pictures anchored to cells. A CSV is one tab named after the file. The archive is
 * read entry by entry from the file, so a workbook full of pictures stays readable; a picture is read only when it
 * is uploaded (readImportImage). Used by the operator CLI;
 * `import-file-reader.spec.ts` keeps it in step with the browser's reader.
 */

export const FILE_LIMITS = { delimited: 2_000_000, workbook: 512 * 1024 * 1024 };
export const WORKBOOK_LIMITS = { entries: 10_000, xml: 60_000_000, sheetXml: 40_000_000, sheets: 50, rows: 5000, columns: 100, links: 5000, images: 2000, image: 20 * 1024 * 1024 };
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** A picture anchored in a sheet (its top-left cell, 0-based) and where it is in the archive. */
export type WorkbookImage = { row: number; col: number; path: string; type: string; size: number };
/** A tab as read from a file: what the import reads, plus the first picture anchored in each row. */
export type FileSheet = SourceSheet & { images?: WorkbookImage[] };

export class ImportFileError extends Error {}

/** Where the archive's bytes come from: a file (read in slices) or bytes in memory. */
export type ZipSource = { size: number; slice(start: number, end: number): Promise<Uint8Array> };
type Entry = { name: string; method: number; compressed: number; size: number; offset: number };
type Zip = { source: ZipSource; entries: Map<string, Entry> };

export const bytesSource = (bytes: Uint8Array): ZipSource => ({ size: bytes.byteLength, slice: async (start, end) => bytes.subarray(start, end) });

/** A file as an import reads it (see the module note). */
export async function readImportFile(path: string): Promise<FileSheet[]> {
  const name = path.split(/[\\/]/).pop() ?? path;
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (/\.(csv|tsv|txt)$/i.test(name)) {
      if (size > FILE_LIMITS.delimited) throw new ImportFileError("Use a CSV file smaller than 2 MB.");
      return [{ name, rows: parseDelimited((await handle.readFile()).toString("utf8")) }];
    }
    if (!/\.xlsx$/i.test(name)) throw new ImportFileError("Choose an .xlsx, .csv or .tsv file. Save older .xls files as .xlsx first.");
    if (size > FILE_LIMITS.workbook) throw new ImportFileError("Use a workbook smaller than 512 MB.");
    return (await readWorkbook(fileSource(handle, size))).filter((sheet) => sheet.rows.length);
  } finally {
    await handle.close();
  }
}

type Handle = Awaited<ReturnType<typeof open>>;
const fileSource = (handle: Handle, size: number): ZipSource => ({
  size,
  slice: async (start, end) => {
    const buffer = Buffer.alloc(Math.max(0, end - start));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, start);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
  },
});

/** The picture anchored in a sheet row (a row number as the sheet shows it), if the file has one. */
export function rowImage(sheets: FileSheet[], sheet: string, line: number): WorkbookImage | null {
  const tidy = (name: string) => name.replace(/\s+/g, " ").trim();
  return sheets.find((entry) => tidy(entry.name) === tidy(sheet))?.images?.find((image) => image.row === line - 1) ?? null;
}

/** One picture's bytes, read from the workbook when it is uploaded. */
export async function readImportImage(path: string, image: WorkbookImage): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const zip = await openZip(fileSource(handle, size));
    return Buffer.from(await readEntry(zip, image.path, WORKBOOK_LIMITS.image));
  } finally {
    await handle.close();
  }
}

/** A CSV or tab-separated text, as the browser's catalogue import parses it. */
export function parseDelimited(text: string): string[][] {
  const input = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (input.length > 2_000_000) throw new ImportFileError("Use a file or paste smaller than 2 MB.");
  const delimiter = input.split("\n")[0].includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === "\"" && (quoted || !cell)) {
      if (quoted && input[index + 1] === "\"") { cell += "\""; index++; } else quoted = !quoted;
    } else if (!quoted && (char === delimiter || char === "\n")) {
      row.push(cell); cell = "";
      if (char === "\n") { rows.push(row); row = []; }
    } else cell += char;
    if (rows.length > 5000 || row.length > 100 || cell.length > 10000) throw new ImportFileError("Use at most 5,000 source rows, 100 columns and 10,000 characters per cell.");
  }
  if (quoted) throw new ImportFileError("A quoted cell is unfinished. Check the CSV or paste again.");
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

// ---------- archive ----------

async function openZip(source: ZipSource): Promise<Zip> {
  const tailStart = Math.max(0, source.size - 65_557);
  const tail = await source.slice(tailStart, source.size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let at = tail.byteLength - 22; at >= 0; at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new ImportFileError("This is not a valid Excel workbook.");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (!count || count > WORKBOOK_LIMITS.entries) throw new ImportFileError("This workbook has too many archive entries.");
  if (offset === 0xffffffff || offset + size > source.size) throw new ImportFileError("The workbook archive is damaged.");
  const directory = await source.slice(offset, offset + size);
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries = new Map<string, Entry>();
  const decoder = new TextDecoder();
  let at = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.byteLength || dir.getUint32(at, true) !== 0x02014b50) throw new ImportFileError("The workbook archive is damaged.");
    const nameLength = dir.getUint16(at + 28, true), extra = dir.getUint16(at + 30, true), comment = dir.getUint16(at + 32, true);
    const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { name, method: dir.getUint16(at + 10, true), compressed: dir.getUint32(at + 20, true), size: dir.getUint32(at + 24, true), offset: dir.getUint32(at + 42, true) });
    at += 46 + nameLength + extra + comment;
  }
  return { source, entries };
}

async function readEntry(zip: Zip, name: string, limit: number): Promise<Uint8Array> {
  const entry = zip.entries.get(name);
  if (!entry) throw new ImportFileError("The workbook archive is damaged.");
  const tooLarge = "The expanded workbook is too large. Remove unused sheets or export a smaller CSV.";
  if (entry.size > limit) throw new ImportFileError(tooLarge);
  const header = await zip.source.slice(entry.offset, entry.offset + 30);
  const local = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.byteLength < 30 || local.getUint32(0, true) !== 0x04034b50) throw new ImportFileError("The workbook archive is damaged.");
  const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const data = await zip.source.slice(start, start + entry.compressed);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new ImportFileError("This workbook uses a compression Wodana can't read.");
  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(1, limit) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|buffer/i.test((error as Error).message)) throw new ImportFileError(tooLarge);
    throw new ImportFileError("The workbook archive is damaged.");
  }
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
    const values = attributes(match[1]);
    if (values.Id && values.Target !== undefined) found.set(values.Id, { id: values.Id, type: values.Type ?? "", target: values.Target, external: values.TargetMode === "External" });
  }
  return found;
}

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateCode = (code: string) => /[dmy]/i.test(code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").replace(/_.|\*./g, "")) && !/^general$/i.test(code.trim());
const isoDate = (serial: number, base1904: boolean) => {
  const days = base1904 ? serial + 1462 : serial;
  const ms = Math.round((days - 25569) * 86_400_000);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : String(serial);
};
const httpLink = (text: string | undefined | null) => {
  const value = (text ?? "").trim();
  return value.length <= 2000 && /^https?:\/\/\S+$/i.test(value) ? value : null;
};

/** Reads every tab of a workbook. Bounded: tabs, rows, columns, links and XML size. */
export async function readWorkbook(source: ZipSource): Promise<FileSheet[]> {
  const zip = await openZip(source);
  let budget = WORKBOOK_LIMITS.xml;
  const text = async (name: string, limit = WORKBOOK_LIMITS.xml) => {
    if (!zip.entries.has(name)) return "";
    const bytes = await readEntry(zip, name, Math.min(limit, budget));
    budget -= bytes.byteLength;
    return new TextDecoder().decode(bytes);
  };
  const workbookXml = await text("xl/workbook.xml");
  if (!workbookXml) throw new ImportFileError("This is not a valid Excel workbook.");
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
  if (declared.length > WORKBOOK_LIMITS.sheets) throw new ImportFileError(`Use a workbook with at most ${WORKBOOK_LIMITS.sheets} worksheets.`);
  const sheets: FileSheet[] = [];
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
        const values = attributes(cellMatch[1]);
        const col = (values.r ? cellAt(values.r)?.col : undefined) ?? nextCol;
        nextCol = col + 1;
        if (col >= WORKBOOK_LIMITS.columns) continue;
        const inner = cellMatch[2] ?? "";
        const raw = new RegExp(`<${tag("v")}\\b[^>]*>([\\s\\S]*?)</${tag("v")}>`).exec(inner)?.[1];
        const value = raw === undefined ? undefined : decodeXml(raw);
        let shown = "";
        switch (values.t) {
          case "s": shown = shared[Number(value)] ?? ""; break;
          case "inlineStr": shown = textOf(new RegExp(`<${tag("is")}\\b[^>]*>([\\s\\S]*?)</${tag("is")}>`).exec(inner)?.[1] ?? ""); break;
          case "b": shown = value === undefined ? "" : value === "1" ? "true" : "false"; break;
          case "e": shown = ""; break;
          case "str": shown = value ?? ""; break;
          case "d": shown = (value ?? "").slice(0, 10); break;
          default: {
            if (value === undefined || value === "") break;
            const number = Number(value);
            shown = !Number.isFinite(number) ? value : dateStyles[Number(values.s ?? 0)] ? isoDate(number, base1904) : String(number);
          }
        }
        cells[col] = shown;
        const formula = new RegExp(`<${tag("f")}\\b[^>]*>([\\s\\S]*?)</${tag("f")}>`).exec(inner)?.[1];
        const target = formula ? /HYPERLINK\(\s*"([^"]+)"/i.exec(decodeXml(formula))?.[1] : undefined;
        if (target) addLink(rowIndex, col, httpLink(target));
      }
      if (cells.some((cell) => cell && cell.trim())) {
        if (rowIndex >= WORKBOOK_LIMITS.rows) throw new ImportFileError(`${name}: use at most ${WORKBOOK_LIMITS.rows.toLocaleString("en")} source rows.`);
        rows[rowIndex] = Array.from(cells, (cell) => cell ?? "");
      }
    }
    for (let index = 0; index < rows.length; index++) rows[index] ??= [];

    for (const match of xml.matchAll(new RegExp(`<${tag("hyperlink")}\\b([^>]*)/?>`, "g"))) {
      const values = attributes(match[1]);
      const target = rels.get(attr(values, "id") ?? "");
      const url = target?.external ? httpLink(target.target) : null;
      const [from, to] = (values.ref ?? "").split(":").map(cellAt);
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

    const sheet: FileSheet = { name, rows };
    if (linkCount) sheet.links = links;
    if (found.state === "hidden" || found.state === "veryHidden") sheet.hidden = true;
    if (pictures.length) sheet.images = pictures;
    sheets.push(sheet);
  }
  return sheets;
}
