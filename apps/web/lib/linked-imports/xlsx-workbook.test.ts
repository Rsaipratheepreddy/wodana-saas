// @vitest-environment node
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { bytesSource, cellAt, openZip, readEntry, readWorkbook, readWorkbookImage, WorkbookError } from "./xlsx-workbook";

/** A zip archive by hand: each entry deflated, unless named in `stored`. */
function zipOf(files: Record<string, string | Uint8Array>, stored: string[] = []) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? encoder.encode(content) : content;
    const method = stored.includes(name) ? 0 : 8;
    const data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const nameBytes = encoder.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, method, true); lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, method, true); cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local, data); centrals.push(central);
    offset += local.length + data.length;
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true); ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

const NS = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

/** A collection-shaped workbook: a title row, a heading row, a row with a linked drawing and a picture, a hidden tab. */
function collection() {
  return zipOf({
    "xl/workbook.xml": `<workbook ${NS}><workbookPr/><sheets><sheet name="Living &amp; Dining" sheetId="1" r:id="rId1"/><sheet state="hidden" name="Template" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst ${NS}><si><t>SOFA</t></si><si><t>DESCRIPTION</t></si><si><t>PRICE (AED)</t></si><si><t>Technical Drawing</t></si>
      <si><r><t>Aria Sofa </t></r><r><rPr><b/></rPr><t>– 3 seater</t></r><rPh><t>ignored</t></rPh></si><si><t>Aria Sofa-3 Seater</t></si><si><t>RENDER</t></si></sst>`,
    "xl/styles.xml": `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;AED&quot;#,##0.00"/></numFmts>
      <cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<worksheet ${NS}><sheetData>
      <row r="2"><c r="B2" t="s"><v>0</v></c></row>
      <row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>6</v></c><c r="D3" t="s"><v>2</v></c><c r="E3" t="s"><v>3</v></c><c r="F3" t="inlineStr"><is><t>Received</t></is></c></row>
      <row r="4"><c r="B4" t="s"><v>4</v></c><c r="D4" s="1"><v>23500</v></c><c r="E4" t="s"><v>5</v></c><c r="F4" s="2"><v>46301</v></c><c r="G4" t="str"><f>HYPERLINK("https://example.com/aria","Page")</f><v>Page</v></c></row>
      <row r="5"><c r="B5" t="b"><v>1</v></c><c r="CZ5"><v>9</v></c></row>
    </sheetData><hyperlinks><hyperlink ref="E4" r:id="rId1"/><hyperlink ref="B5" r:id="rId9"/></hyperlinks><drawing r:id="rId2"/></worksheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://drive.example/file/aria.pdf?a=1&amp;b=2" TargetMode="External"/>
      <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    "xl/drawings/drawing1.xml": `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor>
      <xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>3</xdr:row></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:row>4</xdr:row></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>
      <xdr:oneCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:row>3</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rId3"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor>
      <xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rId4"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor>
    </xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/render.png"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/photo.jpeg"/>
      <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/vector.emf"/></Relationships>`,
    "xl/media/logo.png": PNG, "xl/media/render.png": PNG, "xl/media/photo.jpeg": new Uint8Array([0xff, 0xd8, 0xff, 9]), "xl/media/vector.emf": new Uint8Array([1, 2]),
    "xl/worksheets/sheet2.xml": `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row></sheetData></worksheet>`,
  }, ["xl/media/logo.png"]);
}

describe("reading an Excel workbook in the browser", () => {
  it("reads each tab's cells as text, its hyperlinks, hidden tabs and the first picture of each row", async () => {
    const sheets = await readWorkbook(bytesSource(collection()));
    expect(sheets.map((sheet) => [sheet.name, sheet.hidden ?? false])).toEqual([["Living & Dining", false], ["Template", true]]);
    const [living] = sheets;
    expect(living.rows[0]).toEqual([]);
    expect(living.rows[1]).toEqual(["", "SOFA"]);
    expect(living.rows[2]).toEqual(["", "DESCRIPTION", "RENDER", "PRICE (AED)", "Technical Drawing", "Received"]);
    // A rich text cell is its runs; a number is as stored (the format is the sheet's look); a date cell is its day.
    expect(living.rows[3]).toEqual(["", "Aria Sofa – 3 seater", "", "23500", "Aria Sofa-3 Seater", "2026-10-06", "Page"]);
    // A cell past the 100th column is dropped; a boolean is true/false.
    expect(living.rows[4]).toEqual(["", "true"]);
    expect(living.links).toEqual({ "3:4": "https://drive.example/file/aria.pdf?a=1&b=2", "3:6": "https://example.com/aria" });
    expect(living.images).toEqual([
      { row: 0, col: 1, path: "xl/media/logo.png", type: "image/png", size: PNG.length },
      { row: 3, col: 2, path: "xl/media/photo.jpeg", type: "image/jpeg", size: 4 },
    ]);
    const photo = await readWorkbookImage(bytesSource(collection()), living.images![1]);
    expect(photo.type).toBe("image/jpeg");
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 9]));
    // A stored (uncompressed) entry reads as it is.
    const zip = await openZip(bytesSource(collection()));
    expect(await readEntry(zip, "xl/media/logo.png", 100)).toEqual(PNG);
  });

  it("refuses what isn't a workbook, and entries larger than their bound", async () => {
    await expect(readWorkbook(bytesSource(new TextEncoder().encode("not a zip")))).rejects.toThrow(WorkbookError);
    const zip = await openZip(bytesSource(collection()));
    await expect(readEntry(zip, "xl/sharedStrings.xml", 10)).rejects.toThrow(/too large/);
    expect(cellAt("J4")).toEqual({ row: 3, col: 9 });
    expect(cellAt("AA10")).toEqual({ row: 9, col: 26 });
    expect(cellAt("nope")).toBeNull();
  });
});
