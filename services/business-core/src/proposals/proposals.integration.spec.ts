import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import { CommercialService } from "../commercial/commercial.service";
import type { CommercialData } from "../commercial/commercial.types";
import { savePortalSettings } from "../client-portal/portal-settings";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { TaxNumberingService } from "../workspaces/tax-numbering.service";
import { EsignService } from "./esign.service";
import { clientPresentation, portalQuoteExtras } from "./proposal-data";
import { issueProposalVersion, ProposalDocumentsService } from "./proposal-documents.service";
import { printToken, readPrintToken, type PrintTarget } from "./portal-print";
import { ProposalPrintService } from "./proposal-print.service";
import { sha256 } from "./proposal-pdf";
import { QsReviewService } from "./qs-review.service";
import { assignQuotationReference, beforeQuoteIssued } from "./quote-issue";
import { readCaseDocuments } from "../documents/document-sends";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each world is rolled back; the
// concurrency test commits into its own workspace and removes it afterwards.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const SALES_PERMISSIONS = ["pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "finance.settings.manage", "legal_entities.view", "crm.opportunities.view"];
const QS_PERMISSIONS = [...SALES_PERMISSIONS, "commercial.estimate", "commercial.costs.manage"];

class MemoryStore {
  readonly files = new Map<string, Buffer>();
  async put(key: string, body: Buffer) { this.files.set(key, Buffer.from(body)); }
  async read(key: string) { const body = this.files.get(key); if (!body) throw new Error(`missing ${key}`); return { body }; }
}

type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; entityId: string; sales: string; qs: string; grantId: string; kitchen: string;
  store: MemoryStore; savepoint: <T>(work: () => Promise<T>) => Promise<T>;
  access: (userId: string, permissions: string[]) => never;
  builder: (userId: string, permissions: string[]) => QuotationBuilderService;
  esign: EsignService; mail: Array<{ kind: string; to: string; url?: string }>;
};

integration("P3 quotation side: numbering, proposals, QS, e-sign and markup disclosure", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 12 });
  });
  afterAll(() => pool.end());

  async function world(work: (w: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), entityId = randomUUID(), sales = randomUUID(), qs = randomUUID();
    const salesMembership = randomUUID(), qsMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID(), qsRole = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sara Sales'),($3,$4,'Quinn QS')", [sales, `${sales.slice(0, 8)}@example.com`, qs, `${qs.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai','en-AE',$3)",
        [workspaceId, `p3-${workspaceId.slice(0, 8)}`, sales]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [salesMembership, workspaceId, sales, qsMembership, qs]);
      await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,'qs','QS')", [qsRole, workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $2, $1, id FROM permissions WHERE code = 'commercial.estimate'", [qsRole, workspaceId]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, qsMembership, qsRole]);
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,'STU','Studio','Studio LLC','AE','AED','en-AE','Asia/Dubai')`, [entityId, workspaceId]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      const pipeline = randomUUID(), proposalStage = randomUUID();
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [pipeline, workspaceId]);
      await client.query(`INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position,probability) VALUES
        ($1,$3,$4,'proposal','Proposal',1,50), ($2,$3,$4,'won','Won',9,100)`, [proposalStage, randomUUID(), workspaceId, pipeline]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,legal_entity_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, pipeline, proposalStage, salesMembership, entityId]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, sales]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Kitchen','AED')", [workspaceId, caseId, quoteId]);
      await client.query("INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name,primary_color,secondary_color,heading_font,body_font) VALUES($1,$2,'Studio Interiors','#0F5C4A','#C8A165','alta','montserrat')",
        [workspaceId, `login-${workspaceId.slice(0, 8)}`]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query(`INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, suffix, padding, reset_policy) VALUES ($1, $2, 'QUOTATION', 'STU-Q-', '-DXB', 3, 'never')`,
        [workspaceId, entityId]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      await savePortalSettings(client, workspaceId, sales, { version: 0, enabled: true });
      const grantId = (await client.query<{ id: string }>(`INSERT INTO client_portal_grants (workspace_id, case_id, name, phone, role, email) VALUES ($1, $2, 'Maya Client', '+15550100001', 'approver', 'maya@example.com') RETURNING id`,
        [workspaceId, caseId])).rows[0].id;
      const savepoint = async <T>(fn: () => Promise<T>) => {
        const name = `p3_${randomUUID().replaceAll("-", "")}`;
        await client.query(`SAVEPOINT ${name}`);
        try { const result = await fn(); await client.query(`RELEASE SAVEPOINT ${name}`); return result; }
        catch (error) { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); throw error; }
      };
      const access = (userId: string, permissions: string[]) => {
        const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string; displayName: string }) => unknown) =>
          savepoint(async () => fn(client, { userId, displayName: userId === qs ? "Quinn QS" : "Sara Sales" }));
        return { withPermission: run, withPermissions: run, withAnyPermission: run, asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => savepoint(async () => fn(client, { userId })),
          // What each person may do, whoever asks (an assignee's permissions are checked too).
          hasPermission: async (_c: unknown, _w: string, who: string, code: string) => (who === userId ? permissions : who === qs ? QS_PERMISSIONS : who === sales ? SALES_PERMISSIONS : []).includes(code) } as never;
      };
      const store = new MemoryStore();
      const builder = (userId: string, permissions: string[]) => new QuotationBuilderService(access(userId, permissions), {} as never);
      await builder(qs, QS_PERMISSIONS).apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", unitCost: "1000", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Worktop", unit: "m²", quantity: "2", rate: "800", unitCost: "600", areaId: kitchen } },
      ] });
      const config = new ConfigService({ NODE_ENV: "test", WEB_ORIGIN: "https://app.example.com" });
      const database = {
        query: (text: string, values?: unknown[]) => client.query(text, values),
        tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => Promise<unknown>) => savepoint(() => fn(client)),
      };
      const mail: World["mail"] = [];
      const mailer = {
        sendSignatureRequest: async (input: { to: string; signUrl: string }) => { mail.push({ kind: "request", to: input.to, url: input.signUrl }); return { status: "sent" }; },
        sendSignedCopy: async (input: { to: string; copyUrl: string }) => { mail.push({ kind: "signed", to: input.to, url: input.copyUrl }); return { status: "sent" }; },
        sendPortalCode: async (input: { to: string; code: string }) => { mail.push({ kind: "code", to: input.to, url: input.code }); return { status: "sent" }; },
      };
      const commercial = new CommercialService({} as never, config, {} as never, {} as never);
      const esign = new EsignService(database as never, access(sales, SALES_PERMISSIONS), store as never, commercial, mailer as never, config);
      await work({ client, workspaceId, caseId, quoteId, entityId, sales, qs, grantId, kitchen, store, savepoint, access, builder, esign, mail });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Marks the quote sent to the client the way the commercial "issue" step does, after its pre-issue hook. */
  async function issue(w: World) {
    const hook = await w.savepoint(() => beforeQuoteIssued(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, quoteId: w.quoteId, familyId: null, kind: "quotation", actorUserId: w.sales }));
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision + 1 };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "issued";
    quote.issuedAt = new Date().toISOString();
    quote.validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    quote.approverId = w.grantId;
    quote.hash = freezeHash(quote);
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    return hook.reference;
  }

  it("allocates quotation numbers gap-free under concurrency: a rolled-back send gives its number back", async () => {
    const setup = await pool.connect();
    const workspaceId = randomUUID(), entityId = randomUUID(), owner = randomUUID();
    try {
      await setup.query("BEGIN");
      await setup.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner')", [owner, `${owner.slice(0, 8)}@example.com`]);
      await setup.query("SET LOCAL session_replication_role = replica");
      await setup.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Seq',$2,'AED',$3)", [workspaceId, `seq-${workspaceId.slice(0, 8)}`, owner]);
      await setup.query("SET LOCAL session_replication_role = origin");
      await setup.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'SEQ','Seq','Seq LLC','AE','AED','en-AE','Asia/Dubai')`, [entityId, workspaceId]);
      await setup.query(`INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, suffix, padding, reset_policy) VALUES ($1, $2, 'QUOTATION', 'C-', '-X', 3, 'never')`, [workspaceId, entityId]);
      await setup.query("COMMIT");
      const attempt = async (index: number) => {
        const connection = await pool.connect();
        try {
          await connection.query("BEGIN");
          await connection.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
          const number = (await connection.query<{ n: string }>("SELECT allocate_document_number($1,$2,'QUOTATION') AS n", [workspaceId, entityId])).rows[0].n;
          await new Promise((resolve) => setTimeout(resolve, 5));
          // Every other send fails after taking a number.
          await connection.query(index % 2 ? "ROLLBACK" : "COMMIT");
          return index % 2 ? null : number;
        } finally { connection.release(); }
      };
      const kept = (await Promise.all(Array.from({ length: 10 }, (_, index) => attempt(index)))).filter((value): value is string => value !== null).sort();
      expect(kept).toEqual(["C-001-X", "C-002-X", "C-003-X", "C-004-X", "C-005-X"]);
      expect((await setup.query("SELECT next_number FROM document_sequences WHERE workspace_id = $1", [workspaceId])).rows[0].next_number).toBe(6);
    } finally {
      await setup.query("ROLLBACK").catch(() => undefined);
      await setup.query("DELETE FROM document_sequences WHERE workspace_id = $1", [workspaceId]);
      await setup.query("DELETE FROM legal_entities WHERE workspace_id = $1", [workspaceId]);
      await setup.query("SET session_replication_role = replica");
      await setup.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
      await setup.query("SET session_replication_role = origin");
      await setup.query("DELETE FROM users WHERE id = $1", [owner]);
      setup.release();
    }
  });

  it("numbers a quote family once from settings (prefix, number, suffix), shows the same number in the preview, and keeps an external quotation's own number", async () => {
    await world(async (w) => {
      const numbering = new TaxNumberingService(w.access(w.sales, SALES_PERMISSIONS));
      const before = await numbering.get(actor, w.workspaceId, w.entityId);
      expect(before.numbering.find((row) => row.documentType === "QUOTATION")?.preview).toBe("STU-Q-001-DXB");
      expect(await issue(w)).toBe("STU-Q-001-DXB");
      // Revisions of the family keep it; issuing again changes nothing.
      expect(await assignQuotationReference(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, familyId: w.quoteId, actorUserId: w.sales })).toBe("STU-Q-001-DXB");
      expect((await numbering.get(actor, w.workspaceId, w.entityId)).numbering.find((row) => row.documentType === "QUOTATION")?.preview).toBe("STU-Q-002-DXB");
      const documents = new ProposalDocumentsService(w.access(w.sales, SALES_PERMISSIONS), w.store as never);
      const pdf = Buffer.from(await (await PDFDocument.create()).save());
      const upload = async (reference: string, id = randomUUID()) => documents.uploadExternal(actor, w.workspaceId, w.caseId, { id, reference, title: "Old quote", amount: "12500.50", currency: "AED" },
        { buffer: pdf, originalname: "old.pdf", mimetype: "application/pdf", size: pdf.length });
      await expect(upload("STU-Q-001-DXB")).rejects.toThrow(/already in this workspace/);
      const id = randomUUID();
      const cards = (await upload("PL/Q/2025/0420", id)).documents;
      expect(cards.find((card) => card.id === id)).toMatchObject({ kind: "external_quotation", reference: "PL/Q/2025/0420", amount: "12500.5000", currentVersion: 1 });
      // The same upload again is the same card; a corrected copy is a new version, the first kept.
      expect((await upload("PL/Q/2025/0420", id)).documents.filter((card) => card.id === id)).toHaveLength(1);
      await expect(upload("pl/q/2025/0420")).rejects.toThrow(/already in this workspace/);
      const next = await documents.addVersion(actor, w.workspaceId, w.caseId, id, { version: 2, note: "Corrected" }, { buffer: pdf, originalname: "old-v2.pdf", mimetype: "application/pdf", size: pdf.length });
      expect(next.documents.find((card) => card.id === id)?.versions.map((version) => version.number)).toEqual([2, 1]);
      // The sequence never handed this number out, and it never moved.
      expect((await w.client.query("SELECT next_number FROM document_sequences WHERE workspace_id = $1", [w.workspaceId])).rows[0].next_number).toBe(2);
      await expect(w.savepoint(() => w.client.query("UPDATE quote_document_versions SET note = 'x' WHERE workspace_id = $1", [w.workspaceId]))).rejects.toThrow(/immutable/);
    });
  });

  it("keeps a quotation with the QS until they confirm the current pricing; Sales can't price it; sending waits for the confirmation (E3)", async () => {
    await world(async (w) => {
      await w.client.query(`INSERT INTO workspace_quotation_settings (workspace_id, qs_review) VALUES ($1, true) ON CONFLICT (workspace_id) DO UPDATE SET qs_review = true`, [w.workspaceId]);
      const salesQs = new QsReviewService(w.access(w.sales, SALES_PERMISSIONS));
      const qsQs = new QsReviewService(w.access(w.qs, QS_PERMISSIONS));
      // Not with the QS yet: sending to the client is refused.
      await expect(issue(w)).rejects.toThrow(/Send this quotation to the QS/);
      // Sales may count and describe, never price.
      await expect(w.builder(w.sales, SALES_PERMISSIONS).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, rate: "1100" } }] }))
        .rejects.toThrow(/QS sets the prices/);
      await expect(salesQs.send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.sales })).rejects.toThrow(/another QS/);
      const sent = await salesQs.send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.qs, note: "Joinery from site measurements" });
      expect(sent).toMatchObject({ required: true, stage: "with_qs", review: { status: "with_qs", assigneeUserId: w.qs, assigneeName: "Quinn QS" } });
      expect((await salesQs.send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.qs })).review?.id).toBe(sent.review?.id);
      expect((await w.client.query("SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'quotation.with_qs' AND channel = 'in_app'", [w.workspaceId, w.qs])).rows[0].n).toBe(1);
      // While with the QS, Sales can't edit at all; the QS prices.
      await expect(w.builder(w.sales, SALES_PERMISSIONS).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "b", version: 1, title: "Quartz worktop" } }] }))
        .rejects.toThrow(/with Quinn QS/);
      await w.builder(w.qs, QS_PERMISSIONS).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, rate: "1250" } }] });
      // The requester never confirms (separation of duties, through the engine).
      await expect(salesQs.decide(actor, w.workspaceId, w.caseId, w.quoteId, { decision: "confirm" })).rejects.toThrow();
      const confirmed = await qsQs.decide(actor, w.workspaceId, w.caseId, w.quoteId, { decision: "confirm", commandId: randomUUID() });
      expect(confirmed).toMatchObject({ stage: "confirmed", review: { status: "confirmed", decidedBy: w.qs, decidedByName: "Quinn QS", approval: { status: "approved" } } });
      expect(confirmed.review?.decidedAt).toBeTruthy();
      const decision = (await w.client.query(`SELECT decision.decided_by AS "by", request.subject_kind AS kind FROM approval_decisions decision
        JOIN approval_requests request ON request.id = decision.request_id WHERE request.workspace_id = $1 AND request.subject_id = $2`, [w.workspaceId, confirmed.review!.id])).rows;
      expect(decision).toEqual([{ by: w.qs, kind: "quote_qs" }]);
      // A price change after the confirmation makes it stale: sending is refused again.
      await w.builder(w.qs, QS_PERMISSIONS).apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 2, rate: "1300" } }] });
      expect((await salesQs.state(actor, w.workspaceId, w.caseId, w.quoteId)).stage).toBe("stale");
      await expect(issue(w)).rejects.toThrow(/pricing changed/);
      // Back to the QS, confirmed again at the current price: now it goes out, with its number.
      await salesQs.send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.qs });
      await qsQs.decide(actor, w.workspaceId, w.caseId, w.quoteId, { decision: "return", note: "Check the worktop size" });
      expect((await salesQs.state(actor, w.workspaceId, w.caseId, w.quoteId)).stage).toBe("returned");
      await salesQs.send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.qs });
      await qsQs.decide(actor, w.workspaceId, w.caseId, w.quoteId, { decision: "confirm" });
      expect(await issue(w)).toBe("STU-Q-001-DXB");
    });
  });

  it("asks for the QS only where the firm's rules apply (Palm, second round): joinery or bespoke lines, a BOQ deal; never a Design Fee or standard items", async () => {
    await world(async (w) => {
      const sales = w.builder(w.sales, SALES_PERMISSIONS);
      const salesQs = new QsReviewService(w.access(w.sales, SALES_PERMISSIONS));
      const joinery = (await sales.addWorkPackage(actor, w.workspaceId, { id: randomUUID(), name: "Joinery" })).id;
      const loose = (await sales.addWorkPackage(actor, w.workspaceId, { id: randomUUID(), name: "Loose furniture" })).id;
      const { settings } = await sales.settings(actor, w.workspaceId);
      await expect(sales.saveSettings(actor, w.workspaceId, { version: settings.version, qsReviewItemTypes: ["sofa"] })).rejects.toThrow();
      await expect(sales.saveSettings(actor, w.workspaceId, { version: settings.version, qsReviewScope: "some" })).rejects.toThrow();
      const saved = await sales.saveSettings(actor, w.workspaceId, { version: settings.version, qsReview: true, qsReviewScope: "rules", qsReviewItemTypes: ["assembly", "assembly"] });
      expect(saved).toMatchObject({ qsReview: true, qsReviewScope: "rules", qsReviewItemTypes: ["assembly"] });
      // The firm marks Joinery for QS review on the work package itself.
      const trades = await sales.updateWorkPackage(actor, w.workspaceId, joinery, { qsReview: true });
      expect(trades.map((trade) => [trade.name, trade.qsReview])).toEqual([["Joinery", true], ["Loose furniture", false]]);
      const audits = (await w.client.query(`SELECT action, after FROM audit_events WHERE workspace_id = $1 AND action IN ('quotation.settings_changed.v1', 'quotation.work_package_changed.v1') ORDER BY occurred_at`,
        [w.workspaceId])).rows;
      expect(audits.find((row) => row.action === "quotation.settings_changed.v1")?.after).toMatchObject({ qsReviewScope: "rules", qsReviewItemTypes: ["assembly"] });
      expect(audits.find((row) => row.action === "quotation.work_package_changed.v1")?.after).toEqual({ qsReview: true });

      // Standard items only: no QS; Sales prices the lines and the quotation goes out.
      await w.client.query("UPDATE commercial_quote_lines SET work_package_id = $3 WHERE workspace_id = $1 AND quote_id = $2", [w.workspaceId, w.quoteId, loose]);
      expect(await salesQs.state(actor, w.workspaceId, w.caseId, w.quoteId)).toMatchObject({ required: false, reason: { code: "standard_only" }, stage: "not_required" });
      await sales.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "b", version: 1, rate: "850" } }] });

      // A joinery line: the QS prices it, and the reason names the work package.
      await sales.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, workPackageId: joinery } }] });
      expect(await salesQs.state(actor, w.workspaceId, w.caseId, w.quoteId)).toMatchObject({ required: true, reason: { code: "lines", workPackages: ["Joinery"], itemTypes: [] }, stage: "to_send" });
      await expect(sales.apply(actor, w.workspaceId, w.caseId, w.quoteId, { ops: [{ op: "upsert", line: { id: "b", version: 2, rate: "900" } }] })).rejects.toThrow(/QS sets the prices/);
      await expect(issue(w)).rejects.toThrow(/Send this quotation to the QS/);

      // The same lines on a Design Fee proposal skip the QS.
      await w.client.query("UPDATE commercial_quotes SET round = 'design' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, w.quoteId]);
      expect(await salesQs.state(actor, w.workspaceId, w.caseId, w.quoteId)).toMatchObject({ required: false, reason: { code: "design_fee" } });
      await w.client.query("UPDATE commercial_quotes SET round = 'main' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, w.quoteId]);

      // A bespoke catalogue item (a kind the firm marked) needs the QS too.
      await w.client.query("UPDATE commercial_quote_lines SET work_package_id = $3 WHERE workspace_id = $1 AND quote_id = $2", [w.workspaceId, w.quoteId, loose]);
      const catalog = randomUUID(), item = randomUUID();
      await w.client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'sell','Sell')", [catalog, w.workspaceId]);
      await w.client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code) VALUES($1,$2,$3,'BSP-1','Bespoke sideboard','assembly','nos')", [item, w.workspaceId, catalog]);
      await w.client.query("UPDATE commercial_quote_lines SET catalog_item_id = $3 WHERE workspace_id = $1 AND quote_id = $2 AND id = 'a'", [w.workspaceId, w.quoteId, item]);
      expect((await salesQs.state(actor, w.workspaceId, w.caseId, w.quoteId)).reason).toEqual({ code: "lines", workPackages: [], itemTypes: ["assembly"] });
      await w.client.query("UPDATE commercial_quote_lines SET catalog_item_id = NULL WHERE workspace_id = $1 AND quote_id = $2", [w.workspaceId, w.quoteId]);

      // A deal whose order needs a BOQ needs the QS even with standard items.
      const opportunity = (await w.client.query<{ id: string }>("SELECT opportunity_id AS id FROM pre_project_cases WHERE id = $1", [w.caseId])).rows[0].id;
      await w.client.query("INSERT INTO crm_deal_fulfilment(workspace_id,opportunity_id,boq_required) VALUES($1,$2,true)", [w.workspaceId, opportunity]);
      expect(await salesQs.state(actor, w.workspaceId, w.caseId, w.quoteId)).toMatchObject({ required: true, reason: { code: "boq_required" } });
      await w.client.query("UPDATE crm_deal_fulfilment SET boq_required = NULL WHERE workspace_id = $1 AND opportunity_id = $2", [w.workspaceId, opportunity]);

      // The switch stays the master switch: off, nothing needs the QS.
      await w.client.query("UPDATE commercial_quote_lines SET work_package_id = $3 WHERE workspace_id = $1 AND quote_id = $2", [w.workspaceId, w.quoteId, joinery]);
      const current = (await sales.settings(actor, w.workspaceId)).settings;
      await sales.saveSettings(actor, w.workspaceId, { version: current.version, qsReview: false });
      expect((await salesQs.state(actor, w.workspaceId, w.caseId, w.quoteId)).reason).toEqual({ code: "off" });
      expect(await issue(w)).toBe("STU-Q-001-DXB");
    });
  });

  it("shows the client the same total in every markup mode, and keeps the mode the quote was sent with", async () => {
    await world(async (w) => {
      await w.client.query(`INSERT INTO workspace_quotation_settings (workspace_id, markup_disclosure) VALUES ($1, 'fee_based') ON CONFLICT (workspace_id) DO UPDATE SET markup_disclosure = 'fee_based'`, [w.workspaceId]);
      await issue(w);
      const fee = (await clientPresentation(w.client, w.workspaceId, w.caseId, w.quoteId)).presentation;
      expect(fee.mode).toBe("fee_based");
      expect(Object.fromEntries(fee.summary.map((row) => [row.key, row.amount]))).toMatchObject({ "Items at cost": "5700.00", "Our fee": "1300.00", Subtotal: "7000.00", Total: "7000.00" });
      expect(fee.lines.map((line) => line.rate)).toEqual(["1000.00", "600.00"]);
      // The firm switching to all-inclusive later doesn't rewrite what this client was sent.
      await w.client.query(`UPDATE workspace_quotation_settings SET markup_disclosure = 'all_inclusive' WHERE workspace_id = $1`, [w.workspaceId]);
      const portal = await portalQuoteExtras(w.client, w.workspaceId, w.caseId, [{ id: w.quoteId }]);
      expect(portal.get(w.quoteId)).toMatchObject({ reference: "STU-Q-001-DXB", disclosure: { mode: "fee_based" } });
      await w.client.query(`UPDATE quote_issue_snapshots SET markup_disclosure = 'disclosed_markup' WHERE workspace_id = $1`, [w.workspaceId]);
      const disclosed = (await clientPresentation(w.client, w.workspaceId, w.caseId, w.quoteId)).presentation;
      expect(disclosed.lines[0]).toMatchObject({ cost: "1000.00", markupPercent: "20.00", amount: "5400.00" });
      expect(disclosed.summary.at(-1)).toEqual({ key: "Total", amount: "7000.00" });
    });
  });

  it("signs a sent proposal by link: once, as the client's acceptance, with evidence; refuses an expired, withdrawn or tampered link", async () => {
    await world(async (w) => {
      const documents = new ProposalDocumentsService(w.access(w.sales, SALES_PERMISSIONS), w.store as never);
      // The firm's locked pages: a cover (PDF) and a closing page (PNG).
      const cover = await PDFDocument.create(); cover.addPage([595, 842]);
      const coverBytes = Buffer.from(await cover.save());
      await documents.setTemplatePage(actor, w.workspaceId, "1", { version: 0 }, { buffer: coverBytes, originalname: "cover.pdf", mimetype: "application/pdf", size: coverBytes.length });
      await expect(documents.setTemplatePage(actor, w.workspaceId, "4", { version: 1 }, { buffer: coverBytes, originalname: "x.pdf", mimetype: "application/pdf", size: 1 })).rejects.toThrow(/Page 4 is always the quotation/);
      await expect(documents.setTemplatePage(actor, w.workspaceId, "5", { version: 0 }, { buffer: coverBytes, originalname: "x.pdf", mimetype: "application/pdf", size: 1 })).rejects.toThrow(/changed the proposal template/);
      await expect(w.esign.request(actor, w.workspaceId, w.caseId, w.quoteId, { commandId: randomUUID() })).rejects.toThrow(/Send the quotation to the client first/);
      await issue(w);

      // A link that expired signs nothing.
      const first = await w.esign.request(actor, w.workspaceId, w.caseId, w.quoteId, { commandId: randomUUID() });
      const token1 = first.link!.split("/sign/")[1];
      expect(w.mail.at(-1)).toEqual({ kind: "request", to: "maya@example.com", url: first.link });
      await w.client.query("UPDATE esign_requests SET expires_at = now() - interval '1 minute' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, first.request.id]);
      expect((await w.esign.view(token1)).state).toBe("expired");
      await expect(w.esign.sign(token1, { name: "Maya Client", consent: true, signature: { kind: "typed", text: "Maya Client" }, documentSha256: first.request.documentSha256 }, { ip: "203.0.113.7" }))
        .rejects.toThrow(/expired/);

      // Sending again withdraws the old link; the same command again is the same request, without a second email.
      const command = randomUUID();
      const second = await w.esign.request(actor, w.workspaceId, w.caseId, w.quoteId, { commandId: command });
      const replay = await w.esign.request(actor, w.workspaceId, w.caseId, w.quoteId, { commandId: command });
      expect(replay).toMatchObject({ request: { id: second.request.id }, link: null });
      expect(w.mail.filter((item) => item.kind === "request")).toHaveLength(2);
      expect((await w.esign.view(token1)).state).toBe("revoked");
      const token = second.link!.split("/sign/")[1];
      const view = await w.esign.view(token);
      expect(view).toMatchObject({ state: "open", document: { reference: "STU-Q-001-DXB", sha256: second.request.documentSha256 }, signer: { name: "Maya Client", email: "maya@example.com" } });
      const original = await w.esign.document(token, false);
      expect(sha256(original.body)).toBe(second.request.documentSha256);
      expect((await PDFDocument.load(original.body)).getPageCount()).toBe(2); // the cover, then the quotation

      const signing = { name: "Maya Client", consent: true, signature: { kind: "typed", text: "Maya Client" }, documentSha256: second.request.documentSha256 };
      // The signer names what they were shown; another hash is refused.
      await expect(w.esign.sign(token, { ...signing, documentSha256: "0".repeat(64) }, { ip: "203.0.113.7" })).rejects.toThrow(/changed since you opened it/);
      // §0.3 P4: no signature without a one-time code; a wrong code uses a try, the right one is confirmed.
      await expect(w.esign.sign(token, signing, { ip: "203.0.113.7" })).rejects.toThrow(/Confirm the code/);
      expect(await w.esign.sendCode(token, { channel: "email" })).toMatchObject({ channel: "email", resendAfter: 30 });
      const code = w.mail.filter((item) => item.kind === "code").at(-1)!.url!;
      expect(await w.esign.verifyCode(token, { code: code === "000000" ? "111111" : "000000" })).toMatchObject({ verified: false });
      expect(await w.esign.verifyCode(token, { code })).toEqual({ verified: true, message: null });
      expect((await w.esign.view(token)).code).toMatchObject({ verified: true });
      // Tamper: the stored file no longer hashes to what was sent.
      const key = [...w.store.files.keys()].find((name) => name.includes(second.request.documentId) && name.includes(`/${second.request.documentVersion}-`))!;
      const kept = w.store.files.get(key)!;
      w.store.files.set(key, Buffer.concat([kept, Buffer.from("%tampered")]));
      await expect(w.esign.sign(token, signing, { ip: "203.0.113.7" })).rejects.toThrow(/can't be verified/);
      w.store.files.set(key, kept);

      const signed = await w.esign.sign(token, signing, { ip: "203.0.113.7, 10.0.0.1", userAgent: "Mozilla/5.0 (iPhone)" });
      expect(signed).toMatchObject({ state: "signed", replayed: false });
      // The acceptance went through the client's own decision command: the quote is accepted by its decision-maker.
      const quote = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!.content.quotes.find((item: { id: string }) => item.id === w.quoteId);
      expect(quote).toMatchObject({ status: "accepted", clientDecision: { decision: "accept", decidedBy: "Maya Client" } });
      const evidence = (await w.client.query(`SELECT status, signed_name AS name, signer_ip AS ip, signer_user_agent AS agent, signature_kind AS kind, signed_sha256 AS "signedSha256",
        signed_document_version AS version FROM esign_requests WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, second.request.id])).rows[0];
      expect(evidence).toMatchObject({ status: "signed", name: "Maya Client", ip: "203.0.113.7", agent: "Mozilla/5.0 (iPhone)", kind: "typed", signedSha256: signed.signedSha256 });
      // §0.3 P4: the job lists the signing link as a send (opened, then signed) and the signature with how it was verified.
      const onJob = await readCaseDocuments(w.client, w.workspaceId, w.caseId);
      expect(onJob.sends.find((send) => send.kind === "signature_request" && send.recipient === "maya@example.com" && send.state === "signed")).toBeTruthy();
      expect(onJob.signatures[0]).toMatchObject({ method: "esign", signer: "Maya Client", verifiedBy: "email", device: "iPhone", fingerprint: signed.signedSha256 });
      const copy = await w.esign.document(token, true);
      expect(sha256(copy.body)).toBe(signed.signedSha256);
      expect((await PDFDocument.load(copy.body)).getPageCount()).toBe(3); // + the certificate page
      expect(w.mail.at(-1)).toMatchObject({ kind: "signed", to: "maya@example.com" });
      expect((await w.client.query("SELECT count(*)::int AS n FROM audit_events WHERE workspace_id = $1 AND action = 'quotation.signed.v1'", [w.workspaceId])).rows[0].n).toBe(1);

      // Used: a second submission returns the signature already made and changes nothing.
      expect(await w.esign.sign(token, signing, { ip: "198.51.100.1" })).toMatchObject({ state: "signed", replayed: true, signedSha256: signed.signedSha256 });
      expect((await w.client.query("SELECT count(*)::int AS n FROM quote_document_versions WHERE workspace_id = $1 AND purpose = 'signed'", [w.workspaceId])).rows[0].n).toBe(1);
      // The evidence can't be edited afterwards.
      await expect(w.savepoint(() => w.client.query("UPDATE esign_requests SET signed_name = 'Someone else' WHERE workspace_id = $1 AND id = $2", [w.workspaceId, second.request.id]))).rejects.toThrow(/final/);
      await expect(w.esign.view("not-a-token")).rejects.toThrow(/isn't valid/);
    });
  });

  it("prints the proposal's quotation pages from the client's portal page (one snapshot, a short link), and draws them itself when printing fails", async () => {
    await world(async (w) => {
      const documents = new ProposalDocumentsService(w.access(w.sales, SALES_PERMISSIONS), w.store as never);
      const cover = await PDFDocument.create(); cover.addPage([595, 842]);
      const coverBytes = Buffer.from(await cover.save());
      await documents.setTemplatePage(actor, w.workspaceId, "1", { version: 0 }, { buffer: coverBytes, originalname: "cover.pdf", mimetype: "application/pdf", size: coverBytes.length });
      await issue(w);
      const hash = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!.content.quotes!.find((quote) => quote.id === w.quoteId)!.hash!;
      // The portal page's data for a print link: the quotation as the client's portal gives it, only that snapshot, only while the link lives.
      const secret = "s".repeat(40);
      const target: PrintTarget = { workspaceId: w.workspaceId, caseId: w.caseId, quoteId: w.quoteId, quoteHash: hash, slug: "studio" };
      const token = printToken(secret, target, Date.parse("2026-10-17T10:00:00Z"));
      expect(readPrintToken(secret, token, Date.parse("2026-10-17T10:02:00Z"))).toEqual(target);
      expect(readPrintToken(secret, token, Date.parse("2026-10-17T10:04:00Z"))).toBeNull();
      expect(readPrintToken(secret, `${token.slice(0, -2)}xx`, Date.parse("2026-10-17T10:01:00Z"))).toBeNull();
      expect(readPrintToken("t".repeat(40), token, Date.parse("2026-10-17T10:01:00Z"))).toBeNull();
      const database = { tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => Promise<unknown>) => w.savepoint(() => fn(w.client)) };
      const previous = process.env.PORTAL_OTP_SECRET;
      process.env.PORTAL_OTP_SECRET = secret;
      try {
        const printed = await new ProposalPrintService(database as never).view(printToken(secret, target)) as { quote: Record<string, unknown>; customer: string; site: { brand: { name: string } } };
        expect(printed).toMatchObject({ quote: { id: w.quoteId, hash, status: "issued", total: expect.any(Number) }, customer: "Maya Client", site: { brand: { name: "Studio Interiors" } } });
        expect(JSON.stringify(printed.quote)).not.toMatch(/unitCost|costs?"/);
        await expect(new ProposalPrintService(database as never).view(printToken(secret, { ...target, quoteHash: "0".repeat(64) }))).rejects.toThrow(/isn't available/);
      } finally {
        if (previous === undefined) delete process.env.PORTAL_OTP_SECRET; else process.env.PORTAL_OTP_SECRET = previous;
      }

      // The printer's pages go between the firm's cover and its closing page; the stored copy is exactly those bytes.
      const page = await PDFDocument.create(); page.addPage([595, 842]); page.addPage([595, 842]);
      const asked: PrintTarget[] = [];
      const issued = await issueProposalVersion(w.client, w.store as never, { workspaceId: w.workspaceId, caseId: w.caseId, quoteId: w.quoteId, actorUserId: w.sales },
        async (printTarget) => { asked.push(printTarget); return page.save(); });
      expect(asked).toEqual([{ workspaceId: w.workspaceId, caseId: w.caseId, quoteId: w.quoteId, quoteHash: hash, slug: expect.stringMatching(/^p3-/) }]);
      const stored = (await w.client.query<{ objectKey: string; sha: string }>(`SELECT object_key AS "objectKey", sha256 AS sha FROM quote_document_versions WHERE workspace_id = $1 AND document_id = $2 AND number = $3`,
        [w.workspaceId, issued.documentId, issued.number])).rows[0];
      const pdf = await PDFDocument.load((await w.store.read(stored.objectKey)).body);
      expect(pdf.getPageCount()).toBe(3);
      expect(stored.sha).toBe(issued.sha256);

      // A printer that fails never blocks sending: the built-in composer draws the quotation instead.
      await w.client.query(`DELETE FROM quote_document_versions WHERE workspace_id = $1 AND document_id = $2`, [w.workspaceId, issued.documentId]);
      const fallback = await issueProposalVersion(w.client, w.store as never, { workspaceId: w.workspaceId, caseId: w.caseId, quoteId: w.quoteId, actorUserId: w.sales },
        async () => { throw new Error("no browser"); });
      expect(fallback.reused).toBe(false);
    });
  });

  it("keeps every new table to its own workspace under the application role", async () => {
    await world(async (w) => {
      await issue(w);
      const signed = await w.esign.request(actor, w.workspaceId, w.caseId, w.quoteId, { commandId: randomUUID() });
      await new QsReviewService(w.access(w.sales, SALES_PERMISSIONS)).send(actor, w.workspaceId, w.caseId, w.quoteId, { assigneeUserId: w.qs }).catch(() => undefined);
      const tables = ["quotation_references", "quote_issue_snapshots", "quote_documents", "quote_document_versions", "proposal_templates", "proposal_template_pages", "esign_requests", "quote_qs_reviews"];
      await w.savepoint(async () => {
        await w.client.query("SET LOCAL ROLE wodana_app");
        const counts = async () => {
          const found: Record<string, number> = {};
          for (const table of tables) found[table] = (await w.client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
          return found;
        };
        const own = await counts();
        expect(own.quotation_references).toBe(1);
        expect(own.esign_requests).toBe(1);
        await w.client.query("SELECT set_config('app.current_workspace_id',$1,true)", [randomUUID()]);
        expect(Object.values(await counts()).every((count) => count === 0)).toBe(true);
        // The signing page finds the workspace from the token's hash only (a SECURITY DEFINER lookup).
        const hash = (await w.client.query("SELECT esign_request_workspace(token_hash) AS w FROM (SELECT $1::varchar AS token_hash) AS t",
          [(await import("./esign.domain")).signingTokenHash(signed.link!.split("/sign/")[1])])).rows[0].w;
        expect(hash).toBe(w.workspaceId);
        await w.client.query("RESET ROLE");
      });
      await expect(w.savepoint(async () => {
        await w.client.query("SET LOCAL ROLE wodana_app");
        await w.client.query("SELECT set_config('app.current_workspace_id',$1,true)", [randomUUID()]);
        await w.client.query(`INSERT INTO quote_documents (workspace_id, id, case_id, kind, title) VALUES ($1, $2, $3, 'external_quotation', 'x')`, [w.workspaceId, randomUUID(), w.caseId]);
      })).rejects.toThrow(/row-level security/);
    });
  });
});
