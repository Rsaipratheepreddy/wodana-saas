import assert from "node:assert/strict";
import { palmLivingBrandFixture, palmLivingCatalogImport, palmLivingElectricalFixture } from "./palm-living-fixture.mjs";

const catalogId = "00000000-0000-4000-8000-000000000999";
const imported = palmLivingCatalogImport(catalogId);
const hardware = imported.records.filter((row) => row.kind === "hardware");

assert.equal(palmLivingBrandFixture.primaryColor, "#E4E3DE");
assert.equal(palmLivingBrandFixture.secondaryColor, "#000000");
assert.equal(palmLivingBrandFixture.headingFont.token, "alta");
assert.equal(palmLivingBrandFixture.bodyFont.token, "montserrat");
assert.equal(palmLivingElectricalFixture.records.length, 39);
assert.equal(hardware.length, 39);
assert.equal(imported.records.length, 41);
assert.equal(new Set(imported.records.map((row) => row.id)).size, 41);
assert.equal(new Set(imported.records.map((row) => `${row.kind}:${row.code}`)).size, 41);
assert.equal(new Set(imported.records.map((row) => `${row.kind}:${row.name.toLowerCase()}`)).size, 41);
assert(hardware.every((row) => row.commerce.pricingMode === "unpriced"));
assert(hardware.every((row) => row.provenance.reviewStatus === "needs_review"));
assert(hardware.every((row) => row.links.length === 1 && row.links[0].relation === "unit"));
assert(hardware.every((row) => row.provenance.sourceFingerprint.length === 64));
assert(palmLivingElectricalFixture.records.every((row) => row.price === null && row.quantity === null));

process.stdout.write(JSON.stringify({ ok: true, sourceRows: hardware.length, importRecords: imported.records.length }) + "\n");
