// Local-only demo data for Planning → Design, on the moodboard demo case (run seed-palm-moodboard first).
// A design journey in the order of 13 Oct 2026 (PLM-140–144) with inspiration and the kick-off done, the concept in
// progress with its design site measure open, and drawings in
// every review state. No rooms are added: the designer files drawings into rooms from the catalog.
// Safe to re-run: fixed ids and upserts.
//   DATABASE_URL=postgresql://…@localhost:5432/wodana PALM_ALLOW_SHARED_LOCAL_SEED=palm-living-demo-only node scripts/seed-palm-design.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
import sharp from "sharp";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "Set DATABASE_URL to the local database.");
assert(["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname), "This seed is local-only.");
assert(process.env.PALM_ALLOW_SHARED_LOCAL_SEED === "palm-living-demo-only", "Opt in with PALM_ALLOW_SHARED_LOCAL_SEED=palm-living-demo-only.");
const storageRoot = resolve(process.env.BRAND_ASSET_STORAGE_DIR ?? ".data/workspace-assets");

const id = (n) => `d2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const caseId = id(5), opportunityId = id(4);

// Drawings rendered as real images: a concept board (swatches) and a floor layout (walls and furniture).
const board = (colors, label) => `<rect width="1200" height="900" fill="#f4f1ec"/>${colors.map((c, i) => `<rect x="${60 + (i % 3) * 370}" y="${80 + Math.floor(i / 3) * 360}" width="340" height="320" rx="10" fill="${c}"/>`).join("")}<text x="60" y="860" font-family="Helvetica" font-size="34" fill="#3b3a36">${label}</text>`;
const layout = (label) => `<rect width="1200" height="900" fill="#ffffff"/><g fill="none" stroke="#2c2c2c" stroke-width="10"><rect x="80" y="80" width="1040" height="680"/><path d="M560 80 V420 M80 420 H380 M760 420 H1120"/></g><g fill="#d9d2c5" stroke="#8a8173" stroke-width="3"><rect x="140" y="140" width="320" height="160" rx="12"/><rect x="640" y="150" width="400" height="90"/><rect x="160" y="520" width="240" height="180" rx="90"/><rect x="820" y="520" width="220" height="160"/></g><text x="80" y="840" font-family="Helvetica" font-size="34" fill="#3b3a36">${label}</text>`;

async function asset(client, ws, userId, n, name, svgBody) {
  const assetId = id(300 + n);
  const original = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">${svgBody}</svg>`)).png().toBuffer();
  const preview = await sharp(original).resize({ width: 640 }).webp({ quality: 82 }).toBuffer();
  const key = `pre-projects/${ws}/${caseId}/${assetId}`;
  for (const [file, body] of [["original", original], ["preview.webp", preview]]) {
    const target = resolve(storageRoot, `${key}/${file}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  await client.query(`INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,preview_key,sha256,created_by)
    VALUES($1,$2,$3,$4,'image/png',$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET byte_size=excluded.byte_size,sha256=excluded.sha256`,
    [assetId, ws, caseId, name, original.length, `${key}/original`, `${key}/preview.webp`, createHash("sha256").update(original).digest("hex"), userId]);
  return assetId;
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const ws = (await client.query(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug='palm-living'`)).rows[0]?.id;
  assert(ws, "The Palm Living workspace is not configured locally.");
  await client.query(`SELECT set_config('app.current_workspace_id',$1,true)`, [ws]);
  assert((await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id=$1 AND id=$2`, [ws, caseId])).rowCount, "Run seed-palm-moodboard.mjs first.");
  const owner = (await client.query(`SELECT m.id AS "membershipId", u.id AS "userId" FROM workspace_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.workspace_id=$1 AND m.status='active' ORDER BY u.primary_email LIKE 'operations@%' DESC, m.joined_at LIMIT 1`, [ws])).rows[0];

  // The dedicated designer (the owner in a single-user demo) and the design journey.
  await client.query(`INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id,assigned_by) VALUES($1,$2,$3,$4)
    ON CONFLICT(workspace_id,opportunity_id) DO NOTHING`, [ws, opportunityId, owner.membershipId, owner.userId]);
  // An existing demo journey keeps the order it was seeded in; a new one runs the current order.
  const journey = await client.query(`INSERT INTO design_journeys(workspace_id,case_id,package_name,included_revisions,includes_space_planning,includes_renders,inspiration_days,site_visit_hours,started_by,started_at,flow_version,render_signoff_due_on)
    VALUES($1,$2,'Bespoke design',2,true,true,7,72,$3,now()-interval '10 days',2,(now()+interval '40 days')::date) ON CONFLICT(workspace_id,case_id) DO NOTHING`, [ws, caseId, owner.userId]);
  const current = journey.rowCount > 0 || (await client.query(`SELECT flow_version AS flow FROM design_journeys WHERE workspace_id=$1 AND case_id=$2`, [ws, caseId])).rows[0]?.flow === 2;
  const stages = current ? [["inspiration", "done"], ["kickoff", "done"], ["concepts", "active"], ["renders", "locked"], ["samples", "locked"], ["approval", "locked"]]
    : [["inspiration", "done"], ["site_visit", "done"], ["concepts", "active"], ["space_planning", "locked"], ["material_selection", "locked"], ["renders", "locked"], ["approval", "locked"]];
  for (const [position, [stage, status]] of stages.entries())
    await client.query(`INSERT INTO design_journey_stages(workspace_id,case_id,stage,position,status,owner_membership_id,started_at,due_at,completed_at)
      VALUES($1,$2,$3,$4,$5::varchar,$6,CASE WHEN $5::varchar<>'locked' THEN now()-interval '9 days' END,CASE WHEN $5::varchar='active' THEN now()+interval '6 days' END,CASE WHEN $5::varchar='done' THEN now()-interval '3 days' END)
      ON CONFLICT DO NOTHING`, [ws, caseId, stage, position + 1, status, owner.membershipId]);
  // PLM-141: the design site measure inside the concept, due 3 days after the kick-off.
  if (current) await client.query(`INSERT INTO design_journey_tasks(workspace_id,case_id,task,stage,owner_membership_id,started_at,due_at)
    VALUES($1,$2,'site_measure','concepts',$3,now()-interval '3 days',now()+interval '1 day') ON CONFLICT DO NOTHING`, [ws, caseId, owner.membershipId]);

  // No rooms are pre-filled: the designer adds them from the catalog (or types one) when filing a drawing.
  // Earlier versions of this seed added three rooms; take them away again if nothing else uses them.
  await client.query(`UPDATE pre_project_designs SET room_id=NULL WHERE workspace_id=$1 AND case_id=$2 AND room_id = ANY($3::uuid[])`, [ws, caseId, [id(41), id(42), id(43)]]);
  await client.query("SAVEPOINT seeded_rooms");
  try {
    await client.query(`DELETE FROM pre_project_rooms WHERE workspace_id=$1 AND id = ANY($2::uuid[])`, [ws, [id(41), id(42), id(43)]]);
    await client.query("RELEASE SAVEPOINT seeded_rooms");
  } catch { await client.query("ROLLBACK TO SAVEPOINT seeded_rooms"); } // still used elsewhere: keep them
  const kitchen = null, living = null, master = null;

  const design = async (n, { title, stage, roomId, type, status, number = 1, svg, due }) => {
    const designId = id(200 + n), assetId = await asset(client, ws, owner.userId, n, `${title}.png`, svg);
    await client.query(`INSERT INTO pre_project_designs(id,workspace_id,case_id,title,document_type,description,room_id,stage,created_by)
      VALUES($1,$2,$3,$4,$5,'',$6,$7,$8) ON CONFLICT(id) DO UPDATE SET title=excluded.title,stage=excluded.stage,room_id=excluded.room_id,archived_at=NULL`, [designId, ws, caseId, title, type, roomId, stage, owner.userId]);
    for (let revision = 1; revision <= number; revision += 1) {
      const latest = revision === number;
      await client.query(`INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,note,created_by,status,reviewer_id,included_client_rounds,client_review_expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'',$7,$8,$9,2,$10) ON CONFLICT(id) DO UPDATE SET status=excluded.status,client_review_expires_at=excluded.client_review_expires_at`,
        [id(250 + n * 3 + revision), ws, caseId, designId, revision, assetId, owner.userId, latest ? status : "changes_requested", ["internal_review", "internal_approved"].includes(status) && latest ? owner.userId : null, latest && due ? new Date(Date.now() + due * 86_400_000).toISOString() : null]);
    }
  };
  await design(1, { title: "Kitchen concept · warm oak", stage: "concepts", roomId: kitchen, type: "Concept / mood board", status: "approved", number: 2, svg: board(["#cdb899", "#e9ddc9", "#8b6e4e", "#f3f1ed", "#5b5a52", "#d9c7a8"], "Kitchen · warm oak") });
  await design(2, { title: "Living room concept", stage: "concepts", roomId: living, type: "Concept / mood board", status: "client_review", svg: board(["#e7e2d8", "#b9a88f", "#7f8c7a", "#ffffff", "#c9bba4", "#44423d"], "Living room · calm stone"), due: 5 });
  await design(3, { title: "Master bedroom concept", stage: "concepts", roomId: master, type: "Concept / mood board", status: "internal_review", svg: board(["#dfe6e4", "#f7faf9", "#cfd9d6", "#a9b7b3", "#6d7775", "#eae4da"], "Master bedroom · soft sage") });
  await design(4, { title: "Kitchen island option", stage: "concepts", roomId: kitchen, type: "Concept / mood board", status: "draft", svg: board(["#3b3a36", "#cdb899", "#f4f1ec", "#8b6e4e", "#b0a58f", "#e9ddc9"], "Kitchen · island option") });
  // The general layout to scale is part of the concept in every package (PLM-139/142).
  await design(5, { title: "Ground floor layout", stage: current ? "concepts" : "space_planning", roomId: living, type: "Space plan / furniture layout", status: "approved", svg: layout("Ground floor · furniture layout") });
  await client.query("COMMIT");
  console.log("Design demo ready: Planning → Jumeirah Garden Villa → Design.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
