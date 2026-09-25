// Deterministic, offline mapping of the supplied workbook. This writes a review
// plan only; it never connects to a database or activates workbook INR prices.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import readXlsxFile from 'read-excel-file/node';
import { auditRoomBuilderSheets, ROOM_BUILDER_SHA256 } from './audit-room-builder.mjs';
import { roomBuilderUnit } from './room-builder-units.mjs';

const text = value => value == null ? '' : String(value).trim();
const normalized = value => text(value).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ');
const hash = value => createHash('sha256').update(value).digest('hex');
const uid = (workspaceId, key) => {
  const bytes = createHash('sha256').update(`room-builder-v2:${workspaceId}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const sheetKind = sheet => {
  if (sheet === '01_Brands') return 'brand';
  if (sheet === '02_Rooms') return 'room';
  if (sheet === '03_Furniture_Elements') return 'work';
  if (sheet === '04_Units_Conversion') return 'unit';
  if (sheet === '22_Element_Composition_BoM') return 'construction';
  if (sheet === '23_Pricing_Tiers') return 'variant';
  return 'material';
};
const baseName = (sheet, row) => {
  const name = row.representative_name || row.product_name || row.element_name || row.room_name || row.brand_name || row.unit_name;
  if (sheet === '06_Boards_Catalog') return [row.brand_name, row.product_line, row.board_type, row.thickness_mm && `${row.thickness_mm}mm`].filter(Boolean).join(' ');
  if (sheet === '07_Laminates_Catalog') return [row.brand_name, row.product_line, row.color_name, row.finish].filter(Boolean).join(' ');
  if (sheet === '08_Veneers_Catalog') return [row.brand_name, row.species, row.grain_pattern, row.color_tone].filter(Boolean).join(' ');
  if (sheet === '10_Paints_Shades') return [row.brand_name, row.product_line, row.shade_name, row.finish].filter(Boolean).join(' ');
  if (sheet === '22_Element_Composition_BoM') return [row.element_name, row.role, row.material_sub_type].filter(Boolean).join(' · ');
  if (sheet === '23_Pricing_Tiers') return [row.element_name, row.tier].filter(Boolean).join(' · ');
  return text(name);
};
const sourceRows = sheets => sheets.filter(sheet => sheet.sheet !== '00_Index').flatMap(sheet => {
  const [headers, ...rows] = sheet.data;
  return rows.map((cells, index) => ({
    sheet: sheet.sheet,
    rowNumber: index + 2,
    row: Object.fromEntries(headers.map((header, column) => [text(header), cells[column] ?? null])),
  })).filter(({row}) => Object.values(row).some(value => text(value)));
});
const sourceId = ({row}) => {
  const key = Object.keys(row).find(column => column.endsWith('_id'));
  return text(row[key]);
};
const attribute = (name, value) => ({name, value: text(value).slice(0, 1000)});

export function mapRoomBuilderSheets(sheets, workspaceId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId))
    throw new Error('Choose one explicit workspace UUID.');
  const audit = auditRoomBuilderSheets(sheets);
  if (audit.errors.length) throw new Error(`Source audit failed: ${audit.errors.join('; ')}`);
  const rows = sourceRows(sheets);
  const catalogId = uid(workspaceId, 'catalog');
  const identity = source => `${source.sheet}:${sourceId(source)}`;
  const idOf = source => uid(workspaceId, identity(source));
  const byKey = new Map(rows.map(source => [identity(source), source]));
  const names = new Map();
  for (const source of rows) {
    const name = baseName(source.sheet, source.row);
    if (!name) throw new Error(`${identity(source)} has no display name.`);
    const key = `${sheetKind(source.sheet)}:${normalized(name)}`;
    names.set(key, (names.get(key) ?? 0) + 1);
  }
  const display = source => {
    const raw = baseName(source.sheet, source.row);
    const repeated = names.get(`${sheetKind(source.sheet)}:${normalized(raw)}`) > 1;
    const suffix = repeated ? ` · ${sourceId(source)}` : '';
    return `${raw.slice(0, 180 - suffix.length)}${suffix}`;
  };
  const linked = (sheet, id) => {
    const source = byKey.get(`${sheet}:${text(id)}`);
    if (!source) throw new Error(`Missing source ${sheet}:${id}.`);
    return idOf(source);
  };
  const brandIds = new Set(rows.filter(source => source.sheet === '01_Brands').map(sourceId));
  const make = (kind, code, name, key, source, links = [], configuration) => {
    const original = source?.row;
    const attributes = original ? [
      attribute('Source worksheet', source.sheet),
      attribute('Source row', source.rowNumber),
      ...Object.entries(original).filter(([, value]) => text(value)).map(([column, value]) => attribute(column, value)),
    ] : [];
    const record = {
      id: uid(workspaceId, key), catalogId, version: 0, kind,
      code: code.toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 80),
      name, description: '', market: 'IN', aliases: [], attributes,
      sizes: [], sources: [], links, specificationStatus: 'needs_specification',
      dimension: 'none',
    };
    if (configuration) record.configuration = configuration;
    if (['work', 'variant', 'material'].includes(kind)) record.commerce = { pricingMode: 'unpriced' };
    if (source) record.provenance = {
      namespace: 'room_builder_2026_09_25', sourceKey: identity(source),
      sourceFingerprint: hash(JSON.stringify(original)), reviewStatus: 'needs_review',
      sourceFileName: 'room_builder_catalog.xlsx', sourceSheet: source.sheet, sourceRow: source.rowNumber,
    };
    return record;
  };
  const records = [];
  for (const source of rows) {
    const {sheet, row} = source;
    const kind = sheetKind(sheet);
    const id = sourceId(source);
    const links = [];
    let configuration;
    if (kind === 'work') links.push({relation: 'room', targetId: linked('02_Rooms', row.room_id)});
    if (kind === 'material' && row.brand_id && brandIds.has(text(row.brand_id)))
      links.push({relation: 'brand', targetId: linked('01_Brands', row.brand_id)});
    if (sheet === '22_Element_Composition_BoM') {
      links.push({relation: 'parent', targetId: uid(workspaceId, `template:${row.element_id}`)});
      links.push({relation: 'work', targetId: linked('03_Furniture_Elements', row.element_id)});
      configuration = {recordRole: 'component', componentType: text(row.role).slice(0, 160), required: row.is_optional ? 'optional' : 'required'};
    }
    if (sheet === '23_Pricing_Tiers') {
      links.push({relation: 'work', targetId: linked('03_Furniture_Elements', row.element_id)});
      configuration = {specificationTier: text(row.tier).slice(0, 160)};
    }
    const record = make(kind, id, display(source), identity(source), source, links, configuration);
    if (kind === 'unit') Object.assign(record, roomBuilderUnit(row));
    records.push(record);
  }
  for (const source of rows.filter(source => source.sheet === '03_Furniture_Elements')) {
    const ownerId = idOf(source);
    records.push(make('construction', `TPL_${sourceId(source)}`, `${display(source)} materials`.slice(0, 180),
      `template:${sourceId(source)}`, null, [{relation: 'work', targetId: ownerId}], {recordRole: 'template'}));
  }
  const ids = new Set(records.map(record => record.id));
  if (ids.size !== records.length || records.some(record => record.links.some(link => !ids.has(link.targetId))))
    throw new Error('Mapping contains a duplicate ID or an unresolved link.');
  const unique = new Set();
  for (const record of records) {
    if (record.attributes.length > 30 || record.name.length > 180) throw new Error(`Record exceeds catalog limits: ${record.code}.`);
    for (const key of [`code:${record.kind}:${record.code}`, `name:${record.kind}:${normalized(record.name)}`]) {
      if (unique.has(key)) throw new Error(`Duplicate mapped ${key}.`);
      unique.add(key);
    }
  }
  return {
    workspaceId, catalogId, name: 'Room Builder',
    report: {sourceFileName: 'room_builder_catalog.xlsx', sourceSha256: ROOM_BUILDER_SHA256, sourceRows: rows.length, accountedRows: rows.length,
      generatedTemplates: 243, records: records.length, missingBrandLinks: audit.missing.brandReferences.reduce((sum, gap) => sum + gap.rows, 0),
      workbookPricesActivated: false, errors: []},
    records,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [sourcePath, workspaceId, outputPath] = process.argv.slice(2);
  if (!sourcePath || !workspaceId || !outputPath) throw new Error('Usage: node map-room-builder.mjs workbook.xlsx workspace-uuid output.json');
  const sha256 = hash(await readFile(sourcePath));
  if (sha256 !== ROOM_BUILDER_SHA256) throw new Error('Workbook hash differs from the reviewed source.');
  const plan = mapRoomBuilderSheets(await readXlsxFile(sourcePath), workspaceId);
  await writeFile(outputPath, JSON.stringify(plan));
  console.log(JSON.stringify({...plan.report, catalogId: plan.catalogId, planPath: outputPath}));
}
