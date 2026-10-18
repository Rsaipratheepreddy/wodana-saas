// Read-only audit of the supplied Room Builder workbook. This script never imports records.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import readXlsxFile from 'read-excel-file/node';
import { roomBuilderUnit, roomBuilderUnits } from './room-builder-units.mjs';

export const ROOM_BUILDER_SHA256 = '90ff51b53f46e41ada1aa81262224d868d0415427eb8d9ef51e1f8c5a43a9588';
const expectedSheets = [
  '00_Index', '01_Brands', '02_Rooms', '03_Furniture_Elements',
  '04_Units_Conversion', '05_Materials_Master', '06_Boards_Catalog',
  '07_Laminates_Catalog', '08_Veneers_Catalog', '09_Hardware_Catalog',
  '10_Paints_Shades', '11_Tiles_Catalog', '12_Sanitaryware',
  '13_Lighting_Catalog', '14_Appliances_Kitchen', '15_Fabric_Furnishing',
  '16_False_Ceiling', '17_Flooring_Alternate', '18_Modular_Accessories',
  '19_Plumbing_Pipes', '20_Electrical_Items', '21_Adhesives_Consumables',
  '22_Element_Composition_BoM', '23_Pricing_Tiers',
];
const text = value => value == null ? '' : String(value).trim();
const key = value => text(value).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ');

export function auditRoomBuilderSheets(sheets) {
  const errors = [];
  const actualSheets = sheets.map(sheet => sheet.sheet);
  if (JSON.stringify(actualSheets) !== JSON.stringify(expectedSheets)) errors.push('Worksheet names or order differ from the supplied source.');
  const data = new Map();
  const counts = {};
  const repeatedNames = {};
  const priceColumns = {};
  let totalRows = 0;

  for (const sheet of sheets.filter(sheet => sheet.sheet !== '00_Index')) {
    const [header = [], ...body] = sheet.data;
    const headings = header.map(text);
    const rows = body.filter(row => row.some(cell => text(cell)));
    const idColumn = headings.findIndex(name => name.endsWith('_id'));
    if (idColumn < 0) errors.push(`${sheet.sheet}: no source ID column.`);
    const seenIds = new Set();
    const records = rows.map((cells, index) => {
      const sourceId = text(cells[idColumn]);
      if (!sourceId || seenIds.has(sourceId)) errors.push(`${sheet.sheet}:${index + 2}: missing or repeated source ID.`);
      seenIds.add(sourceId);
      return Object.fromEntries(headings.map((name, column) => [name, cells[column] ?? null]));
    });
    const nameColumn = !['22_Element_Composition_BoM', '23_Pricing_Tiers'].includes(sheet.sheet)
      ? ['element_name', 'representative_name', 'product_name'].find(name => headings.includes(name))
      : undefined;
    if (nameColumn) {
      const frequencies = new Map();
      for (const record of records) frequencies.set(key(record[nameColumn]), (frequencies.get(key(record[nameColumn])) ?? 0) + 1);
      repeatedNames[sheet.sheet] = [...frequencies.values()].filter(value => value > 1).length;
    }
    const prices = headings.filter(name => /price|cost|rate|amount|currency/i.test(name));
    if (prices.length) priceColumns[sheet.sheet] = prices;
    data.set(sheet.sheet, records);
    counts[sheet.sheet] = records.length;
    totalRows += records.length;
  }
  if (totalRows !== 7392) errors.push(`Expected 7,392 source rows; found ${totalRows}.`);

  const ids = (sheet, field) => new Set((data.get(sheet) ?? []).map(row => text(row[field])));
  const roomIds = ids('02_Rooms', 'room_id');
  const elementIds = ids('03_Furniture_Elements', 'element_id');
  const brands = data.get('01_Brands') ?? [];
  const brandIds = ids('01_Brands', 'brand_id');
  const brandNames = new Set(brands.map(row => key(row.brand_name)));
  const unitTypes = {};
  for (const row of data.get('04_Units_Conversion') ?? []) {
    try {
      const { dimension } = roomBuilderUnit(row);
      unitTypes[dimension] = (unitTypes[dimension] ?? 0) + 1;
    } catch (error) { errors.push(error.message); }
  }
  for (const id of Object.keys(roomBuilderUnits)) if (!ids('04_Units_Conversion', 'unit_id').has(id)) errors.push(`Reviewed unit ${id} is absent from the source workbook.`);
  const missing = {
    elementRooms: (data.get('03_Furniture_Elements') ?? []).filter(row => !roomIds.has(text(row.room_id))).length,
    bomElements: (data.get('22_Element_Composition_BoM') ?? []).filter(row => !elementIds.has(text(row.element_id))).length,
    tierElements: (data.get('23_Pricing_Tiers') ?? []).filter(row => !elementIds.has(text(row.element_id))).length,
    brandReferences: [],
  };
  const brandGaps = new Map();
  for (const [sheet, rows] of data) {
    for (const row of rows) {
      if (!row.brand_id || brandIds.has(text(row.brand_id))) continue;
      const code = text(row.brand_id), name = text(row.brand_name);
      const id = `${code}:${name}`;
      const gap = brandGaps.get(id) ?? { sheet, code, name, rows: 0, nameMatchesMaster: brandNames.has(key(name)) };
      gap.rows++;
      brandGaps.set(id, gap);
    }
  }
  missing.brandReferences = [...brandGaps.values()];
  for (const [type, count] of Object.entries(missing)) if (type !== 'brandReferences' && count) errors.push(`${count} missing ${type} links.`);
  return { totalRows, counts, unitTypes, repeatedNames, priceColumns, missing, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error('Usage: node audit-room-builder.mjs /absolute/path/room_builder_catalog.xlsx');
  const bytes = await readFile(sourcePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const report = auditRoomBuilderSheets(await readXlsxFile(sourcePath));
  if (sha256 !== ROOM_BUILDER_SHA256) report.errors.push('Workbook SHA-256 differs from the supplied source.');
  console.log(JSON.stringify({ sha256, ...report }, null, 2));
  if (report.errors.length) process.exitCode = 1;
}
