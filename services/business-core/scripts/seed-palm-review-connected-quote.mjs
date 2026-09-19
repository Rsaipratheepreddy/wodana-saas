import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "Set DATABASE_URL to the local Palm review database.");
const target = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(target.hostname), "Palm review seed is local-only.");
assert(target.pathname.includes("palm_review"), "Use a dedicated palm_review database.");

const ids = {
  case: "d1000000-0000-4000-8000-000000000007",
  project: "d1000000-0000-4000-8000-000000000008",
  quote: "c768dd88-8f05-4bc5-88df-3c19ac5a2966",
  baseline: "d1000000-0000-4000-8000-000000000121",
  baselineRequest: "d1000000-0000-4000-8000-000000000123",
  decision: "d1000000-0000-4000-8000-000000000122",
  decisionRequest: "d1000000-0000-4000-8000-000000000124",
  rooms: {
    bedrooms: "d1000000-0000-4000-8000-000000000101",
    dining: "d1000000-0000-4000-8000-000000000102",
    living: "d1000000-0000-4000-8000-000000000103",
    wholeVilla: "d1000000-0000-4000-8000-000000000104",
  },
  entries: {
    bedroom: "d1000000-0000-4000-8000-000000000111",
    dining: "d1000000-0000-4000-8000-000000000112",
    living: "d1000000-0000-4000-8000-000000000113",
    installation: "d1000000-0000-4000-8000-000000000114",
  },
};

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}
const canonicalHash = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const imageData = (name) => {
  const path = resolve(process.cwd(), "tmp/pdfs/proposal-0744/extracted", name);
  return existsSync(path) ? `data:image/png;base64,${readFileSync(path).toString("base64")}` : undefined;
};

const brief = {
  goals: "Deliver a calm, durable and fully coordinated villa interior ready for handover.",
  propertyType: "Residential villa",
  location: "Jumeirah Garden Villa, Dubai",
  area: "Dining, living and bedroom joinery",
  budget: "Approved investment",
  budgetAmount: "385000",
  currencyCode: "AED",
  timeline: "Handover by 12 October 2026",
  decisionMakers: "Aisha Al Mansoori",
  people: "Family residence",
  preferences: "Warm neutrals, natural veneer, Taj Mahal stone and discreet integrated lighting.",
  retainedItems: "Client artwork and loose accessories",
  exclusions: "Authority fees and loose electronics unless listed in the quotation.",
  constraints: "Coordinate installation access, protected storage and final veneer batch approval.",
};

const specifications = {
  bedroom: {
    refinedRequirement: "Three bedroom wardrobe and vanity packages with client-approved internal accessories.",
    construction: "Moisture-resistant plywood carcasses with laminate interiors and natural veneer feature faces.",
    inclusions: "Wardrobes, vanity units, internal accessories and final installation.",
    exclusions: "Loose furniture and client electronics.",
    assumptions: "Final site measurements are verified before fabrication.",
    materials: [{ id: "material-bedroom", application: "Joinery", materialId: null, brandId: null, finishId: null, productName: "MR plywood / laminate / natural veneer", productCode: "PLM-BED-J01", finishCode: "Warm neutral", stockSize: "As fabricated", status: "approved", selectedBy: "Aisha Al Mansoori", selectedAt: "2026-08-28T10:00:00.000Z", evidence: "Approved finish schedule", catalog: {} }],
    dimensions: [],
  },
  dining: {
    refinedRequirement: "Dining table with six upholstered chairs to the approved design reference.",
    construction: "Natural veneer timber base with a polished Taj Mahal stone top.",
    inclusions: "Table, six chairs, upholstery and protective finish.",
    exclusions: "Loose table styling.",
    assumptions: "Final stone selection is subject to approved slab bookmatch.",
    materials: [{ id: "material-dining", application: "Table and chairs", materialId: null, brandId: null, finishId: null, productName: "Taj Mahal stone / natural veneer / performance fabric", productCode: "PLM-DIN-01", finishCode: "Satin clear coat", stockSize: "Selected slab and veneer batch", status: "approved", selectedBy: "Aisha Al Mansoori", selectedAt: "2026-08-28T10:00:00.000Z", evidence: "Approved material board", catalog: {} }],
    dimensions: [
      { id: "dimension-dining-length", name: "Length", unit: "cm", basis: "finished_item", approximate: null, measured: 220, source: "approved design", evidence: "Drawing R2", verification: "verified" },
      { id: "dimension-dining-height", name: "Height", unit: "cm", basis: "finished_item", approximate: null, measured: 75, source: "approved design", evidence: "Drawing R2", verification: "verified" },
      { id: "dimension-dining-depth", name: "Depth", unit: "cm", basis: "finished_item", approximate: null, measured: 100, source: "approved design", evidence: "Drawing R2", verification: "verified" },
    ],
  },
  living: {
    refinedRequirement: "Coordinated media wall and buffet joinery with integrated warm lighting and concealed cable management.",
    construction: "Veneered and lacquered joinery on moisture-resistant plywood with removable service panels.",
    inclusions: "Media wall, buffet, LED profiles and installation.",
    exclusions: "Television and audio equipment.",
    assumptions: "Power outlet positions follow the approved coordinated drawing.",
    materials: [{ id: "material-living", application: "Feature joinery", materialId: null, brandId: null, finishId: null, productName: "Natural veneer / lacquer / LED profile", productCode: "PLM-LIV-01", finishCode: "Warm neutral", stockSize: "As fabricated", status: "approved", selectedBy: "Aisha Al Mansoori", selectedAt: "2026-08-28T10:00:00.000Z", evidence: "Approved finish schedule", catalog: {} }],
    dimensions: [],
  },
  installation: {
    refinedRequirement: "Protected delivery, room-by-room installation, final styling coordination and handover support.",
    construction: "Sequenced factory dispatch and installation by the assigned Palm Living delivery team.",
    inclusions: "Delivery, installation, protection removal, touch-ups and final clean.",
    exclusions: "Building access charges not disclosed before mobilization.",
    assumptions: "Client provides agreed access windows and clear installation areas.",
    materials: [{ id: "material-installation", application: "Delivery and installation", materialId: null, brandId: null, finishId: null, productName: "Labour, protection and logistics", productCode: "PLM-SVC-01", finishCode: "Not applicable", stockSize: "Project allowance", status: "approved", selectedBy: "Palm Living Operations", selectedAt: "2026-08-28T10:00:00.000Z", evidence: "Approved delivery plan", catalog: {} }],
    dimensions: [],
  },
};

const roomRows = [
  { id: ids.rooms.bedrooms, name: "Bedrooms" },
  { id: ids.rooms.dining, name: "Dining Area" },
  { id: ids.rooms.living, name: "Living Area" },
  { id: ids.rooms.wholeVilla, name: "Whole villa" },
];
const entryRows = [
  { id: ids.entries.bedroom, roomId: ids.rooms.bedrooms, roomName: "Bedrooms", title: "Bedroom wardrobes and vanity", note: specifications.bedroom.refinedRequirement, category: "Joinery", priority: "must_have", quantity: 3, unit: "rooms", specification: specifications.bedroom },
  { id: ids.entries.dining, roomId: ids.rooms.dining, roomName: "Dining Area", title: "Dining table with six chairs", note: specifications.dining.refinedRequirement, category: "Furniture", priority: "must_have", quantity: 1, unit: "set", specification: specifications.dining },
  { id: ids.entries.living, roomId: ids.rooms.living, roomName: "Living Area", title: "Media wall and buffet joinery", note: specifications.living.refinedRequirement, category: "Joinery", priority: "must_have", quantity: 1, unit: "lot", specification: specifications.living },
  { id: ids.entries.installation, roomId: ids.rooms.wholeVilla, roomName: "Whole villa", title: "Delivery, installation and styling", note: specifications.installation.refinedRequirement, category: "Services", priority: "must_have", quantity: 1, unit: "lot", specification: specifications.installation },
];

function clientSafeSpecification(specification) {
  return {
    version: 1,
    refinedRequirement: specification.refinedRequirement,
    construction: specification.construction,
    inclusions: specification.inclusions,
    exclusions: specification.exclusions,
    assumptions: specification.assumptions,
    materials: specification.materials.map((material) => ({ ...material, catalog: {} })),
    dimensions: specification.dimensions.map((dimension) => ({ ...dimension })),
    designs: [],
  };
}

const sourceSnapshot = {
  schemaVersion: 1,
  caseId: ids.case,
  brief: { version: 1, ...brief },
  rooms: roomRows.map((room) => ({ ...room, version: 1 })),
  items: entryRows.map((entry) => ({
    id: entry.id,
    version: 1,
    title: entry.title,
    roomId: entry.roomId,
    roomName: entry.roomName,
    category: entry.category,
    priority: entry.priority,
    scopeStatus: "included",
    reviewStatus: "reviewed",
    source: "client",
    quantity: entry.quantity,
    unit: entry.unit,
    requirement: entry.note,
    document: null,
    avoid: "",
    referenceUrl: "",
    catalog: [],
    evidenceFiles: [],
    specification: clientSafeSpecification(entry.specification),
  })),
};
const baselineMessage = "Confirmed Palm Living scope, specifications and commercial basis for quotation 0744.";
const sourceHash = canonicalHash(sourceSnapshot);
const baselineSnapshot = { definition: sourceSnapshot, publication: { message: baselineMessage } };
const snapshotHash = canonicalHash(baselineSnapshot);

const photo = {
  dining: imageData("image-010.png"),
  living: imageData("image-011.png"),
  bedroom: imageData("image-019.png"),
  installation: imageData("image-003.png"),
};
const quoteLines = [
  { id: "scope-dining", scopeId: ids.entries.dining, scopeVersion: 1, specificationVersion: 1, room: "Dining Area", title: "Dining table with six chairs", specification: "220 × 75 × 100 cm finished size. Taj Mahal stone top with natural veneer base and six upholstered chairs.", material: "Taj Mahal stone / natural veneer / performance fabric", finish: "Satin clear coat", quantity: 1, unit: "set", unitCost: 0, rate: 50000, dimensions: { length: 220, height: 75, depth: 100, unit: "cm" }, ...(photo.dining ? { photo: photo.dining } : {}) },
  { id: "scope-living", scopeId: ids.entries.living, scopeVersion: 1, specificationVersion: 1, room: "Living Area", title: "Media wall and buffet joinery", specification: "Feature veneer joinery with integrated warm lighting and concealed cable management.", material: "Natural veneer / lacquer / LED profile", finish: "Warm neutral", quantity: 1, unit: "lot", unitCost: 0, rate: 82000, ...(photo.living ? { photo: photo.living } : {}) },
  { id: "scope-bedroom", scopeId: ids.entries.bedroom, scopeVersion: 1, specificationVersion: 1, room: "Bedrooms", title: "Bedroom wardrobes and vanity", specification: "Three bedroom joinery packages with client-approved internal accessories.", material: "MR plywood / laminate / natural veneer", finish: "Client-approved palette", quantity: 3, unit: "rooms", unitCost: 0, rate: 61000, ...(photo.bedroom ? { photo: photo.bedroom } : {}) },
  { id: "scope-install", scopeId: ids.entries.installation, scopeVersion: 1, specificationVersion: 1, room: "Whole villa", title: "Delivery, installation and styling", specification: "Protected delivery, room-by-room installation, final touch-ups and handover support.", material: "Labour, protection and logistics", finish: "Final clean and handover ready", quantity: 1, unit: "lot", unitCost: 0, rate: 70000, ...(photo.installation ? { photo: photo.installation } : {}) },
];
const total = quoteLines.reduce((sum, line) => sum + line.quantity * line.rate, 0);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const workspace = (await client.query("SELECT workspace_id FROM pre_project_cases WHERE id=$1", [ids.case])).rows[0];
  assert(workspace, "Palm Living review case was not found.");
  await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspace.workspace_id]);
  const actor = (await client.query(`SELECT membership.id AS "membershipId",app_user.id AS "userId",app_user.display_name AS name
    FROM workspace_memberships membership JOIN users app_user ON app_user.id=membership.user_id
    WHERE membership.workspace_id=$1 AND membership.status='active' ORDER BY membership.joined_at LIMIT 1`, [workspace.workspace_id])).rows[0];
  assert(actor, "Palm Living needs an active member.");

  const portalBrand = {
    name: "Palm Living Interiors",
    logo: "",
    primaryColor: "#E4E3DE",
    accentColor: "#000000",
    welcomeTitle: "Your space, thoughtfully delivered.",
    welcomeText: "Review your proposal, approvals and project progress in one place.",
    supportPhone: "",
    layout: "minimal",
  };
  await client.query(`INSERT INTO client_portal_settings(workspace_id,slug,enabled,version,brand)
    VALUES($1,'palm-living-review',true,1,$2::jsonb)
    ON CONFLICT(workspace_id) DO UPDATE SET enabled=true,version=client_portal_settings.version+1,brand=excluded.brand,updated_at=now()`, [workspace.workspace_id, JSON.stringify(portalBrand)]);

  await client.query(`INSERT INTO pre_project_briefs(case_id,workspace_id,content,version,updated_by)
    VALUES($1,$2,$3::jsonb,1,$4)
    ON CONFLICT(case_id) DO UPDATE SET content=excluded.content,version=1,updated_by=excluded.updated_by,updated_at=now()`, [ids.case, workspace.workspace_id, JSON.stringify(brief), actor.userId]);
  for (const room of roomRows) await client.query(`INSERT INTO pre_project_rooms(id,workspace_id,case_id,name,version)
    VALUES($1,$2,$3,$4,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=1`, [room.id, workspace.workspace_id, ids.case, room.name]);
  for (const entry of entryRows) {
    await client.query(`INSERT INTO pre_project_brief_entries(id,workspace_id,case_id,room_id,kind,title,note,category,priority,scope_status,review_status,quantity,unit,source,version,created_by,updated_by)
      VALUES($1,$2,$3,$4,'requirement',$5,$6,$7,$8,'included','reviewed',$9,$10,'client',1,$11,$11)
      ON CONFLICT(id) DO UPDATE SET room_id=excluded.room_id,title=excluded.title,note=excluded.note,category=excluded.category,priority=excluded.priority,scope_status='included',review_status='reviewed',quantity=excluded.quantity,unit=excluded.unit,source='client',version=1,updated_by=excluded.updated_by,updated_at=now(),archived_at=NULL`, [entry.id, workspace.workspace_id, ids.case, entry.roomId, entry.title, entry.note, entry.category, entry.priority, entry.quantity, entry.unit, actor.userId]);
    await client.query(`INSERT INTO pre_project_item_specifications(workspace_id,case_id,entry_id,version,content,created_by)
      VALUES($1,$2,$3,1,$4::jsonb,$5) ON CONFLICT(workspace_id,case_id,entry_id,version) DO UPDATE SET content=excluded.content`, [workspace.workspace_id, ids.case, entry.id, JSON.stringify(entry.specification), actor.userId]);
  }

  await client.query(`INSERT INTO pre_project_definition_baselines(id,workspace_id,case_id,number,request_id,request_hash,source_hash,snapshot_hash,snapshot,message,published_by)
    VALUES($1,$2,$3,1,$4,$5,$6,$7,$8::jsonb,$9,$10)
    ON CONFLICT(id) DO UPDATE SET request_hash=excluded.request_hash,source_hash=excluded.source_hash,snapshot_hash=excluded.snapshot_hash,snapshot=excluded.snapshot,message=excluded.message,published_by=excluded.published_by,published_at=now()`, [ids.baseline, workspace.workspace_id, ids.case, ids.baselineRequest, canonicalHash({ seed: "palm-connected-baseline" }), sourceHash, snapshotHash, JSON.stringify(baselineSnapshot), baselineMessage, actor.userId]);
  await client.query(`INSERT INTO pre_project_definition_decisions(id,workspace_id,case_id,baseline_id,request_id,request_hash,decision,decision_by,channel,note,evidence,decided_at,recorded_by)
    VALUES($1,$2,$3,$4,$5,$6,'confirmed','Aisha Al Mansoori','signed_document','',$7,'2026-09-01T08:30:00.000Z',$8)
    ON CONFLICT(workspace_id,case_id,baseline_id) DO UPDATE SET decision='confirmed',decision_by='Aisha Al Mansoori',channel='signed_document',evidence=excluded.evidence,decided_at=excluded.decided_at,recorded_by=excluded.recorded_by`, [ids.decision, workspace.workspace_id, ids.case, ids.baseline, ids.decisionRequest, canonicalHash({ seed: "palm-connected-decision" }), "Signed proposal scope confirmation · 1 September 2026", actor.userId]);

  const commercial = (await client.query("SELECT content FROM commercial_cases WHERE workspace_id=$1 AND case_id=$2 FOR UPDATE", [workspace.workspace_id, ids.case])).rows[0];
  assert(commercial, "Commercial case was not found.");
  const content = commercial.content;
  const quote = content.quotes.find((candidate) => candidate.id === ids.quote);
  assert(quote, "Review quotation was not found.");
  Object.assign(quote, {
    rooms: roomRows.map(({ id, name }) => ({ id, name })),
    lines: quoteLines,
    total,
    definitionBaseline: { id: ids.baseline, number: 1, hash: snapshotHash },
    inclusions: "Supply, manufacture, delivery and installation of the listed items; coordinated project management; final touch-ups and handover clean.",
    exclusions: "Authority fees, loose electronics and work not expressly listed. Any change is priced through controlled variation.",
    terms: "Prices are in AED. Client approval, agreed payments, site access and final verified measurements are required before manufacture. Product images are presentation references; approved material samples and drawings govern production.",
    paymentTerms: [
      { id: "payment-advance", title: "Advance", percent: 50, trigger: "On signed agreement", requiredForRelease: true },
      { id: "payment-production", title: "Production", percent: 40, trigger: "Before dispatch", requiredForRelease: true },
      { id: "payment-handover", title: "Handover", percent: 10, trigger: "On practical completion", requiredForRelease: false },
    ],
    cover: { ...(quote.cover ?? {}), preparedFor: "Aisha Al Mansoori", location: "Jumeirah Garden Villa, Dubai", subtitle: "Interior design & fit-out proposal", coordinates: { latitude: 25.2048, longitude: 55.2708 } },
  });
  content.revision = Number(content.revision ?? 1) + 1;
  content.audit = content.audit.filter((entry) => entry.id !== "connected-demo-seed");
  content.audit.push({ id: "connected-demo-seed", at: new Date().toISOString(), actor: actor.name, action: "seed_connected_demo", quoteId: ids.quote, note: "Palm Living requirements, proposal images and project BOQ connected." });
  await client.query("UPDATE commercial_cases SET content=$3::jsonb,revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND case_id=$2", [workspace.workspace_id, ids.case, JSON.stringify(content)]);

  const execution = (await client.query("SELECT content FROM project_execution WHERE workspace_id=$1 AND project_id=$2 FOR UPDATE", [workspace.workspace_id, ids.project])).rows[0];
  assert(execution, "Palm Living demo project was not found.");
  execution.content.scope = {
    ...execution.content.scope,
    quoteId: ids.quote,
    quoteNumber: 744,
    definitionBaseline: { id: ids.baseline, number: 1, hash: snapshotHash },
    value: total,
    lines: quoteLines.map(({ unitCost, scopeId, scopeVersion, specificationVersion, photo: _photo, ...line }) => ({ ...line, lineTotal: line.quantity * line.rate, sourceScopeId: scopeId, sourceScopeVersion: scopeVersion, sourceSpecificationVersion: specificationVersion })),
  };
  await client.query("UPDATE project_execution SET content=$3::jsonb,revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND project_id=$2", [workspace.workspace_id, ids.project, JSON.stringify(execution.content)]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ workspaceId: workspace.workspace_id, caseId: ids.case, quoteId: ids.quote, projectId: ids.project, rooms: roomRows.length, requirements: entryRows.length, quoteLines: quoteLines.length, quoteTotal: total, proposalImages: Object.values(photo).filter(Boolean).length, definitionBaselineId: ids.baseline }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
