import { describe, expect, it } from 'vitest';
import readWorkbook from 'read-excel-file/node';
import { prepareCatalogImport, suggestImportMapping } from './catalog-import';
import type { CatalogKind } from './catalog';

describe('catalog sample workbook', () => {
  it('maps every sample worksheet into a valid import plan', async () => {
    const sheets = await readWorkbook('public/templates/catalog-sample.xlsx');
    const kinds: Record<string, CatalogKind> = { Rooms: 'room', Items: 'work', Materials: 'sku', Brands: 'brand', Units: 'unit' };
    expect(sheets.map(sheet => sheet.sheet)).toEqual(Object.keys(kinds));
    for (const sheet of sheets) {
      const rows = sheet.data.map(row => row.map(value => String(value ?? '')));
      const kind = kinds[sheet.sheet];
      const plan = prepareCatalogImport({ name: sheet.sheet, rows }, 0, suggestImportMapping(rows[0], kind), [], { catalogId: 'catalog', kind, groupId: '', createReferences: false, priceDefaults: {} });
      expect(plan.errors, sheet.sheet).toEqual([]);
      expect(plan.records, sheet.sheet).toHaveLength(1);
    }
  });
});
