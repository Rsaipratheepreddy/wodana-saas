import { parseDelimitedCatalog } from "@/lib/workspace/catalog-import";
import { blobSource, readWorkbook, readWorkbookImage, type WorkbookImage, type WorkbookSheet } from "./xlsx-workbook";

/** A CSV is read whole; a workbook is read entry by entry (its pictures only when they're uploaded), so it may be large. */
export const FILE_LIMITS = { delimited: 2_000_000, workbook: 512 * 1024 * 1024 };

/** A spreadsheet file for a linked import: its tabs as text, with cell links, hidden tabs and anchored pictures (Excel). */
export async function readImportFile(file: File): Promise<WorkbookSheet[]> {
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    if (file.size > FILE_LIMITS.delimited) throw new Error("Use a CSV file smaller than 2 MB.");
    return [{ name: file.name, rows: parseDelimitedCatalog(await file.text()) }];
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose an .xlsx, .csv or .tsv file. Save older .xls files as .xlsx first.");
  if (file.size > FILE_LIMITS.workbook) throw new Error("Use a workbook smaller than 512 MB.");
  return (await readWorkbook(blobSource(file))).filter((sheet) => sheet.rows.length);
}

/** The picture anchored in a sheet row (a row number as the sheet shows it), if the file has one. */
export function rowImage(sheets: WorkbookSheet[], sheet: string, line: number): WorkbookImage | null {
  const tidy = (name: string) => name.replace(/\s+/g, " ").trim();
  return sheets.find((entry) => tidy(entry.name) === tidy(sheet))?.images?.find((image) => image.row === line - 1) ?? null;
}

export const readImportImage = (file: File, image: WorkbookImage) => readWorkbookImage(blobSource(file), image);
