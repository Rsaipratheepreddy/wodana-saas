import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bytesSource as webBytes, readWorkbook as readInBrowser } from "../../../../apps/web/lib/linked-imports/xlsx-workbook";
import { ImportFileError, parseDelimited, readImportFile, readImportImage, rowImage } from "./import-file-reader";

const fixture = (name: string) => resolve(__dirname, "../ops/fixtures", name);

describe("server-side import file reader", () => {
  it("reads a workbook exactly as the browser's Import dialog does (tabs, cells, hidden tabs, pictures)", async () => {
    for (const name of ["stock.xlsx", "catalog.xlsx"]) {
      const server = await readImportFile(fixture(name));
      const browser = (await readInBrowser(webBytes(new Uint8Array(await readFile(fixture(name)))))).filter((sheet) => sheet.rows.length);
      expect(server).toEqual(browser);
    }
    const stock = await readImportFile(fixture("stock.xlsx"));
    expect(stock.map((sheet) => [sheet.name, sheet.hidden ?? false])).toEqual([["HARDWARE INVENTORY", false], ["PAINT INVENTORY", false], ["Template", true]]);
    expect(stock[0].rows[1]).toEqual(["SERIAL NO.", "PRICE", "UNIT", "MODEL CODE", "DIMENSIONS & SIZE", "COLOR", "ITEM NAME", "QTY.", "USED QTY."]);
    expect(stock[0].rows[2].slice(0, 2)).toEqual(["1", "12.5"]);
  });

  it("finds a row's picture and reads its bytes only when it is uploaded", async () => {
    const sheets = await readImportFile(fixture("catalog.xlsx"));
    const image = rowImage(sheets, "Sofa", 4);
    expect(image).toMatchObject({ row: 3, col: 3, type: "image/png" });
    expect(rowImage(sheets, "Sofa", 5)).toBeNull();
    const bytes = await readImportImage(fixture("catalog.xlsx"), image!);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  });

  it("reads a CSV as one tab named after the file", async () => {
    const [sheet] = await readImportFile(fixture("suppliers.csv"));
    expect(sheet.name).toBe("suppliers.csv");
    expect(sheet.rows[0][1]).toBe("Company Name");
    expect(parseDelimited("﻿a,\"b, c\",\"d \"\"e\"\"\"\r\n1,2,3")).toEqual([["a", "b, c", "d \"e\""], ["1", "2", "3"]]);
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(() => parseDelimited("a,\"b")).toThrow(ImportFileError);
  });

  it("refuses files it can't import", async () => {
    await expect(readImportFile(fixture("sample-profile.json"))).rejects.toThrow("Choose an .xlsx, .csv or .tsv file");
    await expect(readImportFile(fixture("run-ops-cli.cjs").replace(".cjs", ".xlsx"))).rejects.toThrow();
  });
});
