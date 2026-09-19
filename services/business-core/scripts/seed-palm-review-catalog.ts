import assert from "node:assert/strict";
import pg from "pg";
import { CATALOG_STARTER, STARTER_VERSION, starterId } from "../src/catalog/catalog-starter";

const databaseUrl = process.env.DATABASE_URL;
assert(databaseUrl, "Set DATABASE_URL to the local Palm review database.");
const target = new URL(databaseUrl);
assert(!target.hostname || ["127.0.0.1", "localhost"].includes(target.hostname), "Palm review seed is local-only.");
assert(target.pathname.includes("palm_review"), "Use a dedicated palm_review database.");

const preferredCatalogId = "d3000000-0000-4000-8000-000000000001";
async function main() {
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  const workspace = (await client.query<{ id: string }>("SELECT id FROM workspaces WHERE slug=$1", [process.env.PALM_REVIEW_WORKSPACE_SLUG ?? "palm-living"])).rows[0];
  assert(workspace, "Palm Living workspace is not configured.");
  await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspace.id]);
  const actor = (await client.query<{ userId: string }>(`SELECT app_user.id AS "userId" FROM workspace_memberships membership JOIN users app_user ON app_user.id=membership.user_id WHERE membership.workspace_id=$1 AND membership.status='active' ORDER BY membership.joined_at LIMIT 1`, [workspace.id])).rows[0];
  assert(actor, "Palm Living needs an active workspace member.");

  const existingCatalog = (await client.query<{ id: string }>(`SELECT id FROM workspace_catalog_records WHERE workspace_id=$1 AND kind='catalog_group' AND lower(name)=lower('Palm Living Core Collection') LIMIT 1`, [workspace.id])).rows[0];
  const catalogId = existingCatalog?.id ?? preferredCatalogId;
  if (!existingCatalog) await client.query(`INSERT INTO workspace_catalog_records(workspace_id,id,kind,code,name,content,created_by,updated_by,catalog_id)
    VALUES($1,$2,'catalog_group','PALM_CORE','Palm Living Core Collection',$3::jsonb,$4,$4,NULL)
    ON CONFLICT(workspace_id,id) DO UPDATE SET name=excluded.name,archived=false,updated_by=excluded.updated_by,updated_at=now()`, [workspace.id, catalogId, JSON.stringify({ description: "Palm Living rooms, items, materials, units and execution references.", market: "AE", aliases: [], attributes: [], sizes: [], sources: [], links: [], specificationStatus: "reference", dimension: "none" }), actor.userId]);

  const existingRecords = (await client.query<{ id: string; kind: string; code: string }>(`SELECT id,kind,code FROM workspace_catalog_records WHERE workspace_id=$1 AND catalog_id=$2`, [workspace.id, catalogId])).rows;
  const existingIds = new Map(existingRecords.map((record) => [`${record.kind}:${record.code}`, record.id]));
  const ids = new Map(CATALOG_STARTER.map((record) => [record.id, existingIds.get(`${record.kind}:${record.code}`) ?? starterId(`catalog:${catalogId}:${record.kind}:${record.code}`)]));
  let created = 0;
  for (const record of CATALOG_STARTER) {
    const { id: _id, version: _version, kind, code, name, catalogId: _catalog, ...content } = record;
    const mapped = { ...content, links: record.links.map((link) => ({ ...link, targetId: ids.get(link.targetId) })) };
    const result = await client.query(`INSERT INTO workspace_catalog_records(workspace_id,id,kind,code,name,content,starter_version,created_by,updated_by,catalog_id)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8,$9) ON CONFLICT(workspace_id,id) DO NOTHING`, [workspace.id, ids.get(record.id), kind, code, name, JSON.stringify(mapped), STARTER_VERSION, actor.userId, catalogId]);
    created += result.rowCount ?? 0;
  }
  for (const record of CATALOG_STARTER) {
    const recordId = ids.get(record.id)!;
    for (const link of record.links) {
      const targetId = ids.get(link.targetId);
      assert(targetId, `Starter link target is missing: ${record.name} → ${link.targetId}`);
      await client.query(`INSERT INTO workspace_catalog_links(workspace_id,record_id,relation,target_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [workspace.id, recordId, link.relation, targetId]);
    }
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ workspaceId: workspace.id, catalogId, created, available: CATALOG_STARTER.length }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
