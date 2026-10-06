import { describe, expect, it } from "vitest";
import * as web from "../../../../apps/web/lib/linked-imports/mapping";
import { readImportFile } from "./import-file-reader";
import { headingsOf, mappedColumns, overrideMapping, suggestMapping } from "./import-mapping";
import type { ImportTarget, SourceSheet } from "./linked-import-source";
import { TARGET_FIELDS } from "./linked-import-source";
import { resolve } from "node:path";

const fixture = (name: string) => resolve(__dirname, "../ops/fixtures", name);

describe("server-side import mapping", () => {
  it("offers the same fields as the Import dialog, in its order", () => {
    for (const target of ["stock", "catalog", "suppliers"] as ImportTarget[])
      expect(web.IMPORT_FIELDS[target].map((field) => field.id)).toEqual([...TARGET_FIELDS[target]]);
  });

  it("guesses the mapping and trims the file exactly as the browser does", async () => {
    const cases: Array<[ImportTarget, string]> = [["stock", "stock.xlsx"], ["catalog", "catalog.xlsx"], ["suppliers", "suppliers.csv"]];
    for (const [target, file] of cases) {
      const sheets = (await readImportFile(fixture(file))).map(({ images: _images, ...sheet }) => sheet) as SourceSheet[];
      const shown = sheets.filter((sheet) => !sheet.hidden);
      expect(headingsOf(shown)).toEqual(web.headingsOf(shown).map((entry) => entry.heading));
      const guess = suggestMapping(target, headingsOf(shown));
      expect(guess).toEqual(web.suggestMapping(target, headingsOf(shown)));
      const mapping = { ...guess, ...(shown.length > 1 ? { tabs: shown.map((sheet) => sheet.name) } : {}) };
      expect(mappedColumns(sheets, mapping)).toEqual(web.mappedColumns(sheets, mapping));
    }
  });

  it("takes an operator's overrides over the guess: a field moved to another column leaves its old one", () => {
    const guess = { REMARKS: "description", ITEM: "name", "PRICE (AED)": "price" };
    expect(overrideMapping(guess, { ITEM: "description", DESCRIPTION: "name" })).toEqual({ ITEM: "description", DESCRIPTION: "name", "PRICE (AED)": "price" });
    expect(overrideMapping(guess, { "price (aed)": "" })).toEqual({ REMARKS: "description", ITEM: "name" });
    expect(overrideMapping({ A: "attribute", B: "name" }, { C: "attribute" })).toEqual({ A: "attribute", B: "name", C: "attribute" });
  });
});
