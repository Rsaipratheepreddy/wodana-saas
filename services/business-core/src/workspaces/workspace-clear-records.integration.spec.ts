import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { DatabaseService } from "../database/database.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { ProjectCoreService } from "../project-core/project-core.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { WorkspaceAccessService } from "./workspace-access.service";
import {
  WORKSPACE_CLEAR_LINKED_TABLES,
  WORKSPACE_CLEARED_FILE_COLUMNS,
  WORKSPACE_TABLE_CLASSIFICATION,
} from "./workspace-clear-records.classification";
import { WorkspaceClearRecordsService } from "./workspace-clear-records.service";
import { WorkspaceObjectCleanupService } from "./workspace-object-cleanup.service";
import { WorkspacesService } from "./workspaces.service";

// Real PostgreSQL: two provisioned tenants with records across the funnel, delivery, purchasing, stock, catalogue,
// HR, inbox and files. The clear runs as the app role (forced RLS applies). Rows are committed; every row this
// suite creates is removed afterwards.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const MANAGE = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage"];

type Tenant = { externalTenantId: string; slug: string; workspaceId: string; ownerUserId: string; ownerMembershipId: string; ownerEmail: string };

integration("go-live reset: workspace_clear_records", () => {
  const run = randomUUID().slice(0, 8);
  const operatorId = randomUUID();
  const operatorEmail = `operator-${run}@clear-records.test`;
  const tenants: Tenant[] = [];
  let owner: Pool;
  let db: DatabaseService;
  let workspaces: WorkspacesService;
  let clearer: WorkspaceClearRecordsService;

  const tenantTables = () => [...WORKSPACE_TABLE_CLASSIFICATION.keys()].sort();

  /** One row-set fingerprint per tenant table, read as the owner (no RLS), so "unchanged" means byte-for-byte. */
  async function fingerprint(workspaceId: string, tables = tenantTables(), strip: Record<string, string[]> = {}) {
    const result: Record<string, string> = {};
    for (const table of tables) {
      const removed = (strip[table] ?? []).map((column) => ` - '${column}'`).join("");
      const row = await owner.query<{ hash: string; count: number }>(
        `SELECT count(*)::int AS count, md5(coalesce(string_agg(value, '|' ORDER BY value), '')) AS hash
           FROM (SELECT (to_jsonb(t)${removed})::text AS value FROM ${table} t WHERE t.workspace_id = $1) rows`, [workspaceId]);
      result[table] = `${row.rows[0].count}:${row.rows[0].hash}`;
    }
    return result;
  }

  async function count(workspaceId: string, table: string) {
    const predicate = WORKSPACE_CLEAR_LINKED_TABLES[table];
    return (await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1${predicate ? ` AND (${predicate})` : ""}`, [workspaceId])).rows[0].count;
  }

  async function asTenant<T>(workspaceId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Palm's journey, reduced: enquiry → opportunity → won → case → quote → accepted → project started. */
  async function palmFlow(tenant: Tenant, title: string) {
    return asTenant(tenant.workspaceId, async (client) => {
      const { workspaceId, ownerUserId, ownerMembershipId } = tenant;
      const user = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const member = (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: ownerUserId });
      const access = { asMember: member, withPermission: user(ownerUserId), withPermissions: user(ownerUserId), withAnyPermission: user(ownerUserId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => MANAGE.includes(code) } as never;
      if (!(await client.query("SELECT 1 FROM notification_templates WHERE workspace_id = $1 LIMIT 1", [workspaceId])).rowCount)
        await seedDefaultNotificationTemplates(client, workspaceId);

      const entity = (await client.query<{ id: string }>("SELECT id FROM legal_entities WHERE workspace_id = $1 ORDER BY created_at LIMIT 1", [workspaceId])).rows[0];
      let pipeline = (await client.query<{ id: string; stage: string }>(
        `SELECT pipeline.id, stage.id AS stage FROM crm_pipelines pipeline JOIN crm_pipeline_stages stage ON stage.pipeline_id = pipeline.id
          WHERE pipeline.workspace_id = $1 AND pipeline.code = 'clear_flow' AND stage.code = 'won'`, [workspaceId])).rows[0];
      if (!pipeline) {
        const id = randomUUID(), stage = randomUUID();
        await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name,is_default) VALUES($1,$2,'clear_flow','Go-live flow',false)", [id, workspaceId]);
        await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'won','Won',1)", [stage, workspaceId, id]);
        pipeline = { id, stage };
      }
      const party = randomUUID(), intake = randomUUID(), enquiryId = randomUUID(), opportunityId = randomUUID();
      const caseId = randomUUID(), quoteId = randomUUID(), room = randomUUID();
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person',$3,$4)", [party, workspaceId, `${title} client`, `${title} client`.toLowerCase()]);
      await client.query("INSERT INTO crm_contact_points(workspace_id,party_id,type,raw_value,normalized_value,is_primary) VALUES($1,$2,'phone','+15550100','+15550100',true)", [workspaceId, party]);
      await client.query(`INSERT INTO crm_intake_events(id,workspace_id,source,channel,intake_method,idempotency_key,payload_hash,original_payload,correlation_id,received_at)
        VALUES($1,$2,'website','web_form','manual',$3,repeat('a',64),'{}',$4,now())`, [intake, workspaceId, `intake-${intake}`, randomUUID()]);
      const enquiry = (await client.query<{ reference: string }>(`INSERT INTO crm_enquiries(id,workspace_id,intake_event_id,party_id,title,source,channel,received_at)
        VALUES($1,$2,$3,$4,$5,'website','web_form',now()) RETURNING reference`, [enquiryId, workspaceId, intake, party, title])).rows[0];
      await client.query("INSERT INTO crm_leads(workspace_id,enquiry_id,party_id) VALUES($1,$2,$3)", [workspaceId, enquiryId, party]);
      const opportunity = (await client.query<{ reference: string }>(`INSERT INTO crm_opportunities(id,workspace_id,legal_entity_id,party_id,pipeline_id,stage_id,title,status,amount,currency_code)
        VALUES($1,$2,$3,$4,$5,$6,$7,'won',4000,'USD') RETURNING reference`, [opportunityId, workspaceId, entity.id, party, pipeline.id, pipeline.stage, title])).rows[0];
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, ownerUserId]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [room, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency)
        VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','USD')`, [workspaceId, caseId, quoteId]);
      const builder = new QuotationBuilderService(access, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [{ op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4", rate: "1000", areaId: room } }] });
      const loaded = (await commercialRepository.load(client, workspaceId, caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision + 1 };
      const quote = data.quotes.find((item) => item.id === quoteId)!;
      quote.status = "accepted";
      quote.hash = freezeHash(quote);
      quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 4000, optionsTotal: 0, acceptedTotal: 4000,
        decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Client", method: "signed_document", recordedBy: "Owner" };
      data.agreement = { quoteId, quoteHash: quote.hash, reference: `AG-${title}`, terms: "", evidence: "signed.pdf", evidenceKind: "operational",
        status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Owner" };
      data.payments = [{ id: "p1", sourceQuoteId: quoteId, title: "Advance", amount: 4000, dueDate: "", requiredForRelease: true, requiredForProduction: false,
        status: "verified", proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" }];
      await commercialRepository.save(client, workspaceId, caseId, data);

      const core = new ProjectCoreService(access);
      const existing = (await client.query<{ id: string }>("SELECT id FROM project_templates WHERE workspace_id = $1 AND name = 'Go-live route'", [workspaceId])).rows[0];
      const templateId = existing?.id ?? (await core.saveTemplate(actor, workspaceId, { name: "Go-live route", isDefault: true, stages: [
        { name: "Kickoff", ownerRole: "project_manager", checks: [{ kind: "lead_assigned" }] },
        { name: "Handover", ownerRole: "project_manager", checks: [{ kind: "confirm", label: "Keys handed over" }] },
      ] })).templates.find((template: { name: string }) => template.name === "Go-live route")!.id;
      const { projectId } = await core.start(actor, workspaceId, caseId, { quoteId, leadMembershipId: ownerMembershipId, templateId });
      const project = (await client.query<{ reference: string }>("SELECT reference FROM delivery_projects WHERE workspace_id = $1 AND id = $2", [workspaceId, projectId])).rows[0];
      return { enquiry: enquiry.reference, opportunity: opportunity.reference, project: project.reference, projectId, caseId, party };
    });
  }

  /** Records beyond the funnel: merged parties, inbox, catalogue with files, stock with its ledger, purchasing,
   *  invoices, HR, notifications. Also the kept things that point at them (branding file, gallery, warehouse). */
  async function moreRecords(tenant: Tenant, flow: { projectId: string; caseId: string; party: string }) {
    return asTenant(tenant.workspaceId, async (client) => {
      const { workspaceId, ownerUserId, ownerMembershipId } = tenant;
      const merged = randomUUID();
      await client.query(`INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name,status,merged_into_party_id)
        VALUES($1,$2,'person','Duplicate','duplicate','merged',$3)`, [merged, workspaceId, flow.party]);
      const chat = randomUUID();
      await client.query("INSERT INTO crm_conversations(id,workspace_id,channel,party_id) VALUES($1,$2,'whatsapp',$3)", [chat, workspaceId, flow.party]);
      await client.query("INSERT INTO crm_messages(workspace_id,conversation_id,direction,sender_type,body_text) VALUES($1,$2,'inbound','party','Hello')", [workspaceId, chat]);
      await client.query("INSERT INTO crm_activities(workspace_id,type,title,party_id) VALUES($1,'call','First call',$2)", [workspaceId, flow.party]);
      await client.query(`INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,body,idempotency_key,correlation_id)
        VALUES($1,'user',$2,'in_app','A note',$3,$4)`, [workspaceId, ownerUserId, `note-${randomUUID()}`, randomUUID()]);

      // Catalogue: an item with an image (its file is the record's); the gallery shows it; the brand logo is kept.
      let catalog = (await client.query<{ id: string }>("SELECT id FROM catalogs WHERE workspace_id = $1 LIMIT 1", [workspaceId])).rows[0]?.id;
      if (!catalog) {
        catalog = randomUUID();
        await client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'main','Main catalogue')", [catalog, workspaceId]);
      }
      const item = randomUUID(), image = randomUUID();
      await client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code) VALUES($1,$2,$3,$4,'Oak table','product','nos')",
        [item, workspaceId, catalog, `T-${item.slice(0, 6)}`]);
      const imageKey = `catalog-items/${workspaceId}/${item}/${image}/original`;
      await client.query(`INSERT INTO catalog_item_images(id,workspace_id,item_id,original_name,mime_type,byte_size,object_key,sha256)
        VALUES($1,$2,$3,'table.png','image/png',10,$4,repeat('a',64))`, [image, workspaceId, item, imageKey]);
      const brandKey = `workspace-branding/${workspaceId}/${randomUUID()}`;
      await client.query(`INSERT INTO workspace_brand_assets(workspace_id,object_key,original_filename,mime_type,expected_byte_size,created_by,upload_expires_at)
        VALUES($1,$2,'logo.png','image/png',10,$3,now() + interval '1 day')`, [workspaceId, brandKey, ownerUserId]);
      for (const key of [imageKey, brandKey])
        await client.query(`INSERT INTO workspace_stored_objects(workspace_id,object_key,byte_size,content_type,status,scanner_status)
          VALUES($1,$2,10,'image/png','active','baseline_passed')`, [workspaceId, key]);
      await client.query("INSERT INTO workspace_gallery_items(id,workspace_id,kind,title,catalog_item_id) VALUES($1,$2,'product','Oak table',$3)", [randomUUID(), workspaceId, item]);

      // Stock: the warehouse is configuration, the project's site store is a record; movements are append-only.
      const warehouse = randomUUID(), site = randomUUID(), stockItem = randomUUID();
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name) VALUES($1,$2,'warehouse','Main store')", [warehouse, workspaceId]);
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name,project_id) VALUES($1,$2,'site','Site store',$3)", [site, workspaceId, flow.projectId]);
      await client.query("INSERT INTO stock_items(id,workspace_id,catalog_item_id,name,unit,normal_key) VALUES($1,$2,$3,'Oak table','nos',$4)", [stockItem, workspaceId, item, `oak-${item}`]);
      await client.query(`INSERT INTO stock_movements(id,workspace_id,batch_id,item_id,location_id,kind,quantity,moved_on,actor_id,reason)
        VALUES($1,$2,$3,$4,$5,'adjust',2,current_date,$6,'Opening count')`, [randomUUID(), workspaceId, randomUUID(), stockItem, warehouse, ownerUserId]);

      // Purchasing and an issued invoice (never deletable in normal use).
      const vendor = randomUUID();
      await client.query("INSERT INTO workspace_vendors(workspace_id,id,code,display_name,created_by,updated_by) VALUES($1,$2,$3,'Timber Co',$4,$4)",
        [workspaceId, vendor, `V-${vendor.slice(0, 6).toUpperCase()}`, ownerUserId]);
      const entity = (await client.query<{ id: string }>("SELECT id FROM legal_entities WHERE workspace_id = $1 ORDER BY created_at LIMIT 1", [workspaceId])).rows[0].id;
      const order = randomUUID();
      await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,payment_terms,created_by)
        VALUES($1,$2,$3,$4,$5,'USD','upfront',$6)`, [order, workspaceId, `PO-${order.slice(0, 6)}`, entity, vendor, ownerUserId]);
      await client.query(`INSERT INTO purchase_order_lines(id,workspace_id,order_id,source,description,quantity,unit_price,net,tax,total,project_id)
        VALUES($1,$2,$3,'free','Oak boards',1,100,100,0,100,$4)`, [randomUUID(), workspaceId, order, flow.projectId]);
      await client.query(`INSERT INTO client_invoices(id,workspace_id,legal_entity_id,project_id,case_id,payment_id,quote_id,number,issue_date,due_date,currency,net,tax,total,
          prices_include_tax,milestone_title,customer_name,company_name,issued_by)
        VALUES($1,$2,$3,$4,$5,'p1','q',$6,current_date,current_date,'USD',100,0,100,false,'Advance','Client','Studio',$7)`,
        [randomUUID(), workspaceId, entity, flow.projectId, flow.caseId, `INV-${randomUUID().slice(0, 6)}`, ownerUserId]);

      // HR: a site worker (with a document) is cleared with the suppliers; staff documents stay.
      const worker = randomUUID(), workerKey = `hrms/${workspaceId}/documents/${randomUUID()}`;
      await client.query("INSERT INTO hrms_workers(id,workspace_id,name,trade) VALUES($1,$2,'Ravi','carpentry')", [worker, workspaceId]);
      await client.query(`INSERT INTO hrms_documents(id,workspace_id,worker_id,kind,title,created_by,object_key,file_name)
        VALUES($1,$2,$3,'identity','Worker ID',$4,$5,'id.pdf')`, [randomUUID(), workspaceId, worker, ownerUserId, workerKey]);
      await client.query(`INSERT INTO hrms_documents(id,workspace_id,membership_id,kind,title,created_by)
        VALUES($1,$2,$3,'licence','Staff contract',$4)`, [randomUUID(), workspaceId, ownerMembershipId, ownerUserId]);
      return { imageKey, brandKey, workerKey };
    });
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    owner = new Pool({ connectionString: url.toString() });
    if ((await owner.query("SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app'")).rowCount) url.searchParams.set("options", "-c role=wodana_app");
    const config = new ConfigService({ DATABASE_URL: url.toString(), WEB_ORIGIN: "http://localhost:3108" });
    db = new DatabaseService(config);
    const identities = { resolveActor: async () => ({ ...(actor as object), userId: operatorId }) };
    workspaces = new WorkspacesService(db, identities as never, new WorkspaceAccessService(db, identities as never), {} as never,
      { sendWorkspaceInvitation: async () => ({ status: "not_configured", provider: null, messageId: null }) } as never);
    clearer = new WorkspaceClearRecordsService(db);
    await owner.query("INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'Operator')", [operatorId, operatorEmail]);
    for (const label of ["a", "b"]) {
      const slug = `clear-${label}-${run}`;
      const ownerEmail = `owner-${label}-${run}@clear-records.test`;
      const provisioned = await workspaces.provisionTenant({
        externalTenantId: slug, name: `Clear ${label} ${run}`, slug, defaultCurrency: "USD", defaultLocale: "en-US", defaultTimezone: "UTC",
        unitSystem: "metric", weekStartsOn: 1,
        firstLegalEntity: { code: "CL", displayName: "Clear Studio", registeredName: "Clear Studio Ltd", countryCode: "US", baseCurrency: "USD", locale: "en-US", timezone: "UTC" },
        owner: { email: ownerEmail, displayName: "Owner Person" },
      } as never, `clear-${label}-${run}-key`, operatorId);
      const workspaceId = String((provisioned as { workspace: { id: string } }).workspace.id);
      const ownerUserId = (await owner.query<{ id: string }>("SELECT id FROM users WHERE primary_email = $1", [ownerEmail])).rows[0].id;
      const membership = (await owner.query<{ id: string }>(
        "INSERT INTO workspace_memberships (workspace_id, user_id, status, joined_at) VALUES ($1, $2, 'active', now()) RETURNING id", [workspaceId, ownerUserId])).rows[0].id;
      await owner.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) SELECT $1, $2, id FROM roles WHERE workspace_id = $1 AND code = 'owner'", [workspaceId, membership]);
      await owner.query("UPDATE workspace_invitations SET status = 'accepted', accepted_at = now() WHERE workspace_id = $1", [workspaceId]);
      tenants.push({ externalTenantId: slug, slug, workspaceId, ownerUserId, ownerMembershipId: membership, ownerEmail });
    }
  }, 60_000);

  afterAll(async () => {
    await db?.onModuleDestroy();
    if (!owner) return;
    const ids = tenants.map((tenant) => tenant.workspaceId);
    const client = await owner.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixture teardown only
      const tables = await client.query<{ table: string }>(
        `SELECT DISTINCT columns.table_name AS table FROM information_schema.columns columns
           JOIN information_schema.tables tables ON tables.table_name = columns.table_name
            AND tables.table_schema = columns.table_schema AND tables.table_type = 'BASE TABLE'
          WHERE columns.table_schema = 'public' AND columns.column_name = 'workspace_id'`);
      const accounts = await client.query<{ id: string }>("SELECT account_id AS id FROM customer_account_organizations WHERE workspace_id = ANY($1::uuid[])", [ids]);
      for (const { table } of tables.rows) await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [ids]);
      const accountIds = accounts.rows.map((row) => row.id);
      for (const table of ["customer_account_memberships", "customer_account_contracts", "account_contract_versions",
        "account_billing_document_events", "account_billing_documents", "account_collection_state_versions", "account_entitlement_versions", "account_usage_snapshots"])
        await client.query(`DELETE FROM ${table} WHERE account_id = ANY($1::uuid[])`, [accountIds]);
      await client.query("DELETE FROM customer_accounts WHERE id = ANY($1::uuid[])", [accountIds]);
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM platform_operator_audit WHERE actor_user_id = $1 OR target_id = ANY($2::text[])", [operatorId, tenants.map((tenant) => tenant.externalTenantId)]);
      await client.query("DELETE FROM users WHERE id = $1 OR primary_email = ANY($2::text[])", [operatorId, tenants.map((tenant) => tenant.ownerEmail)]);
      await client.query("COMMIT");
    } finally {
      client.release();
      await owner.end();
    }
  }, 60_000);

  it("counts on a dry run, clears in one go, keeps configuration and the other tenant, and the journey runs again", async () => {
    const [a, b] = tenants;
    const flowA = await palmFlow(a, "Villa one");
    await palmFlow(a, "Villa two");
    const files = await moreRecords(a, flowA);
    const flowB = await palmFlow(b, "Other villa");
    await moreRecords(b, flowB);
    expect(flowA).toMatchObject({ enquiry: "E-0001", opportunity: expect.stringMatching(/-0001$/) });

    // Every classified table exists and every tenant table is classified (the SQL function would refuse otherwise).
    const live = await owner.query<{ table: string }>(
      `SELECT relation.relname AS table FROM pg_class relation
        WHERE relation.relnamespace = 'public'::regnamespace AND relation.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute attribute WHERE attribute.attrelid = relation.oid AND attribute.attname = 'workspace_id' AND NOT attribute.attisdropped)
        ORDER BY 1`);
    expect(live.rows.map((row) => row.table)).toEqual(tenantTables());
    // Every column of a cleared table that holds a storage key is collected.
    const keyColumns = await owner.query<{ table: string; column: string }>(
      `SELECT table_name AS table, column_name AS column FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~ '^(object_key|preview_key|storage_key|file_key|receipt_key|image_key|image_preview_key|photo_object_key)$'`);
    for (const { table, column } of keyColumns.rows) {
      const disposition = WORKSPACE_TABLE_CLASSIFICATION.get(table);
      if (disposition === "clear" || disposition === "clear_linked") expect(WORKSPACE_CLEARED_FILE_COLUMNS[table] ?? [], `${table}.${column}`).toContain(column);
    }

    const beforeA = await fingerprint(a.workspaceId);
    const galleryStripped = { workspace_gallery_items: ["catalog_item_id", "version", "updated_at"] };
    const galleryBefore = await fingerprint(a.workspaceId, ["workspace_gallery_items"], galleryStripped);
    const beforeB = await fingerprint(b.workspaceId);
    const toClear = [...WORKSPACE_TABLE_CLASSIFICATION].filter(([, disposition]) => disposition !== "keep" && disposition !== "files").map(([table]) => table);
    const expected: Record<string, number> = {};
    for (const table of toClear) {
      const rows = await count(a.workspaceId, table);
      if (rows) expected[table] = rows;
    }
    for (const table of ["crm_leads", "crm_opportunities", "pre_project_cases", "commercial_quotes", "delivery_projects", "project_stages", "purchase_orders",
      "stock_movements", "client_invoices", "catalog_items", "crm_messages", "hrms_workers", "stock_locations", "hrms_documents", "crm_enquiry_counters"])
      expect(expected[table], table).toBeGreaterThan(0);

    // The wrong slug is refused; a dry run counts and changes nothing.
    await expect(clearer.clear(a.externalTenantId, { confirmSlug: b.slug, dryRun: false }, operatorId)).rejects.toThrow(/does not match/);
    const preview = await clearer.clear(a.externalTenantId, { confirmSlug: a.slug }, operatorId);
    expect(preview).toMatchObject({ dryRun: true, runId: null, objectKeys: 2 });
    expect(Object.fromEntries(preview.tables.filter((row) => row.disposition !== "files").map((row) => [row.table, row.rows]))).toEqual(expected);
    expect(await fingerprint(a.workspaceId)).toEqual(beforeA);

    const applied = await clearer.clear(a.externalTenantId, { confirmSlug: a.slug, dryRun: false }, operatorId);
    expect(applied).toMatchObject({ dryRun: false, runId: expect.any(String), objectKeys: 2 });
    expect(Object.fromEntries(applied.tables.filter((row) => row.disposition !== "files").map((row) => [row.table, row.rows]))).toEqual(expected);

    // Nothing left to clear.
    for (const table of toClear) expect(await count(a.workspaceId, table), table).toBe(0);
    // Kept tables are unchanged, except the audit trail (one new event) and the storage queue; a gallery item
    // loses only its link to the cleared catalogue item.
    const keep = [...WORKSPACE_TABLE_CLASSIFICATION].filter(([table, disposition]) => disposition === "keep"
      && !["audit_events", "workspace_object_cleanup_queue", "workspace_gallery_items"].includes(table)).map(([table]) => table);
    expect(await fingerprint(a.workspaceId, keep)).toEqual(Object.fromEntries(keep.map((table) => [table, beforeA[table]])));
    expect(await fingerprint(a.workspaceId, ["workspace_gallery_items"], galleryStripped)).toEqual(galleryBefore);
    expect((await owner.query("SELECT catalog_item_id FROM workspace_gallery_items WHERE workspace_id = $1", [a.workspaceId])).rows).toEqual([{ catalog_item_id: null }]);
    const audit = await owner.query<{ actor: string; after: { rowsDeleted: number; objectKeysQueued: number; tables: Record<string, number> } }>(
      "SELECT actor_user_id AS actor, after FROM audit_events WHERE workspace_id = $1 AND action = 'workspace.records_cleared'", [a.workspaceId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor: operatorId, after: { objectKeysQueued: 2, rowsDeleted: applied.rows } });
    expect(audit.rows[0].after.tables.crm_leads).toBe(expected.crm_leads);
    // The append-only guards are back on.
    const disabled = await owner.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'");
    expect(disabled.rows).toEqual([]);

    // Staff, staff documents, the warehouse and the brand file stay; the catalogue image and the worker's document are queued.
    expect((await owner.query("SELECT title FROM hrms_documents WHERE workspace_id = $1", [a.workspaceId])).rows).toEqual([{ title: "Staff contract" }]);
    expect((await owner.query("SELECT name FROM stock_locations WHERE workspace_id = $1", [a.workspaceId])).rows).toEqual([{ name: "Main store" }]);
    expect((await owner.query("SELECT object_key FROM workspace_stored_objects WHERE workspace_id = $1", [a.workspaceId])).rows).toEqual([{ object_key: files.brandKey }]);
    expect((await owner.query("SELECT object_key, status FROM workspace_object_cleanup_queue WHERE workspace_id = $1 ORDER BY object_key", [a.workspaceId])).rows)
      .toEqual([{ object_key: files.imageKey, status: "pending" }, { object_key: files.workerKey, status: "pending" }]);
    expect((await owner.query("SELECT count(*)::int AS n FROM workspace_memberships WHERE workspace_id = $1", [a.workspaceId])).rows[0].n).toBe(1);

    // The other tenant is untouched.
    expect(await fingerprint(b.workspaceId)).toEqual(beforeB);

    // The cleanup worker deletes exactly the queued object.
    const removed: string[] = [];
    const worker = new WorkspaceObjectCleanupService(db, { remove: async (key: string) => { removed.push(key); } } as never, { get: () => "false" } as never);
    expect(await worker.drain()).toEqual({ deleted: 2, failed: 0 });
    expect(removed.sort()).toEqual([files.imageKey, files.workerKey]);
    expect((await owner.query("SELECT DISTINCT status FROM workspace_object_cleanup_queue WHERE workspace_id = $1", [a.workspaceId])).rows).toEqual([{ status: "deleted" }]);
    expect(await worker.drain()).toEqual({ deleted: 0, failed: 0 });

    // A second clear finds nothing; the journey runs again and numbering starts over.
    const again = await clearer.clear(a.externalTenantId, { confirmSlug: a.slug }, operatorId);
    expect(again.tables.filter((row) => row.disposition !== "keep")).toEqual([]);
    const fresh = await palmFlow(a, "First real villa");
    expect(fresh).toMatchObject({ enquiry: "E-0001", opportunity: flowA.opportunity, project: flowA.project });
    expect(await count(b.workspaceId, "crm_leads")).toBe(1);
  }, 120_000);
});
