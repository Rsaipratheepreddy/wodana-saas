import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sourcePath = new URL("../../../docs/fixtures/palm-living-electrical-materials.json", import.meta.url);
const brandPath = new URL("../../../docs/fixtures/palm-living-brand.json", import.meta.url);

export const palmLivingElectricalFixture = JSON.parse(readFileSync(sourcePath, "utf8"));
export const palmLivingBrandFixture = JSON.parse(readFileSync(brandPath, "utf8"));

function stableUuid(key) {
  const bytes = Buffer.from(createHash("sha256").update(key).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fingerprint(row) {
  return createHash("sha256").update(JSON.stringify({
    sourceRow: row.sourceRow,
    unit: row.unit,
    modelCode: row.modelCode,
    dimensions: row.dimensions,
    color: row.color,
    itemName: row.itemName,
    price: row.price,
    quantity: row.quantity,
  })).digest("hex");
}

function normalizedCode(row) {
  const source = row.modelCode || `PALM_ELECTRICAL_${row.sourceRow}`;
  return source.toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").slice(0, 80);
}

export function palmLivingCatalogImport(catalogId) {
  assert.match(catalogId, /^[0-9a-f-]{36}$/i);
  const rows = palmLivingElectricalFixture.records;
  const nameCounts = new Map();
  for (const row of rows) nameCounts.set(row.itemName, (nameCounts.get(row.itemName) ?? 0) + 1);
  const units = {
    PCS: {
      id: stableUuid("palm-living:electrical-materials:unit:pcs"),
      catalogId, version: 0, kind: "unit", code: "PCS", name: "Piece",
      description: "Single-count unit used by the Palm Living electrical materials source.",
      market: "AE", aliases: ["PCS"], attributes: [], sizes: [], sources: [], links: [],
      specificationStatus: "workspace_verified", dimension: "count", baseFactor: 1,
    },
    BOX: {
      id: stableUuid("palm-living:electrical-materials:unit:box"),
      catalogId, version: 0, kind: "unit", code: "BOX", name: "Box",
      description: "Product-specific pack unit; pack quantity remains unset until Palm Living verifies it.",
      market: "AE", aliases: [], attributes: [], sizes: [], sources: [], links: [],
      specificationStatus: "needs_specification", dimension: "pack",
    },
  };
  const namespace = `google_sheet:${palmLivingElectricalFixture.source.spreadsheetId.toLowerCase()}:${palmLivingElectricalFixture.source.gid}`;
  const hardware = rows.map((row) => {
    const duplicate = nameCounts.get(row.itemName) > 1;
    const name = duplicate ? `${row.itemName} — ${row.color || `row ${row.sourceRow}`}` : row.itemName;
    const criteria = [row.modelCode && `Model ${row.modelCode}`, row.color && `Colour ${row.color}`, row.dimensions]
      .filter(Boolean).join(" · ");
    return {
      id: stableUuid(`palm-living:electrical-materials:row:${row.sourceRow}`),
      catalogId,
      version: 0,
      kind: "hardware",
      code: normalizedCode(row),
      name,
      description: "Imported from Palm Living's electrical materials register. Commercial and stock values require review.",
      market: "AE",
      aliases: duplicate ? [row.itemName] : [],
      attributes: [
        ...(row.modelCode ? [{ name: "Model code", value: row.modelCode }] : []),
        ...(row.color ? [{ name: "Colour", value: row.color }] : []),
      ],
      sizes: [],
      sources: [{
        title: palmLivingElectricalFixture.source.title,
        url: palmLivingElectricalFixture.source.url,
        checkedOn: palmLivingElectricalFixture.source.checkedOn,
      }],
      links: [{ relation: "unit", targetId: units[row.unit]?.id ?? units.PCS.id }],
      specificationStatus: "needs_specification",
      dimension: "none",
      configuration: {
        category: "Electrical",
        selectionCriteria: criteria || "Technical specification pending Palm Living review",
      },
      commerce: { pricingMode: "unpriced" },
      provenance: {
        namespace,
        sourceKey: `${palmLivingElectricalFixture.source.gid}/row/${row.sourceRow}`,
        sourceFingerprint: fingerprint(row),
        reviewStatus: "needs_review",
        sourceFileName: "Palm Living material register",
        sourceSheet: palmLivingElectricalFixture.source.title,
        sourceRow: row.sourceRow,
      },
    };
  });
  return { catalogId, records: [...Object.values(units), ...hardware], references: [] };
}
