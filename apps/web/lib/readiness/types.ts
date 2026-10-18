/** Item readiness, as business-core works it out from the records (services/business-core/src/catalog-core/item-readiness.ts). */
export const READINESS_COLUMNS = ["picture", "size", "price", "drawing", "materials", "labour", "selection", "purchase", "production", "delivery"] as const;
export type ReadinessColumn = (typeof READINESS_COLUMNS)[number];
export const CATALOG_COLUMNS = ["picture", "size", "price", "drawing", "materials", "labour"] as const satisfies readonly ReadinessColumn[];
export type CatalogColumn = (typeof CATALOG_COLUMNS)[number];
export type ProjectColumn = Exclude<ReadinessColumn, "price">;

export type CellState = "done" | "missing" | "waiting" | "not_needed";
export type ReadinessCell = { state: CellState; note?: string; detail?: string };
type Cells<C extends string> = Record<C, ReadinessCell>;

export type ReadinessSettings = { columns: ReadinessColumn[]; materialAttributes: string[]; labourAttributes: string[]; version: number; saved: boolean };

export type CatalogReadinessRow = {
  id: string; catalogId: string; code: string; name: string; itemType: string; unitCode: string; categoryName: string | null;
  image: { id: string; hasPreview: boolean } | null; cells: Cells<CatalogColumn>; missing: number;
};
export type CatalogReadiness = { columns: CatalogColumn[]; rows: CatalogReadinessRow[]; settings: ReadinessSettings; canManage: boolean };

export type ProjectReadinessRow = {
  id: string; title: string; quantity: string; unit: string; areaName: string | null; catalogItemId: string | null; catalogId: string | null; code: string | null;
  catalogImageId: string | null; imageAssetId: string | null; cells: Cells<ProjectColumn>; missing: number;
};
export type ProjectReadiness = { columns: ProjectColumn[]; rows: ProjectReadinessRow[]; caseId: string };

/** The catalogue item's panel tab where each catalogue column is filled. */
export const CATALOG_TAB: Record<CatalogColumn, string> = { picture: "photos", size: "size", price: "prices", drawing: "details", materials: "components", labour: "components" };

/** The catalogue page opened on one item at one tab (the item panel opens by itself). */
export const catalogItemHref = (catalogId: string, itemId: string, column: CatalogColumn) =>
  `/workspace/catalogs?${new URLSearchParams({ catalog: catalogId, item: itemId, tab: CATALOG_TAB[column] })}`;
