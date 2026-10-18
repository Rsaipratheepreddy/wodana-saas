import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ClientPortalAdminService } from "../client-portal/client-portal-admin.service";
import { ClientPortalService } from "../client-portal/client-portal.service";
import type { Delivery } from "../client-portal/portal-auth";
import { savePortalSettings } from "../client-portal/portal-settings";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import { CommercialService } from "../commercial/commercial.service";
import type { CommercialData } from "../commercial/commercial.types";
import { readCaseDocuments } from "../documents/document-sends";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { PreProjectDefinitionService } from "../pre-projects/pre-project-definition.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { ProjectCoreService } from "./project-core.service";
import { MISSING_PROOF, readItemProofFacts, signingBatchId } from "./project-item-proof";
import { ProjectItemProofService } from "./project-item-proof.service";
import { applyVariation, lineHistory, type VariationLine } from "./project-scope";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const MANAGE = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "receivables.view", "portal.manage"];
const TEAM = ["projects.view", "pre_projects.view"];
const APPROVER = "+12025550101";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PDF = (text: string) => ({ buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`), originalname: `${text}.pdf`, mimetype: "application/pdf", size: 40 });
const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

type Person = { user: string; membership: string };
type World = {
  client: PoolClient; workspaceId: string; caseId: string; slug: string; projectId: string; lines: Record<"cabinets" | "wardrobe" | "sofa", string>;
  pm: Person; tech: Person; designer: Person; site: Person;
  items: (userId: string, permissions: string[]) => ProjectItemProofService;
  portal: ClientPortalService; sent: Array<{ channel: string; to: string; code: string }>;
  notices: (code: string, channel?: string) => Promise<Array<{ recipient: string; type: string; subject: string; body: string }>>;
  savepoint: <T>(work: () => Promise<T>) => Promise<T>;
};

integration("shop drawings and delivery proof per item", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /** A started project with three items (cabinets, a wardrobe, a supplier sofa that needs no drawing), its team and the portal on with a decision-maker. */
  async function world(work: (w: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    const slug = `ip-${workspaceId.slice(0, 8)}`;
    const person = (): Person => ({ user: randomUUID(), membership: randomUUID() });
    const pm = person(), tech = person(), designer = person(), site = person();
    try {
      await client.query("BEGIN");
      const names: Array<[Person, string]> = [[pm, "Omar Manager"], [tech, "Tara Technical"], [designer, "Lina Lead"], [site, "Sami Site"]];
      for (const [who, name] of names) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [who.user, `${who.user.slice(0, 8)}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'EUR','Europe/Madrid',$3)", [workspaceId, slug, pm.user]);
      for (const [who] of names) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [who.membership, workspaceId, who.user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), pm.membership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, pm.user]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','EUR')", [workspaceId, caseId, quoteId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const savepoint = async <T>(fn: () => Promise<T>) => {
        await client.query("SAVEPOINT item_proof");
        try { const result = await fn(); await client.query("RELEASE SAVEPOINT item_proof"); return result; }
        catch (error) { await client.query("ROLLBACK TO SAVEPOINT item_proof"); throw error; }
      };
      const run = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => savepoint(async () => fn(client, { userId }));
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => savepoint(async () => fn(client, { userId }));
      const access = (userId: string, permissions: string[]) => ({
        asMember: member(userId), withPermission: run(userId), withAnyPermission: run(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
      } as never);
      const builder = new QuotationBuilderService({ withPermission: run(pm.user), withPermissions: run(pm.user), withAnyPermission: run(pm.user), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Wardrobe", unit: "nos", quantity: "2", rate: "1800", areaId: kitchen } },
        { op: "upsert", line: { id: "c", title: "Sofa", unit: "nos", quantity: "1", rate: "2500", areaId: kitchen } },
      ] });
      const loaded = (await commercialRepository.load(client, workspaceId, caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
      const quote = data.quotes.find((item) => item.id === quoteId)!;
      quote.status = "accepted";
      quote.issuedAt = "2026-09-19T10:00:00.000Z";
      quote.hash = freezeHash(quote);
      quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 11500, optionsTotal: 0, acceptedTotal: 11500,
        decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
      data.agreement = { quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
      data.payments = [{ id: "p1", sourceQuoteId: quoteId, title: "Advance", amount: 11500, dueDate: "", requiredForRelease: true, requiredForProduction: false, status: "verified", proof: "bank transfer",
        reference: "TT-1", evidenceKind: "operational" }];
      data.revision = loaded.revision + 1;
      await commercialRepository.save(client, workspaceId, caseId, data);
      const core = new ProjectCoreService(access(pm.user, MANAGE));
      const { projectId } = await core.start(actor, workspaceId, caseId, { quoteId, leadMembershipId: pm.membership });
      let detail = await core.get(actor, workspaceId, projectId);
      for (const [role, who] of [["technical_designer", tech], ["designer", designer], ["installation_lead", site]] as const)
        detail = await core.command(actor, workspaceId, projectId, { action: "set_member", role, membershipId: who.membership, version: detail.project.version });
      const lineRows = (await client.query<{ id: string; title: string }>(`SELECT id, title FROM project_boq_lines WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows;
      const line = (title: string) => lineRows.find((row) => row.title === title)!.id;
      const lines = { cabinets: line("Kitchen cabinets"), wardrobe: line("Wardrobe"), sofa: line("Sofa") };
      // The sofa comes from a supplier with its catalogue drawing: the team marked it as needing no shop drawing.
      await client.query(`UPDATE project_boq_lines SET drawing_needed = false, drawing_reason = 'Supplier item', drawing_set_by = $3, drawing_set_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, lines.sofa, pm.user]);

      // The portal on, with the client's decision-maker; codes reach the test instead of WhatsApp.
      const config = new ConfigService({ PORTAL_OTP_SECRET: "s".repeat(40), NODE_ENV: "test", WEB_ORIGIN: "https://app.example.com" });
      const database = { query: (text: string, values?: unknown[]) => client.query(text, values), tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => Promise<unknown>) => savepoint(() => fn(client)) };
      const sent: World["sent"] = [];
      const mailer = {
        sendPortalCode: vi.fn(async (input: { to: string; code: string }) => { sent.push({ channel: "email", to: input.to, code: input.code }); return { status: "sent" }; }),
        sendPortalInvitation: vi.fn(async () => ({ status: "sent", provider: "mailgun", messageId: "inv" })),
      };
      const commercial = new CommercialService({} as never, config, {} as never, {} as never);
      const definitions = new PreProjectDefinitionService({} as never, { record: async () => undefined } as never);
      const storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-items-")) }));
      const portal = new ClientPortalService(database as never, config, commercial, definitions, mailer as never, storage);
      (portal as unknown as { delivery: () => Delivery }).delivery = () => ({
        whatsapp: async ({ phone, code }) => { sent.push({ channel: "whatsapp", to: phone, code }); },
        email: async ({ to, code }) => { sent.push({ channel: "email", to, code }); return true; },
      });
      const admin = new ClientPortalAdminService(access(pm.user, MANAGE), config, mailer as never, definitions, storage);
      await savePortalSettings(client, workspaceId, pm.user, { version: 0, enabled: true, welcomeTitle: "Welcome home", support: { email: "care@studio.example" } });
      await admin.saveContact(actor, workspaceId, caseId, { name: "Maya", phone: APPROVER, email: "maya@example.com", role: "approver" });

      await work({
        client, workspaceId, caseId, slug, projectId, lines, pm, tech, designer, site, portal, sent, savepoint,
        items: (userId, permissions) => new ProjectItemProofService(access(userId, permissions), storage),
        notices: async (code, channel = "in_app") => (await client.query<{ recipient: string; type: string; subject: string; body: string }>(
          `SELECT recipient_id::text AS recipient, recipient_type AS type, subject, body FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY created_at`,
          [workspaceId, code, channel])).rows,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  async function signIn(w: World) {
    await w.client.query("UPDATE client_portal_challenges SET created_at = created_at - interval '1 minute' WHERE workspace_id = $1", [w.workspaceId]);
    const challenge = await w.portal.challenge(w.slug, { phone: APPROVER, channel: "whatsapp" }, "", "203.0.113.7");
    return (await w.portal.login(w.slug, { challengeId: challenge.challengeId, code: w.sent.at(-1)!.code })).token;
  }

  async function decisionCode(w: World, token: string, purpose: string) {
    await w.client.query("UPDATE client_portal_challenges SET created_at = created_at - interval '1 minute' WHERE workspace_id = $1", [w.workspaceId]);
    const challenge = await w.portal.challenge(w.slug, { purpose, channel: "whatsapp" }, token, "203.0.113.7");
    return { challengeId: challenge.challengeId, code: w.sent.at(-1)!.code };
  }

  const itemOf = <T extends { lineId: string }>(state: { items: T[] }, lineId: string) => state.items.find((item) => item.lineId === lineId)!;

  it("uploads a version, the lead designer checks it, the client signs two items at once with a code, and both are locked", async () => {
    await world(async (w) => {
      const tech = w.items(w.tech.user, TEAM), designer = w.items(w.designer.user, TEAM), pm = w.items(w.pm.user, MANAGE);
      let state = await tech.drawings(actor, w.workspaceId, w.projectId);
      expect(state.dimensionUnit).toBe("mm");
      expect(itemOf(state, w.lines.cabinets)).toMatchObject({ state: "waiting", quantity: "4.5", unit: "m", canUpload: true, canReview: false });
      // The supplier item skips shop drawings.
      expect(itemOf(state, w.lines.sofa)).toMatchObject({ state: "not_needed", canUpload: false });
      await expect(tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.sofa, randomUUID(), JSON.stringify({ version: 0 }), PDF("sofa"))).rejects.toThrow("This item doesn't need a shop drawing.");

      const cabinets1 = randomUUID(), wardrobe1 = randomUUID(), wardrobe2 = randomUUID();
      const cabinetsFile = PDF("cabinets-v1");
      state = await tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.cabinets, cabinets1, JSON.stringify({ version: 0, width: "4500", height: "2400", depth: "600", note: "Tall units on the left" }), cabinetsFile);
      expect(itemOf(state, w.lines.cabinets)).toMatchObject({ state: "with_lead_designer", number: 1, version: 1, canUpload: false,
        current: { id: cabinets1, number: 1, status: "with_lead_designer", quantity: "4.5", width: "4500", height: "2400", depth: "600", dimensionUnit: "mm", byName: "Tara Technical", note: "Tall units on the left" } });
      // The same upload again is replayed; another file under the same id is refused.
      state = await tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.cabinets, cabinets1, JSON.stringify({ version: 0 }), cabinetsFile);
      expect(itemOf(state, w.lines.cabinets).versions).toHaveLength(1);
      await expect(tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.cabinets, cabinets1, JSON.stringify({ version: 1 }), PDF("other"))).rejects.toThrow(/belongs to another file/);
      // The lead designer heard.
      expect((await w.notices("project.item_drawing_uploaded")).map((notice) => notice.recipient)).toEqual([w.designer.user]);

      state = await tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.wardrobe, wardrobe1, JSON.stringify({ version: 0, quantity: "2" }), PDF("wardrobe-v1"));
      // Only the lead designer (or the project manager) checks; never in one click without the version read.
      await expect(tech.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "review_drawing", versionId: wardrobe1, decision: "approve", version: 1 }))
        .rejects.toThrow("Only the lead designer checks shop drawings.");
      await expect(designer.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "review_drawing", versionId: wardrobe1, decision: "return", reason: "", version: 1 }))
        .rejects.toThrow("Say what needs to change.");
      await expect(designer.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "review_drawing", versionId: wardrobe1, decision: "approve", version: 0 }))
        .rejects.toThrow(/changed. Reload/);
      state = await designer.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "review_drawing", versionId: wardrobe1, decision: "return",
        reason: "Doors should slide", version: 1 });
      expect(itemOf(state, w.lines.wardrobe)).toMatchObject({ state: "changes_asked", canUpload: true, current: { status: "returned", reviewNote: "Doors should slide", reviewedByName: "Lina Lead" } });
      expect((await w.notices("project.item_drawing_returned")).map((notice) => [notice.recipient, notice.body])).toEqual([[w.tech.user, expect.stringContaining("Doors should slide")]]);
      state = await tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.wardrobe, wardrobe2, JSON.stringify({ version: 2, quantity: "3", width: "2400" }), PDF("wardrobe-v2"));
      expect(itemOf(state, w.lines.wardrobe)).toMatchObject({ state: "with_lead_designer", number: 2, versions: [{ number: 2 }, { number: 1, status: "returned" }] });

      // The lead designer approves both: they go to the client, who hears once today.
      for (const [versionId, line] of [[cabinets1, w.lines.cabinets], [wardrobe2, w.lines.wardrobe]] as const)
        state = await designer.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "review_drawing", versionId, decision: "approve", version: itemOf(state, line).version });
      expect(itemOf(state, w.lines.cabinets).state).toBe("with_client");
      expect(itemOf(state, w.lines.wardrobe).state).toBe("with_client");
      expect((await w.notices("portal.decision_waiting", "email")).filter((notice) => notice.type === "portal_contact")).toHaveLength(1);

      // The client sees both, waiting for their signature, and signs them at once with a code bound to exactly those two.
      const token = await signIn(w);
      const project = (await w.portal.view(w.slug, token)).projects[0];
      expect(project.decisions!.itemDrawings!.items.map((item) => [item.title, item.status, item.canSign])).toEqual([["Kitchen cabinets", "with_client", true], ["Wardrobe", "with_client", true]]);
      expect(project.next).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "item_drawings" })]));
      const both = [cabinets1, wardrobe2];
      // The material list: one material only the wardrobe uses, one shared with the cabinets.
      await w.client.query(`INSERT INTO project_material_items (id, workspace_id, project_id, position, name, quantity, unit, boq_line_ids) VALUES
        (gen_random_uuid(), $1, $2, 1, 'Oak board', 4, 'sheet', ARRAY[$3::uuid]), (gen_random_uuid(), $1, $2, 2, 'Soft-close hinges', 20, 'nos', ARRAY[$3::uuid, $4::uuid])`,
        [w.workspaceId, w.projectId, w.lines.wardrobe, w.lines.cabinets]);
      // A code asked for one item can't sign two.
      const onlyOne = await decisionCode(w, token, `item_drawings:${w.caseId}:${signingBatchId(w.caseId, [cabinets1])}:sign`);
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "item_drawings_sign", caseId: w.caseId, versionIds: both, device: IPHONE, ...onlyOne }))
        .rejects.toThrow(/code isn't right/);
      const proof = await decisionCode(w, token, `item_drawings:${w.caseId}:${signingBatchId(w.caseId, both)}:sign`);
      const commandId = randomUUID();
      const signed = await w.portal.command(w.slug, token, { commandId, action: "item_drawings_sign", caseId: w.caseId, versionIds: both, device: IPHONE, ...proof });
      expect(signed).toMatchObject({ ok: true, signed: 2 });
      // The same command again returns its first result.
      expect(await w.portal.command(w.slug, token, { commandId, action: "item_drawings_sign", caseId: w.caseId, versionIds: both, device: IPHONE, ...proof })).toMatchObject({ signed: 2, replayed: true });

      state = await pm.drawings(actor, w.workspaceId, w.projectId);
      expect(itemOf(state, w.lines.cabinets)).toMatchObject({ state: "signed", canUpload: false,
        locked: { versionId: cabinets1, number: 1, quantity: "4.5", unit: "m", width: "4500", height: "2400", depth: "600", dimensionUnit: "mm" },
        signature: { signerName: "Maya", device: "Safari on iPhone", fingerprint: sha(cabinetsFile.buffer) } });
      expect(itemOf(state, w.lines.wardrobe)).toMatchObject({ state: "signed", locked: { versionId: wardrobe2, quantity: "3", width: "2400", height: null } });
      // Guide step 19: the signed quantity (3 wardrobes, not 2) moves the wardrobe's own material; a shared one is named for the project manager.
      expect((await w.client.query(`SELECT name, quantity::text FROM project_material_items WHERE workspace_id = $1 ORDER BY position`, [w.workspaceId])).rows)
        .toEqual([{ name: "Oak board", quantity: "6.0000" }, { name: "Soft-close hinges", quantity: "20.0000" }]);
      expect((await w.notices("project.item_drawings_signed")).map((notice) => notice.body).join(" ")).toContain("Soft-close hinges");

      // Guide step 21: procurement signs off the wardrobe's supplies only once its materials carry every detail; the project manager hears.
      const buyer = w.items(w.tech.user, [...TEAM, "purchasing.manage"]);
      const signOff = (service: ProjectItemProofService) => service.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "sign_off_supplies", lineId: w.lines.wardrobe, method: "ordered", note: "PO-12 placed" });
      await expect(signOff(tech)).rejects.toThrow("Only procurement signs off an item's supplies.");
      await expect(signOff(buyer)).rejects.toThrow(/Before its supplies are signed off: Oak board needs its brand, code, colour, size, finish, supplier, sample photo; Soft-close hinges needs/);
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query(`UPDATE project_material_items SET brand = 'Egger', code = 'H1145', colour = 'Natural', size = '2800 x 2070', finish = 'Matt', supplier = 'Board Co', sample_photo_asset_id = gen_random_uuid()
        WHERE workspace_id = $1`, [w.workspaceId]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      state = await signOff(buyer);
      expect(itemOf(state, w.lines.wardrobe)).toMatchObject({ supplies: { method: "ordered", note: "PO-12 placed", signedByName: "Tara Technical" }, canSignOffSupplies: false });
      expect(itemOf(state, w.lines.cabinets)).toMatchObject({ supplies: null, canSignOffSupplies: true });
      expect((await w.notices("project.item_supplies_signed")).map((notice) => notice.recipient)).toEqual([w.pm.user]);
      await expect(signOff(buyer)).rejects.toThrow("already signed off");
      expect((await w.client.query(`SELECT count(*)::int AS count, count(DISTINCT batch_id)::int AS batches, bool_and(challenge_id = $2) AS coded FROM project_item_drawing_signatures WHERE workspace_id = $1`,
        [w.workspaceId, proof.challengeId])).rows[0]).toEqual({ count: 2, batches: 1, coded: true });
      // Signing locks the item: no new version, and the signed version itself never changes.
      await expect(tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.cabinets, randomUUID(), JSON.stringify({ version: itemOf(state, w.lines.cabinets).version }), PDF("cabinets-v2")))
        .rejects.toThrow(/signed and locked/);
      await expect(w.savepoint(() => w.client.query(`UPDATE project_item_drawing_versions SET quantity = 9 WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, cabinets1])))
        .rejects.toThrow(/signed shop drawing cannot be changed/);
      // The project manager heard, in the app and by email; the signatures are on the job like every other.
      expect((await w.notices("project.item_drawings_signed")).map((notice) => notice.recipient)).toEqual([w.pm.user]);
      expect((await w.notices("project.item_drawings_signed", "email")).map((notice) => notice.recipient)).toEqual([w.pm.user]);
      const documents = await readCaseDocuments(w.client, w.workspaceId, w.caseId);
      expect(documents.signatures.filter((signature) => signature.title.startsWith("Shop drawing"))).toHaveLength(2);
      expect(await readItemProofFacts(w.client, w.workspaceId, w.projectId)).toMatchObject({ drawings: { tracked: true, applicable: 2, signed: 2 } });
      expect((await w.portal.view(w.slug, token)).projects[0].decisions!.itemDrawings!.canSign).toBe(false);

      // A variation takes 1.5 m of the signed cabinets off: the item doesn't keep a quantity no signed drawing shows.
      // Its drawing opens for a new version (the signed V1 stays with its signature) and waits to be signed again.
      const seal = (await w.client.query<{ id: string }>(`SELECT origin_seal_id AS id FROM project_boq_lines WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, w.lines.cabinets])).rows[0];
      await applyVariation(w.client, w.workspaceId, w.projectId, { id: seal.id, label: "VO-1" },
        [{ id: "vo-1", position: 0, changeOp: "omit", boqLineId: w.lines.cabinets, title: "Kitchen cabinets", quantity: "1.5", net: "-1500" } as unknown as VariationLine], w.pm.user);
      state = await pm.drawings(actor, w.workspaceId, w.projectId);
      expect(itemOf(state, w.lines.cabinets)).toMatchObject({ state: "waiting", quantity: "3", canUpload: true, locked: null });
      expect(itemOf(state, w.lines.cabinets).versions).toEqual([expect.objectContaining({ id: cabinets1, status: "signed" })]);
      expect(itemOf(state, w.lines.wardrobe).state).toBe("signed");
      expect((await lineHistory(w.client, w.workspaceId, w.projectId, w.lines.cabinets)).map((entry) => [entry.kind, entry.detail]).slice(-2)).toEqual([
        ["reduced", expect.objectContaining({ variation: "VO-1", left: "3" })],
        ["drawing_reopened", { variation: "VO-1", quantity: "3", signedQuantity: "4.5000" }],
      ]);
      expect(await readItemProofFacts(w.client, w.workspaceId, w.projectId)).toMatchObject({ drawings: { applicable: 2, signed: 1 } });
      // V2 of the cabinets goes the same way: lead designer, then the client.
      state = await tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.cabinets, randomUUID(), JSON.stringify({ version: itemOf(state, w.lines.cabinets).version }), PDF("cabinets-v2"));
      expect(itemOf(state, w.lines.cabinets)).toMatchObject({ state: "with_lead_designer", number: 2, current: { quantity: "3" } });
    });
  });

  it("the client asks for changes to one item with a code; the version goes back to the team", async () => {
    await world(async (w) => {
      const tech = w.items(w.tech.user, TEAM), designer = w.items(w.designer.user, TEAM);
      const version = randomUUID();
      let state = await tech.uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.wardrobe, version, JSON.stringify({ version: 0 }), PDF("wardrobe"));
      state = await designer.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "review_drawing", versionId: version, decision: "approve", version: itemOf(state, w.lines.wardrobe).version });
      const token = await signIn(w);
      const proof = await decisionCode(w, token, `item_drawing:${w.caseId}:${version}:changes`);
      await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "item_drawing_changes", caseId: w.caseId, versionId: version, note: "Add a mirror inside", ...proof });
      state = await tech.drawings(actor, w.workspaceId, w.projectId);
      expect(itemOf(state, w.lines.wardrobe)).toMatchObject({ state: "changes_asked", canUpload: true, current: { status: "changes_asked", clientNote: "Add a mirror inside" } });
      expect((await w.notices("project.item_drawing_returned")).map((notice) => notice.recipient).sort()).toEqual([w.designer.user, w.tech.user].sort());
      // Nothing waits for the client any more.
      await expect(w.portal.challenge(w.slug, { purpose: `item_drawing:${w.caseId}:${version}:changes`, channel: "whatsapp" }, token, "203.0.113.7")).rejects.toThrow(/aren't waiting/);
    });
  });

  it("refuses delivered without a photo, accepts it with one, replays the same command id and keeps every step forward", async () => {
    await world(async (w) => {
      const site = w.items(w.site.user, TEAM);
      let deliveries = await site.deliveries(actor, w.workspaceId, w.projectId);
      expect(itemOf(deliveries, w.lines.sofa)).toMatchObject({ state: "pending", version: 0, photos: [], canRecord: true });
      // Guide step 23: the first delivery waits for the pre-installation checklist (the design check, the crew booked, a person with a login).
      await expect(site.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "mark_delivered", lineId: w.lines.sofa, version: 0 })).rejects.toThrow(/Before the first delivery: .*Lead designer checked/);
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query("UPDATE delivery_projects SET design_checked_at = now() WHERE workspace_id = $1 AND id = $2", [w.workspaceId, w.projectId]);
      const visit = randomUUID(), worker = randomUUID();
      await w.client.query("INSERT INTO hrms_workers (id, workspace_id, name, trade) VALUES ($1, $2, 'Ravi', 'Installer')", [worker, w.workspaceId]);
      await w.client.query("INSERT INTO logistics_assignments (id, workspace_id, kind, project_id, site_member_id, created_by, updated_by) VALUES ($1, $2, 'installation', $3, $4, $5, $5)",
        [visit, w.workspaceId, w.projectId, randomUUID(), w.site.user]);
      await w.client.query("INSERT INTO logistics_assignment_people (workspace_id, assignment_id, worker_id, lead) VALUES ($1, $2, $3, true)", [w.workspaceId, visit, worker]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      expect((await site.deliveries(actor, w.workspaceId, w.projectId) as unknown as { checklist: Array<{ done: boolean }> }).checklist.every((item) => item.done)).toBe(true);
      await expect(site.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "mark_delivered", lineId: w.lines.sofa, version: 0 })).rejects.toThrow(MISSING_PROOF);
      expect((await w.client.query(`SELECT count(*)::int AS count FROM project_item_deliveries WHERE workspace_id = $1`, [w.workspaceId])).rows[0].count).toBe(0);

      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 120, b: 120 } } }).png().toBuffer();
      const photo = { buffer: png, originalname: "sofa.png", mimetype: "image/png", size: png.length };
      await expect(site.uploadPhoto(actor, w.workspaceId, w.projectId, w.lines.sofa, randomUUID(), PDF("not-a-photo"))).rejects.toThrow(/Choose a photo/);
      const photoId = randomUUID();
      deliveries = await site.uploadPhoto(actor, w.workspaceId, w.projectId, w.lines.sofa, photoId, photo);
      expect(itemOf(deliveries, w.lines.sofa).photos).toEqual([expect.objectContaining({ id: photoId, byName: "Sami Site", hasPreview: true })]);
      const file = await site.photo(actor, w.workspaceId, w.projectId, photoId, true);
      expect(file.contentType).toBe("image/webp");

      const commandId = randomUUID();
      const body = { commandId, action: "mark_delivered", lineId: w.lines.sofa, version: 0, note: "Left in the living room" };
      deliveries = await site.command(actor, w.workspaceId, w.projectId, body);
      expect(itemOf(deliveries, w.lines.sofa)).toMatchObject({ state: "delivered", version: 1, deliveredByName: "Sami Site", note: "Left in the living room" });
      // The same command again is a replay, never a second delivery; other details under its id are refused.
      expect(await site.command(actor, w.workspaceId, w.projectId, body)).toMatchObject({ replayed: true });
      await expect(site.command(actor, w.workspaceId, w.projectId, { ...body, note: "Somewhere else" })).rejects.toThrow(/different details/);
      expect((await w.client.query(`SELECT count(*)::int AS count FROM project_item_deliveries WHERE workspace_id = $1`, [w.workspaceId])).rows[0].count).toBe(1);
      // Version-checked, then installed; and never twice.
      await expect(site.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "mark_installed", lineId: w.lines.sofa, version: 0 })).rejects.toThrow(/changed. Reload/);
      deliveries = await site.command(actor, w.workspaceId, w.projectId, { commandId: randomUUID(), action: "mark_installed", lineId: w.lines.sofa, version: 1 });
      expect(itemOf(deliveries, w.lines.sofa)).toMatchObject({ state: "installed", installedByName: "Sami Site", canRecord: false });
      expect(await readItemProofFacts(w.client, w.workspaceId, w.projectId)).toMatchObject({ delivery: { tracked: true, applicable: 3, done: 1 } });
      expect((await w.client.query(`SELECT action FROM audit_events WHERE workspace_id = $1 AND action LIKE 'project.item_%' ORDER BY occurred_at`, [w.workspaceId])).rows.map((row) => row.action))
        .toEqual(["project.item_delivery_photo_added", "project.item_delivered", "project.item_installed"]);
    });
  });

  it("keeps each workspace's item records to itself", async () => {
    await world(async (w) => {
      const site = w.items(w.site.user, TEAM);
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
      await site.uploadPhoto(actor, w.workspaceId, w.projectId, w.lines.cabinets, randomUUID(), { buffer: png, originalname: "a.png", mimetype: "image/png", size: png.length });
      await w.items(w.tech.user, TEAM).uploadDrawing(actor, w.workspaceId, w.projectId, w.lines.cabinets, randomUUID(), JSON.stringify({ version: 0 }), PDF("cabinets"));
      // Another workspace's people can't reach this project through the service.
      const other = randomUUID();
      await expect(w.items(w.pm.user, MANAGE).drawings(actor, other, w.projectId)).rejects.toThrow(/Project not found/);
      // Under the app role, row level security shows the rows to their own workspace only and refuses writing into another.
      const tables = ["project_item_drawings", "project_item_drawing_versions", "project_item_delivery_photos"];
      const count = async () => {
        const counts: number[] = [];
        for (const table of tables) counts.push((await w.client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
        return counts;
      };
      await w.client.query("SET LOCAL ROLE wodana_app");
      try {
        await w.client.query("SELECT set_config('app.current_workspace_id', $1, true)", [other]);
        expect(await count()).toEqual([0, 0, 0]);
        await expect(w.savepoint(() => w.client.query(
          `INSERT INTO project_item_delivery_photos (workspace_id, id, project_id, line_id, mime_type, byte_size, object_key, sha256, taken_by) VALUES ($1, $2, $3, $4, 'image/png', 1, 'k', repeat('a', 64), $5)`,
          [w.workspaceId, randomUUID(), w.projectId, w.lines.cabinets, w.site.user]))).rejects.toThrow(/row-level security/);
        await w.client.query("SELECT set_config('app.current_workspace_id', $1, true)", [w.workspaceId]);
        expect(await count()).toEqual([1, 1, 1]);
      } finally {
        await w.client.query("RESET ROLE");
      }
    });
  });
});
