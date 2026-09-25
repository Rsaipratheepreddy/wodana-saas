import assert from "node:assert/strict";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "Set DATABASE_URL to the local Palm review database.");
const target = new URL(databaseUrl);
assert(["127.0.0.1", "localhost"].includes(target.hostname), "Palm review seed is local-only.");
const sharedLocal = target.pathname === "/wodana";
assert(
  target.pathname.includes("palm_review") || target.pathname === "/wodana_palm_local_20260922" ||
    (sharedLocal && process.env.PALM_ALLOW_SHARED_LOCAL_SEED === "palm-living-demo-only"),
  "Use a dedicated local Palm review database, or explicitly opt in to the local wodana Palm demo seed.",
);

const ids = {
  pipeline: "d1000000-0000-4000-8000-000000000001",
  stage: "d1000000-0000-4000-8000-000000000002",
  party: "d1000000-0000-4000-8000-000000000003",
  contact: "d1000000-0000-4000-8000-000000000004",
  address: "d1000000-0000-4000-8000-000000000005",
  opportunity: "d1000000-0000-4000-8000-000000000006",
  case: "d1000000-0000-4000-8000-000000000007",
  project: "d1000000-0000-4000-8000-000000000008",
  assignment: "d1000000-0000-4000-8000-000000000009",
  site: "d1000000-0000-4000-8000-000000000010",
  productionUnit: "d1000000-0000-4000-8000-000000000011",
  siteUnit: "d1000000-0000-4000-8000-000000000012",
  factory: "d1000000-0000-4000-8000-000000000013",
  installCrew: "d1000000-0000-4000-8000-000000000014",
  factoryBooking: "d1000000-0000-4000-8000-000000000015",
  siteBooking: "d1000000-0000-4000-8000-000000000016",
};

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const workspace = (await client.query(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug=$1`, [process.env.PALM_REVIEW_WORKSPACE_SLUG ?? "palm-living"])).rows[0];
  assert(workspace, "Palm Living workspace is not configured.");
  await client.query(`SELECT set_config('app.current_workspace_id',$1,true)`, [workspace.id]);
  if (sharedLocal) {
    assert(process.env.PALM_REVIEW_WORKSPACE_SLUG === "palm-living", "The shared local database may only receive the Palm Living demo.");
    for (const [table, id] of [["crm_parties", ids.party], ["crm_opportunities", ids.opportunity], ["pre_project_cases", ids.case], ["delivery_projects", ids.project], ["project_resources", ids.factory], ["project_resources", ids.installCrew]]) {
      const conflict = await client.query(`SELECT 1 FROM ${table} WHERE id=$1 LIMIT 1`, [id]);
      assert(!conflict.rowCount, `Refusing to overwrite an existing ${table} record.`);
    }
    const configured = await client.query(`SELECT 1 FROM business_units WHERE workspace_id=$1 AND code IN ('PRODUCTION','SITE')
      UNION ALL SELECT 1 FROM crm_pipelines WHERE workspace_id=$1 AND code='palm_projects' LIMIT 1`, [workspace.id]);
    assert(!configured.rowCount, "Refusing to replace existing Palm business units or pipeline.");
  }
  const existingProject = (await client.query(`SELECT id FROM delivery_projects WHERE workspace_id=$1 AND id=$2`, [workspace.id, ids.project])).rows[0];
  assert(!existingProject, "Palm Living demo project already exists; seed is intentionally one-time and will not overwrite it.");
  const actor = (await client.query(`SELECT membership.id AS "membershipId",app_user.id AS "userId",app_user.display_name AS name
    FROM workspace_memberships membership JOIN users app_user ON app_user.id=membership.user_id
    WHERE membership.workspace_id=$1 AND membership.status='active' ORDER BY membership.joined_at LIMIT 1`, [workspace.id])).rows[0];
  const demoMember = sharedLocal ? (await client.query(`SELECT membership.id FROM workspace_memberships membership JOIN users app_user ON app_user.id=membership.user_id
    WHERE membership.workspace_id=$1 AND membership.status='active' AND app_user.primary_email='palm-demo@wodana.invalid'`, [workspace.id])).rows[0] : null;
  const legalEntity = (await client.query(`SELECT id FROM legal_entities WHERE workspace_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [workspace.id])).rows[0];
  assert(actor && legalEntity, "Palm Living needs an active member and legal entity.");

  await client.query(`INSERT INTO business_units(id,workspace_id,legal_entity_id,code,name,type,timezone,color)
    VALUES($1,$3,$4,'PRODUCTION','Production','factory','Asia/Dubai','#887A68'),($2,$3,$4,'SITE','Site Execution','site','Asia/Dubai','#4F6B63')
    ON CONFLICT(workspace_id,code) DO UPDATE SET name=excluded.name,color=excluded.color,status='active'`, [ids.productionUnit, ids.siteUnit, workspace.id, legalEntity.id]);
  const units = (await client.query(`SELECT code,id FROM business_units WHERE workspace_id=$1 AND code IN ('PRODUCTION','SITE')`, [workspace.id])).rows;
  const productionUnit = units.find((unit) => unit.code === "PRODUCTION").id;
  const siteUnit = units.find((unit) => unit.code === "SITE").id;

  await client.query(`INSERT INTO crm_pipelines(id,workspace_id,code,name,is_default) VALUES($1,$2,'palm_projects','Palm Living Projects',true)
    ON CONFLICT(workspace_id,code) DO UPDATE SET name=excluded.name,status='active',is_default=true`, [ids.pipeline, workspace.id]);
  const pipelineId = (await client.query(`SELECT id FROM crm_pipelines WHERE workspace_id=$1 AND code='palm_projects'`, [workspace.id])).rows[0].id;
  await client.query(`INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability,forecast_category)
    VALUES($1,$2,$3,'won','Won / delivery',1,100,'commit')
    ON CONFLICT(workspace_id,pipeline_id,code) DO UPDATE SET name=excluded.name,probability=100,status='active'`, [ids.stage, workspace.id, pipelineId]);
  const stageId = (await client.query(`SELECT id FROM crm_pipeline_stages WHERE workspace_id=$1 AND pipeline_id=$2 AND code='won'`, [workspace.id, pipelineId])).rows[0].id;

  await client.query(`INSERT INTO crm_parties(id,workspace_id,legal_entity_id,business_unit_id,type,display_name,normalized_name,lifecycle,owner_membership_id,preferred_locale,preferred_timezone,created_by)
    VALUES($1,$2,$3,$4,'person','Aisha Al Mansoori','aisha al mansoori','customer',$5,'en-AE','Asia/Dubai',$6)
    ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,lifecycle='customer',status='active',owner_membership_id=excluded.owner_membership_id`,
    [ids.party, workspace.id, legalEntity.id, siteUnit, actor.membershipId, actor.userId]);
  await client.query(`INSERT INTO crm_contact_points(id,workspace_id,party_id,type,label,raw_value,normalized_value,country_code,is_primary,is_verified,verified_at)
    VALUES($1,$2,$3,'phone','Mobile','+971 50 555 0148','+971505550148','AE',true,true,now())
    ON CONFLICT(id) DO UPDATE SET raw_value=excluded.raw_value,normalized_value=excluded.normalized_value,status='active'`, [ids.contact, workspace.id, ids.party]);
  await client.query(`INSERT INTO crm_addresses(id,workspace_id,party_id,label,line1,locality,region,country_code,latitude,longitude,is_primary)
    VALUES($1,$2,$3,'Project site','District One, Mohammed Bin Rashid City','Dubai','Dubai','AE',25.1751,55.2874,true)
    ON CONFLICT(id) DO UPDATE SET line1=excluded.line1,locality=excluded.locality,region=excluded.region`, [ids.address, workspace.id, ids.party]);
  await client.query(`INSERT INTO crm_opportunities(id,workspace_id,legal_entity_id,business_unit_id,party_id,pipeline_id,stage_id,owner_membership_id,title,description,status,amount,currency_code,probability,forecast_category,expected_close_at,next_action_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Jumeirah Garden Villa · Full Interior','Complete Palm Living demonstration from approved scope through production, onsite execution and handover.','won',385000,'AED',100,'commit','2026-08-28','2026-09-22')
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,status='won',amount=excluded.amount,owner_membership_id=excluded.owner_membership_id`,
    [ids.opportunity, workspace.id, legalEntity.id, siteUnit, ids.party, pipelineId, stageId, actor.membershipId]);
  await client.query(`INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,status,created_by,phase,owner_membership_id,target_date,priority,risk_level,activated_at,released_at,released_by)
    VALUES($1,$2,$3,'released',$4,'release',$5,'2026-09-30','high','medium','2026-07-01','2026-09-01',$4)
    ON CONFLICT(id) DO UPDATE SET status='released',phase='release',released_at=excluded.released_at,released_by=excluded.released_by`,
    [ids.case, workspace.id, ids.opportunity, actor.userId, actor.membershipId]);
  await client.query(`INSERT INTO delivery_projects(id,workspace_id,case_id,name,status,created_by,created_at)
    VALUES($1,$2,$3,'Palm Living Demo · Jumeirah Garden Villa','active',$4,'2026-09-01')
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='active'`, [ids.project, workspace.id, ids.case, actor.userId]);
  await client.query(`INSERT INTO project_assignments(id,workspace_id,project_id,membership_id,is_manager,active)
    VALUES($1,$2,$3,$4,true,true) ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL DO UPDATE SET is_manager=true,active=true`,
    [ids.assignment, workspace.id, ids.project, actor.membershipId]);
  if (sharedLocal) {
    await client.query(`INSERT INTO project_assignments(id,workspace_id,project_id,membership_id,is_manager,active)
      SELECT gen_random_uuid(),$1,$2,id,false,true FROM workspace_memberships
      WHERE workspace_id=$1 AND status='active' AND id<>$3
      ON CONFLICT(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL DO NOTHING`,
      [workspace.id, ids.project, actor.membershipId]);
  }
  await client.query(`INSERT INTO work_locations(id,workspace_id,name,kind,project_id,address,latitude,longitude,radius_m,active)
    VALUES($1,$2,'Jumeirah Garden Villa','site',$3,'District One, Mohammed Bin Rashid City, Dubai',25.1751,55.2874,180,true)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,active=true`, [ids.site, workspace.id, ids.project]);

  const task = (id, title, area, location, resourceId, start, end, status, approved, quantity, unit, predecessor = [], blocker = "") => ({
    id, parentId: "", packageId: area === "Dining & Living" ? "pkg-joinery" : "pkg-site", package: area === "Dining & Living" ? "Custom furniture production" : "Site installation & styling",
    title, description: `${title} with inspection evidence and controlled release.`, area, location, ownerId: actor.membershipId, assigneeIds: demoMember && status !== "completed" ? [...new Set([actor.membershipId, demoMember.id])] : [actor.membershipId], resourceId,
    start, end, baselineStart: start, baselineEnd: end, predecessors: predecessor, quantity, unit, weight: quantity, approved, status, priority: blocker ? "high" : "normal",
    inspectionRequired: true, scopeIds: [area === "Dining & Living" ? "scope-dining" : "scope-bedroom"], drawingId: "doc-joinery-r2",
    readiness: { scope: true, access: true, materials: !blocker }, blocker,
  });
  const tasks = [
    task("task-shop-drawings", "Approve coordinated shop drawings", "Dining & Living", "office", ids.factory, "2026-09-02", "2026-09-05", "completed", 1, 1, "set"),
    task("task-dining-production", "Manufacture dining table and six chairs", "Dining & Living", "factory", ids.factory, "2026-09-08", "2026-09-22", "in_progress", 4, 7, "items", ["task-shop-drawings"]),
    task("task-tv-unit", "Manufacture living room media wall", "Dining & Living", "factory", ids.factory, "2026-09-12", "2026-09-27", "in_progress", 2.5, 5, "m", ["task-shop-drawings"]),
    task("task-site-prep", "Protect floors and confirm setting-out", "Bedrooms", "site", ids.installCrew, "2026-09-20", "2026-09-21", "planned", 0, 1, "lot"),
    task("task-install-joinery", "Install bedroom and living joinery", "Bedrooms", "site", ids.installCrew, "2026-09-28", "2026-10-05", "planned", 0, 18, "m", ["task-tv-unit"], "Awaiting final veneer batch delivery"),
    task("task-styling", "Final styling and client walkthrough", "Whole villa", "site", ids.installCrew, "2026-10-08", "2026-10-10", "planned", 0, 1, "lot", ["task-install-joinery"]),
  ];
  const scope = {
    quoteId: "quote-demo-0744", quoteHash: "demo-accepted-quotation-r5", quoteNumber: 744,
    definitionBaseline: { id: "definition-demo", number: 2, hash: "demo-confirmed-scope" }, dealFileId: "deal-file-demo", dealFileReference: "PLM-DF-0744",
    releaseId: "release-demo", releasedAt: "2026-09-01T09:00:00.000Z", currency: "AED", value: 385000,
    lines: [
      { id: "scope-dining", title: "Dining table with six chairs", room: "Dining Area", specification: "2200 × 1000 mm dining table; Taj Mahal marble and veneer.", material: "Taj Mahal marble / natural veneer", finish: "Satin clear coat", dimensions: { length: 220, height: 75, depth: 100, unit: "cm" }, quantity: 1, unit: "set", rate: 50000, lineTotal: 50000 },
      { id: "scope-living", title: "Media wall and buffet joinery", room: "Living Area", specification: "Feature veneer joinery, integrated lighting and concealed cable management.", material: "Natural veneer / lacquer / LED", finish: "Warm neutral", quantity: 1, unit: "lot", rate: 82000, lineTotal: 82000 },
      { id: "scope-bedroom", title: "Bedroom wardrobes and vanity", room: "Bedrooms", specification: "Three bedroom joinery package with approved internal accessories.", material: "MR plywood / laminate / veneer", finish: "Client-approved palette", quantity: 3, unit: "rooms", rate: 61000, lineTotal: 183000 },
    ],
  };
  const content = {
    revision: 18, phase: "active",
    controls: { reference: "PRJ-PLM-2026-0744", priority: "high", risk: "get_ready", onHold: false, holdReason: "", holdSince: "", holdOwnerId: "", promise: "Complete approved interiors ready for client handover by 12 October.", targetCompletion: "2026-10-10", handoverDate: "2026-10-12", nextAction: "Confirm final veneer batch and lock installation sequence", nextActionOwnerId: actor.membershipId, nextActionDate: "2026-09-22", nextClientMeeting: "2026-09-24", nextClientMeetingOwnerId: actor.membershipId, clientNote: "Client prefers one weekly summary with photos and decisions." },
    initiation: { status: "confirmed", commercial: { quoteId: scope.quoteId, quoteHash: scope.quoteHash, quoteNumber: 744, dealFileId: scope.dealFileId, dealFileReference: scope.dealFileReference, agreementReference: "PLM-AGR-0744", currency: "AED", value: 385000, paymentMilestones: [{ id: "pay-1", title: "Advance", amount: 192500, dueDate: "2026-09-01", trigger: "Agreement", requiredForRelease: true, requiredForProduction: true }, { id: "pay-2", title: "Before installation", amount: 115500, dueDate: "2026-09-27", trigger: "Factory completion", requiredForRelease: false }, { id: "pay-3", title: "Handover", amount: 77000, dueDate: "2026-10-12", trigger: "Client acceptance", requiredForRelease: false }] }, baseline: { projectOwnerId: actor.membershipId, teamMemberIds: [actor.membershipId], siteReadiness: "confirmed", siteIds: [ids.site], objective: "Deliver the approved Palm Living interior scope with traceable quality evidence.", clientPromise: "Complete approved interiors ready for client handover by 12 October.", clientContactName: "Aisha Al Mansoori", clientContactPhone: "+971 50 555 0148", clientContactEmail: "aisha.demo@example.invalid", accessNotes: "Building access 08:00–18:00; noisy works require 24-hour notice.", operationalStart: "2026-09-02", targetCompletion: "2026-10-10", handoverDate: "2026-10-12" }, confirmedAt: "2026-09-01T09:30:00.000Z", confirmedById: actor.membershipId, confirmedByName: actor.name, revisions: [] },
    roleAssignments: [{ role: "project_manager", memberId: actor.membershipId }, { role: "procurement_production", memberId: actor.membershipId }],
    approvedMaterials: [{ id: "approved-marble", sourceApprovalId: "client-material-1", quoteId: scope.quoteId, lineId: "scope-dining", room: "Dining Area", item: "Dining table", name: "Taj Mahal quartzite", code: "TM-QZ-20", brand: "Client selection", specification: "20 mm polished top; approved slab bookmatch", revision: 2, approvedAt: "2026-08-24T12:00:00.000Z", approvedBy: "Aisha Al Mansoori" }],
    designBaseline: { capturedAt: "2026-09-01T09:00:00.000Z", definitionBaseline: scope.definitionBaseline, links: [] },
    workPackages: [
      { id: "pkg-joinery", scopeLineIds: ["scope-dining", "scope-living"], title: "Custom furniture production", area: "Dining & Living", deliveryRoute: "factory", status: "in_progress", ownerId: actor.membershipId, plannedStart: "2026-09-02", plannedEnd: "2026-09-27", priority: "high", risk: "watch", nextAction: "Approve veneer batch", nextActionOwnerId: actor.membershipId, nextActionDate: "2026-09-22", recoveryPlan: "Reserve alternate matching veneer batch if supplier misses confirmation.", blocker: "", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-18T15:00:00.000Z" },
      { id: "pkg-site", scopeLineIds: ["scope-bedroom"], title: "Site installation & styling", area: "Bedrooms", deliveryRoute: "site", status: "planning", ownerId: actor.membershipId, plannedStart: "2026-09-20", plannedEnd: "2026-10-10", predecessorPackageIds: ["pkg-joinery"], priority: "high", risk: "watch", nextAction: "Confirm protected storage zone", nextActionOwnerId: actor.membershipId, nextActionDate: "2026-09-23", recoveryPlan: "Split delivery by room if site storage remains constrained.", blocker: "Final veneer batch confirmation", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-18T15:00:00.000Z" },
    ],
    milestones: [{ id: "milestone-factory", title: "Factory completion", dueDate: "2026-09-27", baselineDate: "2026-09-25", ownerId: actor.membershipId, taskIds: ["task-dining-production", "task-tv-unit"], visibleToClient: true, evidence: "Factory QA and packing photographs" }, { id: "milestone-handover", title: "Client handover", dueDate: "2026-10-12", baselineDate: "2026-10-12", ownerId: actor.membershipId, taskIds: ["task-styling"], visibleToClient: true, evidence: "Signed room handover packs" }],
    scope, tasks,
    reports: [{ id: "report-2026-09-18", date: "2026-09-18", shift: "Day", location: "factory", authorId: actor.membershipId, author: actor.name, status: "approved", entries: [{ taskId: "task-dining-production", quantity: 4 }, { taskId: "task-tv-unit", quantity: 2.5 }], hours: 8, people: 9, materials: "Veneer pressing complete; marble template approved.", issues: "One veneer batch requires colour confirmation.", tomorrow: "Complete chair upholstery and media-wall dry fit.", evidence: "Factory progress photo set FP-18", note: "Overall sequence remains recoverable.", summary: "Dining package 57% complete; media wall 50% complete.", weather: "Indoor factory work", safety: "Toolbox talk completed", safetyStatus: "none", scheduleImpact: "watch", impactReason: "Veneer colour approval", recoveryPlan: "Hold matching reserve stock", nextUpdateOwnerId: actor.membershipId, nextUpdateDate: "2026-09-22", workforce: [{ trade: "Joinery", people: 6, hours: 8 }, { trade: "Upholstery", people: 3, hours: 8 }], reviewedBy: actor.membershipId, reviewedAt: "2026-09-18T16:00:00.000Z", publishedAt: "2026-09-18T16:10:00.000Z" }],
    materials: [
      { id: "mat-veneer", title: "Natural oak veneer", specification: "A-grade crown cut, client-approved warm tone", catalogId: "", catalogVersion: 1, unit: "sheet", required: 42, supply: "vendor", taskId: "task-tv-unit", needBy: "2026-09-21", movements: [{ id: "move-v1", kind: "receive", quantity: 30, reference: "GRN-221", at: "2026-09-15" }], reservations: [{ taskId: "task-tv-unit", quantity: 24, reference: "RES-TV-01", at: "2026-09-16" }] },
      { id: "mat-marble", title: "Taj Mahal quartzite", specification: "20 mm polished slab; approved bookmatch", catalogId: "", catalogVersion: 1, unit: "slab", required: 2, supply: "vendor", taskId: "task-dining-production", needBy: "2026-09-22", movements: [{ id: "move-m1", kind: "receive", quantity: 2, reference: "GRN-225", at: "2026-09-17" }], reservations: [] },
      { id: "mat-hinges", title: "Soft-close concealed hinges", specification: "110° clip-on, nickel finish", catalogId: "", catalogVersion: 1, unit: "nos", required: 48, supply: "company", taskId: "task-install-joinery", needBy: "2026-09-26", movements: [{ id: "move-h1", kind: "receive", quantity: 48, reference: "STOCK-18", at: "2026-09-10" }], reservations: [{ taskId: "task-install-joinery", quantity: 48, reference: "RES-BR-01", at: "2026-09-18" }] },
    ],
    orders: [{ id: "order-veneer", number: "PO-PLM-2026-118", title: "Natural veneer and matching edge", vendor: "Dubai Veneer Trading", vendorContact: "+971 4 555 0180", kind: "material", materialId: "mat-veneer", taskId: "task-tv-unit", quantity: 42, unit: "sheet", unitCost: 245, currency: "AED", promisedDate: "2026-09-21", leadTimeDays: 7, status: "acknowledged", acknowledgement: "30 sheets delivered; balance batch under colour review.", receipts: [{ id: "receipt-v1", accepted: 30, rejected: 0, evidence: "GRN-221 and receiving photos", at: "2026-09-15" }], vendorUpdates: [{ id: "update-v1", at: "2026-09-18", kind: "progress", note: "Balance batch reserved pending finish approval.", evidence: "Supplier batch photo", date: "2026-09-20", quantity: 12 }] }],
    documents: [{ id: "doc-joinery-r2", title: "Joinery coordinated shop drawings", kind: "drawing", revision: "R2", url: "", note: "Approved for production", status: "approved", replaces: "", published: true, approvedBy: actor.membershipId, scopeLineIds: ["scope-dining", "scope-living", "scope-bedroom"] }, { id: "doc-finish-schedule", title: "Approved finish schedule", kind: "specification", revision: "R1", url: "", note: "Client-approved materials and finish codes", status: "approved", replaces: "", published: true, approvedBy: actor.membershipId, scopeLineIds: ["scope-dining", "scope-living", "scope-bedroom"] }],
    snags: [{ id: "snag-factory-1", title: "Align media-wall shadow gap", taskId: "task-tv-unit", area: "Living Area", ownerId: actor.membershipId, severity: "minor", dueDate: "2026-09-22", status: "ready", evidence: "Factory QA photo before correction", resolution: "Re-machined side panel and rechecked 6 mm shadow gap", resolutionBy: actor.membershipId }],
    handovers: [{ id: "handover-villa", area: "Whole villa", title: "Final villa handover", status: "draft", source: "area", documentIds: ["doc-joinery-r2", "doc-finish-schedule"], taskIds: tasks.map((item) => item.id), evidence: "", acceptedBy: "", acceptedAt: "", warrantyUntil: "2027-10-12", outstanding: "Prepare care manuals and final as-built pack", outstandingItems: [{ id: "outstanding-manual", title: "Compile care and maintenance manual", kind: "document", blocking: false, ownerId: actor.membershipId, dueDate: "2026-10-10", status: "open", evidence: "", resolution: "" }], clientApproverId: "", clientReviewDueDate: "2026-10-14", published: false }],
    comments: [{ id: "comment-1", recordId: "task-install-joinery", parentId: "", text: "Coordinate room-by-room access with the client representative before delivery.", author: actor.name, authorId: actor.membershipId, at: "2026-09-18T13:00:00.000Z", resolved: false, mentions: [] }],
    audit: [{ id: "audit-1", at: "2026-09-01T09:30:00.000Z", author: actor.name, action: "Project initiated", recordId: ids.project, note: "Accepted scope, payment plan and delivery dates captured." }, { id: "audit-2", at: "2026-09-18T16:10:00.000Z", author: actor.name, action: "Progress approved", recordId: "report-2026-09-18", note: "Factory progress accepted with veneer follow-up." }],
    processed: [], budget: 385000, forecast: 389800, financeClosed: false, financeEvidence: "",
    dispatches: [{ id: "dispatch-joinery", title: "Dining and living joinery delivery", taskId: "task-tv-unit", receivingTaskId: "task-install-joinery", destination: "Jumeirah Garden Villa", quantity: 1, unit: "lot", dueDate: "2026-09-28", carrier: "Palm Living delivery team", reference: "DSP-0744-01", status: "ready", preparedBy: actor.membershipId, accepted: 0, rejected: 0, receiptEvidence: "" }],
    commissioning: [{ id: "commission-led", title: "Media-wall lighting test", taskId: "task-install-joinery", area: "Living Area", system: "Integrated LED lighting", ownerId: actor.membershipId, dueDate: "2026-10-06", readings: [{ name: "Driver output", value: 24, unit: "V", min: 23, max: 25 }], status: "draft", evidence: "", note: "Test after final installation.", authorId: actor.membershipId }],
    technicalQueries: [{ id: "tq-01", title: "Confirm media-wall power outlet position", taskIds: ["task-tv-unit", "task-install-joinery"], ownerId: actor.membershipId, dueDate: "2026-09-22", question: "Can the final outlet move 80 mm to clear the concealed bracket?", response: "", documentIds: ["doc-joinery-r2"], status: "open", authorId: actor.membershipId }],
    transmittals: [{ id: "tr-01", number: "TR-0744-03", title: "Approved joinery package", recipient: "Client representative and site consultant", dueDate: "2026-09-02", documents: [{ id: "doc-joinery-r2", title: "Joinery coordinated shop drawings", revision: "R2" }], status: "acknowledged", purpose: "For construction", evidence: "Email acknowledgement 2 September", issuedBy: actor.membershipId, issuedAt: "2026-09-01T12:00:00.000Z", acknowledgedAt: "2026-09-02T09:00:00.000Z" }],
  };
  await client.query(`INSERT INTO project_execution(project_id,workspace_id,revision,content,updated_at) VALUES($1,$2,18,$3::jsonb,now())
    ON CONFLICT(project_id) DO UPDATE SET revision=18,content=excluded.content,updated_at=now()`, [ids.project, workspace.id, JSON.stringify(content)]);

  const resourceCalendar = JSON.stringify({ weekdays: [1, 2, 3, 4, 5, 6], startTime: "08:00", endTime: "18:00", holidays: [] });
  await client.query(`INSERT INTO project_resources(id,workspace_id,name,kind,members,active,calendar,business_unit_id,capacity_mode,capacity,timezone,updated_by)
    VALUES($1,$3,'Palm Living Joinery Factory','factory',$5,true,$7::jsonb,$4,'pooled',3,'Asia/Dubai',$6),($2,$3,'Installation Crew A','crew',$5,true,$7::jsonb,$8,'exclusive',1,'Asia/Dubai',$6)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=true,calendar=excluded.calendar,business_unit_id=excluded.business_unit_id,updated_by=excluded.updated_by`,
    [ids.factory, ids.installCrew, workspace.id, productionUnit, [actor.membershipId], actor.userId, resourceCalendar, siteUnit]);
  const bookings = [
    [ids.factoryBooking, ids.project, "task-dining-production", ids.factory, "2026-09-19", "2026-09-22", [{ date: "2026-09-19", endDate: "2026-09-22", startTime: "08:00", endTime: "17:00" }], 2, "Factory slot confirmed through QA completion."],
    [ids.siteBooking, ids.project, "task-install-joinery", ids.installCrew, "2026-09-28", "2026-10-05", [{ date: "2026-09-28", endDate: "2026-10-05", startTime: "08:00", endTime: "17:00" }], 1, "Client access window confirmed."],
  ];
  for (const [id, projectId, taskId, resourceId, startsOn, endsOn, slots, unitsBooked, acknowledgement] of bookings) {
    await client.query(`INSERT INTO project_bookings(id,workspace_id,project_id,task_id,resource_id,starts_on,ends_on,status,acknowledgement,member_ids,slots,units,timezone,calendar_snapshot,version,created_by,updated_by,confirmed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10::jsonb,$11,'Asia/Dubai',$12::jsonb,1,$13,$13,now())
      ON CONFLICT(id) DO UPDATE SET starts_on=excluded.starts_on,ends_on=excluded.ends_on,status='confirmed',acknowledgement=excluded.acknowledgement,slots=excluded.slots,units=excluded.units,updated_by=excluded.updated_by`,
      [id, workspace.id, projectId, taskId, resourceId, startsOn, endsOn, acknowledgement, [actor.membershipId], JSON.stringify(slots), unitsBooked, resourceCalendar, actor.userId]);
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ workspaceId: workspace.id, projectId: ids.project, caseId: ids.case, project: "Palm Living Demo · Jumeirah Garden Villa", tasks: tasks.length, materials: content.materials.length, bookings: bookings.length }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
