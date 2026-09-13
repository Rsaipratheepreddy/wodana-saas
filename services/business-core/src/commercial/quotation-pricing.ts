import type { QuoteLine, QuotationMaterialRow } from './commercial.types';

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const materialAmount = (row: QuotationMaterialRow) => row.suppliedByClient ? 0 : round(row.quantity * row.rate);
export const materialsRate = (rows: QuotationMaterialRow[]) => round(rows.reduce((sum, row) => sum + materialAmount(row), 0));
export const pricedLine = (line: QuoteLine): QuoteLine => line.pricingMode === 'materials'
  ? { ...line, rate: materialsRate(line.materialRows ?? []) } : line;
