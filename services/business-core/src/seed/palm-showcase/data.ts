import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The tenant's documents the seed loads: fixtures under docs/ and the prepared Core Collection artifact. */
export type SeedData = {
  dataDir: string;
  showcase: ShowcaseFixture;
  teams: TeamsFixture;
  workflow: WorkflowFixture;
  design: DesignFixture;
  suppliers: SuppliersFixture;
  proposalKit: Record<string, unknown>;
  collection: { manifest: CollectionManifest; dir: string } | null;
};

export type Person = { email: string; displayName: string; roleCodes: string[]; team: string };
export type ShowcaseFixture = {
  tenant: {
    externalTenantId: string; name: string; region: { code: string; version: number }; firmKit: { code: string; version: number }; plan: { code: string; version: number };
    seatLimit: number; unitSystem: string; weekStartsOn: number;
    legalEntity: { code: string; displayName: string; registeredName: string; countryCode: string; baseCurrency: string; locale: string; timezone: string };
    account: { displayName: string; contactName: string };
  };
  owner: { email: string; displayName: string };
  people: Person[];
  businessUnits: Array<{ code: string; name: string; type: string; teams: string[] }>;
  tax: { pricesIncludeTax: boolean; rates: Array<{ code: string; label: string; rate: string; isDefault: boolean }> };
  quotation: { validityDays: number; internalReview: boolean };
  showcase: Showcase;
};
export type Showcase = {
  client: { displayName: string; email: string; mobile: string; demoCode: string; title: string; summary: string; emirate: string; area: string; opportunityAmount: number; targetDate: string; promiseDate: string };
  rooms: string[];
  requirements: Array<{ key: string; room: string; title: string; note: string; category: string; priority: string; quantity: number; unit: string; catalogRecordName?: string }>;
  inspiration: Array<{ key: string; title: string; catalogRecordName: string; sentiment: "love" | "avoid" }>;
  siteVisit: { location: string; access: string; outcome: string; durationMinutes: number };
  measurement: { requirement: string; title: string; dimensions: Array<{ name: string; unit: string; measured: number }> };
  design: { title: string; documentType: string; catalogRecordName: string };
  quote: {
    lines: Array<{ key: string; room: string; title: string; description: string; quantity: string; unit: string; unitCost: string; rate: string; catalogRecordName?: string; requirement: string; supply?: string; optional?: boolean }>;
    paymentTerms: Array<{ title: string; percent: number; trigger: string; requiredForRelease: boolean; requiredForProduction: boolean }>;
    agreementReference: string;
    commissionLines: Array<{ recipientName: string; type: string; basis: string; value: number }>;
  };
  materials: Array<{ name: string; code: string; specification: string; quantity: string; unit: string; line: string }>;
  purchasing: { supplierName: string; material: string; orderQuantity: string; unitPrice: string; expectedDate: string; sendTo: string; supplierReference: string; promisedDate: string; deliveryNote: string };
  factory: { workcenter: string; line: string; drawingReference: string; plannedStart: string; plannedEnd: string };
  site: { startedOn: string; reportDate: string; workforce: Array<{ trade: string; people: number }>; installedLine: string; installed: string; photoLabel: string };
  snag: { title: string; severity: string; source: string; room: string };
  handover: { title: string; document: { kind: string; title: string } };
};
export type TeamsFixture = { teams: Array<{ code: string; name: string; scope: string; permissions: string[] }> };
export type WorkflowFixture = { code: string; name: string; description: string; isDefault: boolean; stages: unknown[] };
export type DesignFixture = { minimumDeposit: { amount: string; currency: string }; packages: Array<Record<string, unknown> & { code: string }> };
export type SuppliersFixture = { suppliers: Array<{ name: string; categories: string[]; locality: string | null; approval: "approved" | "pending"; approvalNote: string; paymentTerms: string; advancePercent?: string; creditDays?: number; termsNote: string; deal: string; dealNote: string; email: string | null; notes: string }> };
export type CollectionManifest = {
  schemaVersion: number; source: { itemRows: number; sha256: string }; catalog: { id: string; name: string; description: string };
  records: Array<Record<string, unknown> & { id: string; kind: string; name: string; catalogId: string; version: number; links?: Array<{ relation: string; targetId: string }> }>;
  assets: Array<{ recordId: string; assetId: string; role: string; altText: string; sortOrder: number; path: string; sha256: string; byteSize: number }>;
};

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`Missing seed data file: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** docs/ next to the repository, or wherever SEED_DATA_DIR points (in the image: a mounted copy of docs/). */
export function defaultDataDir() {
  const candidates = [process.env.SEED_DATA_DIR, resolve(__dirname, "../../../../../docs"), resolve(__dirname, "../../../../docs"), "/workspace/docs"].filter(Boolean) as string[];
  return candidates.find((dir) => existsSync(resolve(dir, "fixtures/palm-showcase.json"))) ?? candidates[0];
}

export type Phase = "bootstrap" | "all";

/** The bootstrap phase needs only the workspace and team fixtures; the full run needs every document. */
export function loadSeedData(phase: Phase = "all"): SeedData {
  const dataDir = defaultDataDir();
  const collectionDir = process.env.SEED_CORE_COLLECTION_DIR ?? "";
  const manifestPath = collectionDir ? resolve(collectionDir, "manifest.json") : "";
  const full = phase === "all";
  return {
    dataDir,
    showcase: readJson<ShowcaseFixture>(resolve(dataDir, "fixtures/palm-showcase.json")),
    teams: readJson<TeamsFixture>(resolve(dataDir, "fixtures/palm-teams-access.json")),
    workflow: full ? readJson<WorkflowFixture>(resolve(dataDir, "fixtures/palm-project-workflow.json")) : { code: "", name: "", description: "", isDefault: true, stages: [] },
    design: full ? readJson<DesignFixture>(resolve(dataDir, "fixtures/palm-design-packages.json")) : { minimumDeposit: { amount: "0", currency: "" }, packages: [] },
    suppliers: full ? readJson<SuppliersFixture>(resolve(dataDir, "fixtures/palm-suppliers.json")) : { suppliers: [] },
    proposalKit: full ? readJson<Record<string, unknown>>(resolve(dataDir, "projects/palm-living/proposal-kit.json")) : {},
    collection: full && manifestPath && existsSync(manifestPath) ? { manifest: readJson<CollectionManifest>(manifestPath), dir: collectionDir } : null,
  };
}
