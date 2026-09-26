// Local-only demo data for the Planning moodboard: one Palm Living client, an open opportunity, an
// active planning case with rooms and requirements, and a moodboard of photos, links and notes.
// Safe to re-run: fixed ids, upserts, and it only touches the records it owns.
//   DATABASE_URL=postgresql://…@localhost:5432/wodana PALM_ALLOW_SHARED_LOCAL_SEED=palm-living-demo-only node scripts/seed-palm-moodboard.mjs
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
const ids = {
  pipeline: id(1), stage: id(2), party: id(3), opportunity: id(4), case: id(5),
  rooms: { kitchen: id(10), living: id(11), master: id(12) },
  requirements: { cabinets: id(20), wardrobe: id(21), featureWall: id(22), flooring: id(23) },
};

// Material studies rendered as real images (SVG → JPEG + WebP preview).
const scenes = {
  oak: { w: 900, h: 1200, svg: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9ddc9"/><stop offset="1" stop-color="#cdb899"/></linearGradient></defs><rect width="900" height="1200" fill="url(#g)"/>${Array.from({ length: 6 }, (_, i) => `<rect x="${60 + i * 135}" y="620" width="120" height="520" rx="6" fill="${i % 2 ? "#a97c50" : "#b88a5c"}"/><rect x="${110 + i * 135}" y="840" width="20" height="4" fill="#5a3d22"/>`).join("")}<rect x="40" y="560" width="820" height="40" fill="#f5efe6"/><rect x="60" y="120" width="360" height="360" rx="4" fill="#b88a5c"/><rect x="480" y="120" width="360" height="360" rx="4" fill="#a97c50"/>` },
  terrazzo: { w: 1200, h: 900, svg: `<rect width="1200" height="900" fill="#e7e2d8"/>${Array.from({ length: 260 }, (_, i) => { const x = (i * 97) % 1200, y = (i * 53) % 900, r = 4 + ((i * 7) % 14); const c = ["#b9a88f", "#8f8a80", "#c8763f", "#5f6b63", "#f6f2ea"][i % 5]; return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.7}" fill="${c}" transform="rotate(${(i * 37) % 180} ${x} ${y})"/>`; }).join("")}` },
  marble: { w: 900, h: 1100, svg: `<rect width="900" height="1100" fill="#f3f1ed"/>${Array.from({ length: 14 }, (_, i) => `<path d="M${-50 + i * 70} 0 C ${200 + i * 30} ${300 + i * 20}, ${100 + i * 40} ${700 - i * 10}, ${500 + i * 25} 1100" stroke="${i % 3 ? "#cfc8bd" : "#9d968b"}" stroke-width="${1 + (i % 4)}" fill="none" opacity="0.8"/>`).join("")}<rect x="0" y="880" width="900" height="220" fill="#2f2b27" opacity="0.08"/>` },
  fluted: { w: 900, h: 1200, svg: `<defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#dfe6e4"/><stop offset="0.5" stop-color="#f7faf9"/><stop offset="1" stop-color="#cfd9d6"/></linearGradient></defs><rect width="900" height="1200" fill="#3b3a36"/>${Array.from({ length: 30 }, (_, i) => `<rect x="${60 + i * 26}" y="80" width="22" height="1040" fill="url(#f)" opacity="0.92"/>`).join("")}<rect x="60" y="80" width="780" height="1040" fill="none" stroke="#c9a46b" stroke-width="10"/>` },
  glossy: { w: 1200, h: 800, svg: `<defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e8ea"/></linearGradient></defs><rect width="1200" height="800" fill="url(#w)"/>${Array.from({ length: 5 }, (_, i) => `<rect x="${80 + i * 215}" y="160" width="200" height="520" rx="3" fill="#f8f9fa" stroke="#d9dde1"/><rect x="${80 + i * 215}" y="160" width="200" height="60" fill="#ffffff" opacity="0.9"/>`).join("")}` },
};

async function renderAsset(client, workspaceId, userId, n, name, scene) {
  const assetId = id(100 + n);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.w}" height="${scene.h}">${scene.svg}</svg>`);
  const original = await sharp(svg).jpeg({ quality: 86 }).toBuffer();
  const preview = await sharp(original).resize({ width: 640, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const key = `pre-projects/${workspaceId}/${ids.case}/${assetId}`;
  for (const [file, body] of [["original", original], ["preview.webp", preview]]) {
    const target = resolve(storageRoot, `${key}/${file}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
  await client.query(`INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,preview_key,sha256,created_by)
    VALUES($1,$2,$3,$4,'image/jpeg',$5,$6,$7,$8,$9)
    ON CONFLICT(id) DO UPDATE SET byte_size=excluded.byte_size,object_key=excluded.object_key,preview_key=excluded.preview_key,sha256=excluded.sha256`,
    [assetId, workspaceId, ids.case, name, original.length, `${key}/original`, `${key}/preview.webp`, createHash("sha256").update(original).digest("hex"), userId]);
  return assetId;
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const workspace = (await client.query(`SELECT workspace_id AS id FROM tenant_login_branding WHERE login_slug='palm-living'`)).rows[0];
  assert(workspace, "The Palm Living workspace is not configured locally.");
  const ws = workspace.id;
  await client.query(`SELECT set_config('app.current_workspace_id',$1,true)`, [ws]);
  const owner = (await client.query(`SELECT m.id AS "membershipId", u.id AS "userId" FROM workspace_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.workspace_id=$1 AND m.status='active' ORDER BY u.primary_email LIKE 'operations@%' DESC, m.joined_at LIMIT 1`, [ws])).rows[0];
  const designer = (await client.query(`SELECT m.id AS "membershipId" FROM workspace_memberships m JOIN users u ON u.id=m.user_id
    WHERE m.workspace_id=$1 AND m.status='active' AND u.primary_email LIKE 'sara.%' LIMIT 1`, [ws])).rows[0] ?? owner;

  await client.query(`INSERT INTO crm_pipelines(id,workspace_id,code,name,is_default) VALUES($1,$2,'palm_sales','Palm Living Sales',true)
    ON CONFLICT(workspace_id,code) DO UPDATE SET status='active'`, [ids.pipeline, ws]);
  const pipelineId = (await client.query(`SELECT id FROM crm_pipelines WHERE workspace_id=$1 AND code='palm_sales'`, [ws])).rows[0].id;
  await client.query(`INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability,forecast_category)
    VALUES($1,$2,$3,'design_quote','Design Quote',1,40,'pipeline') ON CONFLICT(workspace_id,pipeline_id,code) DO UPDATE SET status='active'`, [ids.stage, ws, pipelineId]);
  const stageId = (await client.query(`SELECT id FROM crm_pipeline_stages WHERE workspace_id=$1 AND pipeline_id=$2 AND code='design_quote'`, [ws, pipelineId])).rows[0].id;

  await client.query(`INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name,lifecycle,owner_membership_id,created_by)
    VALUES($1,$2,'person','Aisha Al Mansoori','aisha al mansoori','prospect',$3,$4)
    ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,status='active'`, [ids.party, ws, owner.membershipId, owner.userId]);
  await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,description,status,amount,currency_code,probability,forecast_category)
    VALUES($1,$2,$3,$4,$5,$6,'Jumeirah Garden Villa · Full Interior','Moodboard demo: warm, calm family villa.','open',385000,'AED',40,'pipeline')
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,status='open'`, [ids.opportunity, ws, ids.party, pipelineId, stageId, owner.membershipId]);
  await client.query(`INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,status,created_by,phase,owner_membership_id,priority,risk_level,activated_at)
    VALUES($1,$2,$3,'active',$4,'design',$5,'high','low',now())
    ON CONFLICT(id) DO UPDATE SET status='active',phase='design'`, [ids.case, ws, ids.opportunity, owner.userId, owner.membershipId]);
  await client.query(`INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [ws, ids.opportunity, designer.membershipId]);

  for (const [key, name] of [["kitchen", "Kitchen"], ["living", "Living room"], ["master", "Master bedroom"]])
    await client.query(`INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name`, [ids.rooms[key], ws, ids.case, name]);

  const entry = async (entryId, fields) => {
    const f = { roomId: null, note: "", category: "General", priority: "preferred", scopeStatus: "included", reviewStatus: "captured", quantity: null, unit: "nos", referenceUrl: "", avoid: "", source: "team", ...fields };
    await client.query(`INSERT INTO pre_project_brief_entries(workspace_id,case_id,id,kind,title,room_id,note,category,priority,scope_status,review_status,quantity,unit,reference_url,avoid,source,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,room_id=excluded.room_id,note=excluded.note,reference_url=excluded.reference_url,source=excluded.source,archived_at=NULL`,
      [ws, ids.case, entryId, f.kind, f.title, f.roomId, f.note, f.category, f.priority, f.scopeStatus, f.reviewStatus, f.quantity, f.unit, f.referenceUrl, f.avoid, f.source, owner.userId]);
  };
  await entry(ids.requirements.cabinets, { kind: "requirement", title: "Kitchen cabinets, full height", roomId: ids.rooms.kitchen, priority: "must_have", quantity: 1 });
  await entry(ids.requirements.wardrobe, { kind: "requirement", title: "Walk-in wardrobe", roomId: ids.rooms.master, priority: "must_have", quantity: 1 });
  await entry(ids.requirements.featureWall, { kind: "requirement", title: "Living room feature wall", roomId: ids.rooms.living });
  await entry(ids.requirements.flooring, { kind: "requirement", title: "Ground floor flooring", note: "About 180 m²." });

  const pins = [
    { n: 1, kind: "photo", scene: "oak", title: "Warm oak kitchen", room: "kitchen", source: "client", links: ["cabinets"], at: [0, 0, 300], feeling: "love", note: "This warmth, but with slimmer handles." },
    { n: 2, kind: "photo", scene: "terrazzo", title: "Terrazzo floor", room: "living", links: ["flooring"], at: [680, 360, 320], feeling: "love" },
    { n: 3, kind: "photo", scene: "marble", title: "Soft marble island", room: "kitchen", source: "client", links: ["cabinets"], at: [340, 0, 260], feeling: "love" },
    { n: 4, kind: "photo", scene: "fluted", title: "Fluted glass wardrobe doors", room: "master", source: "client", links: ["wardrobe"], at: [1040, 0, 260], feeling: "love" },
    { n: 5, kind: "photo", scene: "glossy", title: "High-gloss white", room: "kitchen", source: "client", at: [640, 0, 360], feeling: "avoid", note: "Feels cold and shows fingerprints." },
    { n: 6, kind: "link", title: "Calm villa kitchen reel", url: "https://www.instagram.com/p/C9xAmPLe0aB/", room: "kitchen", source: "client", at: [0, 460, 260], feeling: "love" },
    { n: 7, kind: "link", title: "Walk-in wardrobe ideas", url: "https://www.pinterest.com/pin/1234567890/", room: "master", links: ["wardrobe"], at: [1040, 480, 260], feeling: "love" },
    { n: 8, kind: "link", title: "Villa tour: quiet luxury", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", at: [300, 460, 260], feeling: "love" },
    { n: 9, kind: "note", title: "Keep the arch", note: "Keep the existing arch between living and dining, and frame it with a warm cove light.", room: "living", links: ["featureWall"], at: [340, 620, 280], feeling: "love" },
    { n: 10, kind: "note", title: "No open shelving", note: "Client doesn't want open shelves in the kitchen: dust and clutter.", room: "kitchen", source: "client", at: [0, 700, 260], feeling: "avoid" },
  ];
  for (const pin of pins) {
    const entryId = id(200 + pin.n);
    await entry(entryId, { kind: "inspiration", category: "Inspiration", title: pin.title, note: pin.note ?? "", roomId: pin.room ? ids.rooms[pin.room] : null, referenceUrl: pin.url ?? "", source: pin.source ?? "team" });
    await client.query(`DELETE FROM pre_project_entry_assets WHERE workspace_id=$1 AND entry_id=$2`, [ws, entryId]);
    if (pin.kind === "photo") {
      const assetId = await renderAsset(client, ws, owner.userId, pin.n, `${pin.title}.jpg`, scenes[pin.scene]);
      await client.query(`INSERT INTO pre_project_entry_assets(workspace_id,case_id,entry_id,asset_id) VALUES($1,$2,$3,$4)`, [ws, ids.case, entryId, assetId]);
    }
    await client.query(`DELETE FROM pre_project_entry_requirement_links WHERE workspace_id=$1 AND entry_id=$2`, [ws, entryId]);
    for (const link of pin.links ?? [])
      await client.query(`INSERT INTO pre_project_entry_requirement_links(workspace_id,case_id,entry_id,requirement_id) VALUES($1,$2,$3,$4)`, [ws, ids.case, entryId, ids.requirements[link]]);
    const [x, y, width] = pin.at;
    await client.query(`INSERT INTO pre_project_moodboard_pins(workspace_id,case_id,entry_id,x,y,width,z,sentiment,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(workspace_id,entry_id) DO UPDATE SET x=excluded.x,y=excluded.y,width=excluded.width,z=excluded.z,sentiment=excluded.sentiment`,
      [ws, ids.case, entryId, x, y, width, pin.n, pin.feeling, owner.userId]);
  }
  await client.query("COMMIT");
  console.log(`Moodboard demo ready: /workspace/pre-projects/cases/${ids.case}/inspiration`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
