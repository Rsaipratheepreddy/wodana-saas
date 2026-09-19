export type CatalogVisibleRecord = {
  kind: string;
  attributes?: { name: string; value: string }[];
  configuration?: Record<string, unknown>;
};

const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase();

export function isRestrictedCostRecord(record: CatalogVisibleRecord) {
  if (record.kind !== "rate_card") return false;
  return normalized(record.configuration?.priceType) !== "selling";
}

function isRestrictedSourceAmount(name: string) {
  const key = normalized(name).replace(/\s+/g, "_");
  if (key.startsWith("selling_")) return false;
  return /(?:^|_)(?:purchase|base|estimated)?_?cost(?:_|$)|(?:^|_)purchase_price(?:_|$)|(?:^|_)price(?:_|$)/.test(key);
}

/**
 * The general catalogue permission exposes specifications and selling prices.
 * Supplier/internal cost evidence is visible only with supplier_offers.view.
 */
export function catalogRecordsForViewer<T extends CatalogVisibleRecord>(records: T[], canViewCosts: boolean): T[] {
  if (canViewCosts) return records;
  return records
    .filter((record) => !isRestrictedCostRecord(record))
    .map((record) => record.attributes?.some((attribute) => isRestrictedSourceAmount(attribute.name))
      ? { ...record, attributes: record.attributes.filter((attribute) => !isRestrictedSourceAmount(attribute.name)) }
      : record) as T[];
}
