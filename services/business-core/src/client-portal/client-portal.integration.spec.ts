import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import { CommercialService } from "../commercial/commercial.service";
import type { CommercialData } from "../commercial/commercial.types";
import { CrmNotificationsService } from "../crm/notifications/crm-notifications.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { PreProjectDefinitionService } from "../pre-projects/pre-project-definition.service";
import { ProjectCoreService } from "../project-core/project-core.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { ReceivablesService } from "../receivables/receivables.service";
import { HandoverService } from "../site/handover.service";
import { SiteService } from "../site/site.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { ClientPortalAdminService } from "./client-portal-admin.service";
import { ClientPortalService } from "./client-portal.service";
import type { Delivery } from "./portal-auth";
import { tellClients } from "./portal-notices";
import { savePortalSettings } from "./portal-settings";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const APPROVER = "+15550100001", VIEWER = "+15550100002", STRANGER = "+15550100009";

/**
 * Every field the portal may return, by path ([] is any item of a list). A field not listed here fails the
 * test: nothing internal (cost, margin, supplier, codes of the firm's materials, notes, staff other than
 * "your project manager", evidence, providers) reaches a client by accident.
 */
const ALLOWED = new Set(`
contact contact.name contact.nameConfirmed contact.phone today projects projects[]
projects[].id projects[].title projects[].reference projects[].role projects[].status projects[].paused projects[].sections
projects[].sections.progress projects[].sections.decisions projects[].sections.payments projects[].sections.documents projects[].sections.warranty projects[].sections.messages
projects[].manager projects[].stage projects[].stage.number projects[].stage.total projects[].stage.name projects[].handoverDate
projects[].next projects[].next[] projects[].next[].kind projects[].next[].id projects[].next[].title projects[].next[].due
projects[].latestUpdate projects[].latestUpdate.id projects[].latestUpdate.at projects[].latestUpdate.text
projects[].progress projects[].progress.stages projects[].progress.stages[] projects[].progress.stages[].name projects[].progress.stages[].state
projects[].progress.stages[].startedOn projects[].progress.stages[].finishedOn projects[].progress.updates projects[].progress.updates[]
projects[].progress.updates[].id projects[].progress.updates[].at projects[].progress.updates[].text projects[].progress.photoDays projects[].progress.photoDays[]
projects[].progress.photoDays[].on projects[].progress.photoDays[].photos projects[].progress.photoDays[].photos[] projects[].progress.photoDays[].photos[].id
projects[].decisions projects[].decisions.quotes projects[].decisions.quotes[] projects[].decisions.quotes[].id projects[].decisions.quotes[].number
projects[].decisions.quotes[].kind projects[].decisions.quotes[].direction projects[].decisions.quotes[].status projects[].decisions.quotes[].title
projects[].decisions.quotes[].currency projects[].decisions.quotes[].validUntil projects[].decisions.quotes[].issuedAt projects[].decisions.quotes[].total
projects[].decisions.quotes[].discount projects[].decisions.quotes[].taxRate projects[].decisions.quotes[].terms projects[].decisions.quotes[].exclusions
projects[].decisions.quotes[].inclusions projects[].decisions.quotes[].hash projects[].decisions.quotes[].expired projects[].decisions.quotes[].canDecide
projects[].decisions.quotes[].cover projects[].decisions.quotes[].presentation projects[].decisions.quotes[].brand projects[].decisions.quotes[].brand.name
projects[].decisions.quotes[].brand.logo projects[].decisions.quotes[].brand.primaryColor projects[].decisions.quotes[].brand.accentColor
projects[].decisions.quotes[].brand.welcomeTitle projects[].decisions.quotes[].brand.welcomeText projects[].decisions.quotes[].brand.supportPhone
projects[].decisions.quotes[].brand.layout projects[].decisions.quotes[].rooms projects[].decisions.quotes[].rooms[] projects[].decisions.quotes[].rooms[].id
projects[].decisions.quotes[].rooms[].name projects[].decisions.quotes[].paymentTerms projects[].decisions.quotes[].paymentTerms[]
projects[].decisions.quotes[].paymentTerms[].id projects[].decisions.quotes[].paymentTerms[].title projects[].decisions.quotes[].paymentTerms[].percent
projects[].decisions.quotes[].paymentTerms[].trigger projects[].decisions.quotes[].lines projects[].decisions.quotes[].lines[]
projects[].decisions.quotes[].lines[].id projects[].decisions.quotes[].lines[].deductsLineId projects[].decisions.quotes[].lines[].room
projects[].decisions.quotes[].lines[].title projects[].decisions.quotes[].lines[].specification projects[].decisions.quotes[].lines[].material
projects[].decisions.quotes[].lines[].finish projects[].decisions.quotes[].lines[].variantLabel projects[].decisions.quotes[].lines[].photo
projects[].decisions.quotes[].lines[].dimensions projects[].decisions.quotes[].lines[].pricingMode projects[].decisions.quotes[].lines[].quantity
projects[].decisions.quotes[].lines[].unit projects[].decisions.quotes[].lines[].rate projects[].decisions.quotes[].lines[].optional projects[].decisions.quotes[].lines[].optionPrice
projects[].decisions.quotes[].lines[].materialRows projects[].decisions.quotes[].lines[].customMaterials
projects[].decisions.quotes[].decision projects[].decisions.quotes[].decision.decision projects[].decisions.quotes[].decision.quoteHash
projects[].decisions.quotes[].decision.selectedOptionLineIds projects[].decisions.quotes[].decision.baseTotal projects[].decisions.quotes[].decision.optionsTotal
projects[].decisions.quotes[].decision.acceptedTotal projects[].decisions.quotes[].decision.decidedAt projects[].decisions.quotes[].decision.decidedBy
projects[].decisions.quotes[].decision.note
projects[].decisions.quotes[].cover.preparedFor projects[].decisions.quotes[].cover.location projects[].decisions.quotes[].cover.subtitle
projects[].decisions.quotes[].cover.logo projects[].decisions.quotes[].cover.banner projects[].decisions.quotes[].cover.signature
projects[].decisions.quotes[].cover.signerName projects[].decisions.quotes[].cover.signerTitle projects[].decisions.quotes[].cover.clientSignature
projects[].decisions.quotes[].cover.taxLabel projects[].decisions.quotes[].cover.taxRegistration
projects[].decisions.quotes[].lines[].dimensions.length projects[].decisions.quotes[].lines[].dimensions.height
projects[].decisions.quotes[].lines[].dimensions.depth projects[].decisions.quotes[].lines[].dimensions.unit
projects[].decisions.quotes[].lines[].materialRows[] projects[].decisions.quotes[].lines[].materialRows[].id projects[].decisions.quotes[].lines[].materialRows[].name
projects[].decisions.quotes[].lines[].materialRows[].type projects[].decisions.quotes[].lines[].materialRows[].specification
projects[].decisions.quotes[].lines[].materialRows[].quantity projects[].decisions.quotes[].lines[].materialRows[].unit
projects[].decisions.quotes[].lines[].materialRows[].rate projects[].decisions.quotes[].lines[].materialRows[].suppliedByClient
projects[].decisions.quotes[].lines[].customMaterials[] projects[].decisions.quotes[].lines[].customMaterials[].id
projects[].decisions.quotes[].lines[].customMaterials[].name projects[].decisions.quotes[].lines[].customMaterials[].brand
projects[].decisions.quotes[].lines[].customMaterials[].code projects[].decisions.quotes[].lines[].customMaterials[].specification
projects[].decisions.quotes[].lines[].customMaterials[].suppliedByClient
projects[].decisions.requests[] projects[].decisions.requests[].id projects[].decisions.requests[].number projects[].decisions.requests[].title
projects[].decisions.requests[].detail projects[].decisions.requests[].dueDate projects[].decisions.requests[].target projects[].decisions.requests[].choices
projects[].decisions.requests[].choices[] projects[].decisions.requests[].choices[].id projects[].decisions.requests[].choices[].label
projects[].decisions.requests[].decision projects[].decisions.requests[].decision.choiceLabel projects[].decisions.requests[].decision.note
projects[].decisions.requests[].decision.decidedAt projects[].decisions.requests[].decision.decidedBy projects[].decisions.requests[].canDecide
projects[].decisions.definition.id projects[].decisions.definition.number projects[].decisions.definition.message projects[].decisions.definition.publishedAt
projects[].decisions.definition.status projects[].decisions.definition.brief projects[].decisions.definition.brief.goals
projects[].decisions.definition.brief.propertyType projects[].decisions.definition.brief.location projects[].decisions.definition.brief.area
projects[].decisions.definition.brief.timeline projects[].decisions.definition.brief.preferences projects[].decisions.definition.brief.retainedItems
projects[].decisions.definition.brief.exclusions projects[].decisions.definition.brief.constraints projects[].decisions.definition.rooms
projects[].decisions.definition.items projects[].decisions.definition.items[] projects[].decisions.definition.items[].title
projects[].decisions.definition.items[].room projects[].decisions.definition.items[].quantity projects[].decisions.definition.items[].unit
projects[].decisions.definition.items[].requirement projects[].decisions.definition.items[].avoid projects[].decisions.definition.decision
projects[].decisions.definition.decision.decision projects[].decisions.definition.decision.decidedAt projects[].decisions.definition.decision.note
projects[].decisions.definition.canDecide
projects[].decisions.designs projects[].decisions.designs[] projects[].decisions.designs[].id projects[].decisions.designs[].title
projects[].decisions.designs[].type projects[].decisions.designs[].number projects[].decisions.designs[].status projects[].decisions.designs[].dueAt
projects[].decisions.designs[].room projects[].decisions.designs[].item projects[].decisions.designs[].mimeType projects[].decisions.designs[].canDecide
projects[].decisions.requests projects[].decisions.definition
projects[].decisions.materials projects[].decisions.materials.id projects[].decisions.materials.number projects[].decisions.materials.status
projects[].decisions.materials.sentAt projects[].decisions.materials.decidedAt projects[].decisions.materials.decidedBy projects[].decisions.materials.items
projects[].decisions.materials.items[] projects[].decisions.materials.items[].id projects[].decisions.materials.items[].name
projects[].decisions.materials.items[].specification projects[].decisions.materials.items[].quantity projects[].decisions.materials.items[].unit
projects[].decisions.materials.items[].areas projects[].decisions.materials.items[].decision projects[].decisions.materials.items[].note
projects[].decisions.materials.canDecide
projects[].decisions.handovers projects[].decisions.handovers[] projects[].decisions.handovers[].id projects[].decisions.handovers[].revision
projects[].decisions.handovers[].title projects[].decisions.handovers[].status projects[].decisions.handovers[].areas projects[].decisions.handovers[].issuedAt
projects[].decisions.handovers[].decidedOn projects[].decisions.handovers[].decidedBy projects[].decisions.handovers[].note
projects[].decisions.handovers[].documents projects[].decisions.handovers[].documents[] projects[].decisions.handovers[].documents[].id
projects[].decisions.handovers[].documents[].kind projects[].decisions.handovers[].documents[].title projects[].decisions.handovers[].documents[].mimeType
projects[].decisions.handovers[].canDecide
projects[].payments projects[].payments.currency projects[].payments.showAmounts
projects[].documents projects[].documents[] projects[].documents[].id projects[].documents[].kind projects[].documents[].title projects[].documents[].group
projects[].documents[].date projects[].documents[].mimeType
projects[].warranty
projects[].warranty.claims projects[].warranty.claims[] projects[].warranty.claims[].id projects[].warranty.claims[].number projects[].warranty.claims[].raisedOn
projects[].warranty.claims[].description projects[].warranty.claims[].status projects[].warranty.claims[].reason projects[].warranty.areas
projects[].warranty.areas[] projects[].warranty.areas[].id projects[].warranty.areas[].name projects[].warranty.lines projects[].warranty.lines[]
projects[].warranty.lines[].id projects[].warranty.lines[].title projects[].warranty.lines[].areaId projects[].warranty.canClaim
projects[].messages projects[].messages.requests projects[].messages.requests[] projects[].messages.requests[].id projects[].messages.requests[].number
projects[].messages.requests[].title projects[].messages.requests[].detail projects[].messages.requests[].status projects[].messages.requests[].createdAt
projects[].messages.requests[].resolution projects[].messages.requests[].comments projects[].messages.requests[].comments[]
projects[].messages.requests[].comments[].id projects[].messages.requests[].comments[].at projects[].messages.requests[].comments[].text
projects[].messages.requests[].comments[].fromClient
projects[].handedOverOn projects[].warrantyUntil projects[].rooms projects[].rooms[] projects[].rooms[].id projects[].rooms[].name projects[].unread projects[].sections.moodboard projects[].decisions.designs[].hasPreview projects[].progress.issues projects[].progress.issues[] projects[].progress.issues[].id projects[].progress.issues[].number projects[].progress.issues[].raisedOn projects[].progress.issues[].description projects[].progress.issues[].area projects[].progress.issues[].status projects[].progress.issues[].reason projects[].progress.issues[].files projects[].progress.issues[].files[] projects[].progress.issues[].files[].id projects[].progress.issues[].files[].name projects[].progress.issues[].files[].mimeType projects[].progress.issues[].files[].hasPreview projects[].progress.canReportIssue projects[].moodboard projects[].moodboard.canAdd projects[].moodboard.boards projects[].moodboard.boards[] projects[].moodboard.boards[].id projects[].moodboard.boards[].title projects[].moodboard.boards[].room projects[].moodboard.boards[].number projects[].moodboard.boards[].status projects[].moodboard.boards[].mimeType projects[].moodboard.boards[].sharedAt projects[].moodboard.boards[].hasImage projects[].moodboard.boards[].reaction projects[].moodboard.boards[].comments projects[].moodboard.boards[].comments[] projects[].moodboard.boards[].comments[].id projects[].moodboard.boards[].comments[].text projects[].moodboard.boards[].comments[].at projects[].moodboard.boards[].comments[].fromClient projects[].moodboard.boards[].comments[].mine projects[].moodboard.boards[].comments[].author projects[].moodboard.pins projects[].moodboard.pins[] projects[].moodboard.pins[].id projects[].moodboard.pins[].title projects[].moodboard.pins[].note projects[].moodboard.pins[].link projects[].moodboard.pins[].room projects[].moodboard.pins[].addedAt projects[].moodboard.pins[].feeling projects[].moodboard.pins[].fromClient projects[].moodboard.pins[].mine projects[].moodboard.pins[].author projects[].moodboard.pins[].photos projects[].moodboard.pins[].photos[] projects[].moodboard.pins[].photos[].id projects[].moodboard.pins[].reaction projects[].moodboard.pins[].comments projects[].moodboard.pins[].comments[] projects[].moodboard.pins[].comments[].id projects[].moodboard.pins[].comments[].text projects[].moodboard.pins[].comments[].at projects[].moodboard.pins[].comments[].fromClient projects[].moodboard.pins[].comments[].mine projects[].moodboard.pins[].comments[].author projects[].payments.milestones projects[].payments.milestones[] projects[].payments.milestones[].id projects[].payments.milestones[].title projects[].payments.milestones[].amount projects[].payments.milestones[].paid projects[].payments.milestones[].left projects[].payments.milestones[].dueDate projects[].payments.milestones[].status projects[].payments.milestones[].invoice projects[].payments.milestones[].invoice.id projects[].payments.milestones[].invoice.number projects[].payments.milestones[].invoice.issueDate projects[].payments.milestones[].receipts projects[].payments.milestones[].receipts[] projects[].payments.milestones[].receipts[].id projects[].payments.milestones[].receipts[].amount projects[].payments.milestones[].receipts[].receivedOn projects[].payments.milestones[].payUrl projects[].payments.milestones[].report projects[].payments.milestones[].report.id projects[].payments.milestones[].report.status projects[].payments.milestones[].report.paidOn projects[].payments.milestones[].report.reference projects[].payments.milestones[].report.amount projects[].payments.milestones[].report.at projects[].payments.milestones[].report.reason projects[].payments.milestones[].canReport projects[].payments.milestones[].report.files projects[].payments.milestones[].report.files[] projects[].payments.milestones[].report.files[].id projects[].payments.milestones[].report.files[].name projects[].payments.milestones[].report.files[].mimeType projects[].payments.milestones[].report.files[].hasPreview projects[].warranty.rooms projects[].warranty.rooms[] projects[].warranty.rooms[].id projects[].warranty.rooms[].name projects[].warranty.rooms[].until projects[].warranty.rooms[].active projects[].warranty.rooms[].items projects[].warranty.rooms[].items[] projects[].warranty.rooms[].items[].id projects[].warranty.rooms[].items[].title projects[].warranty.rooms[].items[].until projects[].warranty.rooms[].items[].active projects[].warranty.claims[].files projects[].warranty.claims[].files[] projects[].warranty.claims[].files[].id projects[].warranty.claims[].files[].name projects[].warranty.claims[].files[].mimeType projects[].warranty.claims[].files[].hasPreview projects[].messages.unread projects[].messages.requests[].files projects[].messages.requests[].files[] projects[].messages.requests[].files[].id projects[].messages.requests[].files[].name projects[].messages.requests[].files[].mimeType projects[].messages.requests[].files[].hasPreview projects[].messages.requests[].comments[].files projects[].messages.requests[].comments[].files[] projects[].messages.requests[].comments[].files[].id projects[].messages.requests[].comments[].files[].name projects[].messages.requests[].comments[].files[].mimeType projects[].messages.requests[].comments[].files[].hasPreview projects[].messages.requests[].unread projects[].messages.requests[].seenByTeam projects[].messages.requests[].lastAt
`.trim().split(/\s+/));

/** Every key path in a value, lists collapsed to []. */
function paths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => paths(item, `${prefix}[]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => { const path = prefix ? `${prefix}.${key}` : key; return [path, ...paths(item, path)]; });
  return [];
}

type World = {
  client: PoolClient; workspaceId: string; slug: string; caseId: string; quoteId: string; party: string; manager: string; designer: string; managerMembership: string; designerMembership: string;
  kitchen: string; storage: BrandAssetStorageService; core: ProjectCoreService; portal: ClientPortalService; admin: ClientPortalAdminService;
  sent: Array<{ channel: string; to: string; code: string }>;
  invites: Array<{ to: string; recipientName: string; projectName: string; company: string; portalUrl: string; inviteUrl: string; phoneHint: string; channel: string }>;
  savepoint: <T>(work: () => Promise<T>) => Promise<T>;
};

integration("client portal (plan §6.22)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(work: (w: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), manager = randomUUID(), designer = randomUUID();
    const managerMembership = randomUUID(), designerMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    const slug = `cp-${workspaceId.slice(0, 8)}`;
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager'),($3,$4,'Dana Designer')", [manager, `${manager.slice(0, 8)}@example.com`, designer, `${designer.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai','en-AE',$3)", [workspaceId, slug, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [managerMembership, workspaceId, manager, designerMembership, designer]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), designerMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      await client.query("INSERT INTO tenant_login_branding(workspace_id,login_slug,display_name,primary_color,secondary_color,heading_font,body_font) VALUES($1,$2,'Studio Interiors','#0F5C4A','#C8A165','alta','montserrat')",
        [workspaceId, `login-${workspaceId.slice(0, 8)}`]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const savepoint = async <T>(fn: () => Promise<T>) => {
        await client.query("SAVEPOINT portal_test");
        try { const result = await fn(); await client.query("RELEASE SAVEPOINT portal_test"); return result; }
        catch (error) { await client.query("ROLLBACK TO SAVEPOINT portal_test"); throw error; }
      };
      const run = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => savepoint(async () => fn(client, { userId }));
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => savepoint(async () => fn(client, { userId }));
      const access = (userId: string, permissions: string[]) => ({
        asMember: member(userId), withPermission: run(userId), withAnyPermission: run(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
      } as never);
      const everything = ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage", "receivables.view", "receivables.manage", "portal.manage"];
      const builder = new QuotationBuilderService({ withPermission: run(manager), withPermissions: run(manager), withAnyPermission: run(manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Worktop", unit: "m²", quantity: "2.25", rate: "800", areaId: kitchen } },
        { op: "upsert", line: { id: "c", title: "Under-cabinet lights", unit: "nos", quantity: "1", rate: "650", optional: true } },
      ] });
      const config = new ConfigService({ PORTAL_OTP_SECRET: "s".repeat(40), NODE_ENV: "test", WEB_ORIGIN: "https://app.example.com" });
      const database = {
        query: (text: string, values?: unknown[]) => client.query(text, values),
        tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => Promise<unknown>) => savepoint(() => fn(client)),
      };
      const sent: World["sent"] = [];
      const invites: World["invites"] = [];
      const mailer = {
        sendPortalCode: vi.fn(async (input: { to: string; code: string }) => { sent.push({ channel: "email", to: input.to, code: input.code }); return { status: "sent" }; }),
        sendPortalInvitation: vi.fn(async (input: World["invites"][number]) => { invites.push(input); return { status: "sent", provider: "mailgun", messageId: "inv" }; }),
      };
      const commercial = new CommercialService({} as never, config, {} as never, {} as never);
      const definitions = new PreProjectDefinitionService({} as never, { record: async () => undefined } as never);
      const storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-portal-")) }));
      const portal = new ClientPortalService(database as never, config, commercial, definitions, mailer as never, storage);
      // WhatsApp reaches the test instead of Meta; a number ending in 2 has no WhatsApp.
      (portal as unknown as { delivery: () => Delivery }).delivery = () => ({
        whatsapp: async ({ phone, code }) => { if (phone.endsWith("2")) throw new Error("not on WhatsApp"); sent.push({ channel: "whatsapp", to: phone, code }); },
        email: async ({ to, code }) => { sent.push({ channel: "email", to, code }); return true; },
      });
      const admin = new ClientPortalAdminService(access(manager, everything), config, mailer as never, definitions, storage);
      await work({ client, workspaceId, slug, caseId, quoteId, party, manager, designer, managerMembership, designerMembership, kitchen, storage, core: new ProjectCoreService(access(manager, everything)),
        portal, admin, sent, invites, savepoint });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** The portal on, with a decision-maker (who has an email) and a viewer. */
  async function open(w: World) {
    await savePortalSettings(w.client, w.workspaceId, w.manager, { version: 0, enabled: true, welcomeTitle: "Welcome home", support: { email: "care@studio.example" } });
    let contacts = await w.admin.saveContact(actor, w.workspaceId, w.caseId, { name: "Maya", phone: APPROVER, email: "maya@example.com", role: "approver" });
    contacts = await w.admin.saveContact(actor, w.workspaceId, w.caseId, { name: "Sam", phone: VIEWER, role: "viewer" });
    return { approver: contacts.contacts.find((item) => item.phone === APPROVER)!, viewer: contacts.contacts.find((item) => item.phone === VIEWER)! };
  }

  async function signIn(w: World, phone: string, channel: "whatsapp" | "email" = "whatsapp") {
    await w.client.query("UPDATE client_portal_challenges SET created_at = created_at - interval '1 minute' WHERE workspace_id = $1 AND phone = $2", [w.workspaceId, phone]);
    const challenge = await w.portal.challenge(w.slug, { phone, channel }, "", "203.0.113.7");
    const code = w.sent.at(-1)!.code;
    const session = await w.portal.login(w.slug, { challengeId: challenge.challengeId, code });
    return session.token;
  }

  async function decisionCode(w: World, token: string, purpose: string) {
    await w.client.query("UPDATE client_portal_challenges SET created_at = created_at - interval '1 minute' WHERE workspace_id = $1", [w.workspaceId]);
    const challenge = await w.portal.challenge(w.slug, { purpose, channel: "whatsapp" }, token, "203.0.113.7");
    return { challengeId: challenge.challengeId, code: w.sent.at(-1)!.code };
  }

  /** The client accepted the main quote (with the lights), signed, and paid the advance; the project is started. */
  async function started(w: World) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.issuedAt = "2026-09-19T10:00:00.000Z";
    quote.hash = freezeHash(quote);
    const total = 4.5 * 1200 + 2.25 * 800 + 650;
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: ["c"], baseTotal: total - 650, optionsTotal: 650, acceptedTotal: total,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    // Internal numbers that must never reach the client.
    quote.lines[0].unitCost = 424242;
    quote.qsEstimate = { quoteHash: quote.hash, cost: 999111, sellingTotal: total, reviewedAt: "2026-09-18T10:00:00.000Z", reviewedById: w.designer, reviewedBy: "Dana Designer" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "INTERNAL-EVIDENCE signed.pdf", evidenceKind: "operational", status: "executed",
      executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: total / 2, dueDate: "", requiredForRelease: true, requiredForProduction: false, status: "verified",
      proof: "INTERNAL-PROOF bank transfer", reference: "TT-SECRET-1", evidenceKind: "operational" },
      { id: "p2", sourceQuoteId: w.quoteId, title: "Before production", amount: total / 2, dueDate: "", requiredForRelease: false, requiredForProduction: true, status: "pending", proof: "", reference: "" }];
    data.requests = [{ id: randomUUID(), number: 1, title: "Socket by the island", detail: "Can we add one?", status: "open", owner: "Dana Designer", dueDate: "", resolution: "", createdAt: "2026-09-22T10:00:00.000Z",
      comments: [{ id: randomUUID(), author: "Dana Designer", at: "2026-09-22T11:00:00.000Z", text: "Yes, we'll add it.", visibility: "client" },
        { id: randomUUID(), author: "Dana Designer", at: "2026-09-22T11:05:00.000Z", text: "INTERNAL-COMMENT check the budget", visibility: "internal" }] }];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    const { projectId } = await w.core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
    let detail = await w.core.get(actor, w.workspaceId, projectId);
    detail = await w.core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "site_supervisor", membershipId: w.designerMembership, version: detail.project.version });
    const company = randomUUID();
    await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio','Studio LLC','AE','AED','en-AE','Asia/Dubai')`,
      [company, w.workspaceId]);
    return { projectId, total, company };
  }

  it("resolves an enabled portal by its link, the tenant's own domain and its sign-in subdomain, and nothing else", async () => {
    await world(async (w) => {
      await expect(w.portal.resolve({ slug: w.slug })).rejects.toThrow(/isn't available/);
      await open(w);
      expect(await w.portal.resolve({ slug: w.slug })).toEqual({ workspaceId: w.workspaceId, slug: w.slug });
      expect(await w.portal.resolve({ login: `login-${w.workspaceId.slice(0, 8)}` })).toEqual({ workspaceId: w.workspaceId, slug: w.slug });
      const host = `portal-${w.workspaceId.slice(0, 8)}.example.com`;
      await w.client.query(`INSERT INTO workspace_domains (workspace_id, hostname, request_key, challenge_value, challenge_expires_at, dns_status, dns_verified_at, certificate_status,
        certificate_expires_at, routing_status, routing_activated_at, requested_by) VALUES ($1, $2, 'r', 'c', now() + interval '1 day', 'verified', now(), 'issued', now() + interval '60 days',
        'active', now(), $3)`, [w.workspaceId, host, w.manager]);
      expect(await w.portal.resolve({ host: host.toUpperCase() })).toEqual({ workspaceId: w.workspaceId, slug: w.slug });
      await expect(w.portal.resolve({ host: "unknown.example.com" })).rejects.toThrow(/isn't available/);
      // The site is the tenant's own: its brand, fonts, region and contacts.
      const site = await w.portal.site(w.slug);
      expect(site).toMatchObject({ slug: w.slug, brand: { name: "Studio Interiors", primaryColor: "#0F5C4A", secondaryColor: "#C8A165", headingFont: "alta", bodyFont: "montserrat" },
        welcomeTitle: "Welcome home", support: { email: "care@studio.example" }, region: { locale: "en-AE", currency: "AED", timeZone: "Asia/Dubai", country: "AE" },
        signIn: { channels: ["email"], demo: false } });
      // Switched off: the link stops working and everyone is signed out.
      const token = await signIn(w, APPROVER);
      await savePortalSettings(w.client, w.workspaceId, w.manager, { version: 1, enabled: false });
      await expect(w.portal.site(w.slug)).rejects.toThrow(/isn't available/);
      expect((await w.client.query("SELECT revoked_reason FROM client_portal_sessions WHERE workspace_id = $1", [w.workspaceId])).rows).toEqual([{ revoked_reason: "portal_off" }]);
      expect(token).toBeTruthy();
    });
  });

  it("signs in with a code by WhatsApp or email, the same answer for strangers, limits tries and requests, and confirms the name once", async () => {
    await world(async (w) => {
      await open(w);
      // A stranger gets the same answer and no code is sent.
      const stranger = await w.portal.challenge(w.slug, { phone: STRANGER }, "", "203.0.113.7");
      expect(Object.keys(stranger).sort()).toEqual(["challengeId", "channel", "expiresIn", "resendAfter"]);
      expect(w.sent).toEqual([]);
      // WhatsApp for the decision-maker; asking again within 30 seconds (a reload, a second device) returns the code already
      // on its way, and sends nothing more.
      const first = await w.portal.challenge(w.slug, { phone: "+1 555 010 0001" }, "", "203.0.113.7");
      expect(first).toMatchObject({ channel: "whatsapp", expiresIn: 300, resendAfter: 30 });
      expect(w.sent).toEqual([{ channel: "whatsapp", to: APPROVER, code: expect.stringMatching(/^\d{6}$/) }]);
      const again = await w.portal.challenge(w.slug, { phone: APPROVER }, "", "203.0.113.7");
      expect(again).toMatchObject({ challengeId: first.challengeId, channel: "whatsapp" });
      expect(Object.keys(again).sort()).toEqual(["challengeId", "channel", "expiresIn", "resendAfter"]);
      expect(again.resendAfter).toBeGreaterThan(0);
      expect(again.resendAfter).toBeLessThanOrEqual(30);
      expect(w.sent).toHaveLength(1);
      // Five wrong codes and the challenge is spent, even the right one.
      for (let attempt = 0; attempt < 5; attempt += 1)
        await expect(w.portal.login(w.slug, { challengeId: first.challengeId, code: w.sent[0].code === "000000" ? "111111" : "000000" })).rejects.toThrow(/isn't right/);
      await expect(w.portal.login(w.slug, { challengeId: first.challengeId, code: w.sent[0].code })).rejects.toThrow(/isn't right/);
      // Email as the fallback: the viewer isn't on WhatsApp and has no email, so nothing arrives; the decision-maker's email works.
      await w.client.query("UPDATE client_portal_challenges SET created_at = created_at - interval '1 minute' WHERE workspace_id = $1", [w.workspaceId]);
      const byEmail = await w.portal.challenge(w.slug, { phone: APPROVER, channel: "email" }, "", "203.0.113.7");
      expect(w.sent.at(-1)).toEqual({ channel: "email", to: "maya@example.com", code: expect.stringMatching(/^\d{6}$/) });
      const session = await w.portal.login(w.slug, { challengeId: byEmail.challengeId, code: w.sent.at(-1)!.code });
      expect(session).toMatchObject({ expiresIn: 90 * 86_400, needsName: true });
      await expect(w.portal.login(w.slug, { challengeId: byEmail.challengeId, code: w.sent.at(-1)!.code })).rejects.toThrow(/isn't right/);
      const before = w.sent.length;
      await w.portal.challenge(w.slug, { phone: VIEWER }, "", "203.0.113.7");
      expect(w.sent.length).toBe(before);
      // First sign-in: the client confirms their name, once, on every project they're on.
      let view = await w.portal.view(w.slug, session.token);
      expect(view.contact).toEqual({ name: "Maya", nameConfirmed: false, phone: APPROVER });
      await w.portal.command(w.slug, session.token, { commandId: randomUUID(), action: "confirm_name", name: "Maya  Client" });
      view = await w.portal.view(w.slug, session.token);
      expect(view.contact).toEqual({ name: "Maya Client", nameConfirmed: true, phone: APPROVER });
      // Six codes a number in ten minutes; twenty a requester.
      await w.client.query(`INSERT INTO client_portal_challenges (id, workspace_id, phone, purpose, code_hash, expires_at, created_at)
        SELECT gen_random_uuid(), $1, $2, 'sign_in', repeat('0', 64), now(), now() - interval '5 minutes' FROM generate_series(1, 6)`, [w.workspaceId, STRANGER]);
      await expect(w.portal.challenge(w.slug, { phone: STRANGER }, "", "198.51.100.1")).rejects.toMatchObject({ status: 429 });
      await w.client.query(`INSERT INTO client_portal_challenges (id, workspace_id, phone, purpose, code_hash, expires_at, created_at, requester)
        SELECT gen_random_uuid(), $1, '+1555019' || lpad(n::text, 4, '0'), 'sign_in', repeat('0', 64), now(), now() - interval '5 minutes', $2 FROM generate_series(1, 20) n`,
        [w.workspaceId, (w.portal as unknown as { codes: { requester(value: string): string } }).codes.requester("198.51.100.2")]);
      await expect(w.portal.challenge(w.slug, { phone: "+15550199999" }, "", "198.51.100.2")).rejects.toMatchObject({ status: 429 });
    });
  });

  it("works the moodboard with the client: shared pins and boards, likes, comments both ways, and the client's own ideas with photos", async () => {
    await world(async (w) => {
      const { approver } = await open(w);
      const token = await signIn(w, APPROVER);
      // Two of the team's pins: one shown to the client, one kept to the team.
      const shared = randomUUID(), kept = randomUUID();
      for (const [id, title] of [[shared, "Warm oak"], [kept, "INTERNAL-PIN"]])
        await w.client.query(`INSERT INTO pre_project_brief_entries (workspace_id, case_id, id, kind, title, source, created_by, updated_by) VALUES ($1, $2, $3, 'inspiration', $4, 'team', $5, $5)`,
          [w.workspaceId, w.caseId, id, title, w.designer]);
      let board = await w.admin.shareMoodboard(actor, w.workspaceId, w.caseId, { entryIds: [shared], shared: true });
      expect(board.shared).toEqual([shared]);
      await w.admin.shareMoodboard(actor, w.workspaceId, w.caseId, { entryIds: [shared], shared: true });
      expect((await w.client.query("SELECT count(*)::int AS n FROM audit_events WHERE workspace_id = $1 AND action = 'client_portal.moodboard_shared'", [w.workspaceId])).rows[0].n).toBe(1);
      let view = (await w.portal.view(w.slug, token)).projects[0];
      expect(view.moodboard!.pins.map((pin) => [pin.title, pin.fromClient, pin.reaction])).toEqual([["Warm oak", false, null]]);
      expect(JSON.stringify(view)).not.toContain("INTERNAL-PIN");
      // A like and a comment; the design team hears both (the comment by email too). A pin that isn't shared can't be reached.
      await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "react", caseId: w.caseId, targetKind: "pin", targetId: shared, reaction: "like" });
      await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "board_comment", caseId: w.caseId, targetKind: "pin", targetId: shared, text: "Lighter, please" });
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "react", caseId: w.caseId, targetKind: "pin", targetId: kept, reaction: "like" }))
        .rejects.toThrow(/isn't shared/);
      expect((await w.client.query(`SELECT event_type, channel FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type LIKE 'moodboard.%' ORDER BY event_type, channel`,
        [w.workspaceId, w.designer])).rows).toEqual([{ event_type: "moodboard.client_commented", channel: "email" }, { event_type: "moodboard.client_commented", channel: "in_app" },
        { event_type: "moodboard.client_reacted", channel: "in_app" }]);
      // The client adds their own idea: a photo (checked by content, a retry returns the same file) and an Instagram link.
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c8a165" } }).png().toBuffer();
      const upload = randomUUID();
      const file = { buffer: png, originalname: "sofa.png", mimetype: "image/png", size: png.length };
      expect(await w.portal.upload(w.slug, token, w.caseId, upload, file)).toEqual({ id: upload, name: "sofa.png", mimeType: "image/png", hasPreview: true });
      expect(await w.portal.upload(w.slug, token, w.caseId, upload, file)).toEqual({ id: upload, name: "sofa.png", mimeType: "image/png", hasPreview: true });
      await expect(w.portal.upload(w.slug, token, w.caseId, randomUUID(), { ...file, buffer: Buffer.from("not an image") })).rejects.toThrow(/photo/);
      const added = await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "add_inspiration", caseId: w.caseId, uploadIds: [upload],
        link: "https://www.instagram.com/p/abc", note: "This sofa", roomId: w.kitchen });
      expect((await w.client.query("SELECT source, created_by, client_grant_id AS grant, title, reference_url AS link, room_id AS room FROM pre_project_brief_entries WHERE id = $1",
        [added.pinId])).rows).toEqual([{ source: "client", created_by: null, grant: approver.id, title: "Instagram", link: "https://www.instagram.com/p/abc", room: w.kitchen }]);
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "add_inspiration", caseId: w.caseId, uploadIds: [upload] })).rejects.toThrow(/already sent/);
      view = (await w.portal.view(w.slug, token)).projects[0];
      const mine = view.moodboard!.pins.find((pin) => pin.id === added.pinId)!;
      expect(mine).toMatchObject({ fromClient: true, mine: true, room: "Kitchen", photos: [{ id: upload }] });
      expect((await w.portal.file(w.slug, token, "asset", upload, true)).mimeType).toBe("image/webp");
      expect((await w.admin.clientFile(actor, w.workspaceId, w.caseId, upload, false)).mimeType).toBe("image/png");
      // The team answers; the client reads it (the team as "your design team") and hears it by email.
      board = await w.admin.replyMoodboard(actor, w.workspaceId, w.caseId, { id: randomUUID(), targetKind: "pin", targetId: shared, text: "We can do a lighter oak." });
      expect(board.comments.map((comment) => [comment.text, comment.fromClient])).toEqual([["Lighter, please", true], ["We can do a lighter oak.", false]]);
      view = (await w.portal.view(w.slug, token)).projects[0];
      expect(view.moodboard!.pins.find((pin) => pin.id === shared)!.comments.map((comment) => [comment.text, comment.mine, comment.author]))
        .toEqual([["Lighter, please", true, "Maya"], ["We can do a lighter oak.", false, null]]);
      expect(JSON.stringify(view)).not.toContain("Omar");
      expect((await w.client.query("SELECT recipient_type, channel FROM notifications WHERE workspace_id = $1 AND event_type = 'portal.team_replied'", [w.workspaceId])).rows)
        .toEqual([{ recipient_type: "portal_contact", channel: "email" }]);
      // The client takes back their own idea, never the team's.
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "remove_inspiration", caseId: w.caseId, pinId: shared })).rejects.toThrow(/only the ideas you added/);
      await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "remove_inspiration", caseId: w.caseId, pinId: added.pinId });
      expect((await w.portal.view(w.slug, token)).projects[0].moodboard!.pins.map((pin) => pin.id)).toEqual([shared]);
      // The team hides the pin: gone for the client.
      await w.admin.shareMoodboard(actor, w.workspaceId, w.caseId, { entryIds: [shared], shared: false });
      expect((await w.portal.view(w.slug, token)).projects[0].moodboard!.pins).toEqual([]);
    });
  });

  it("takes the client's word that they paid, with proof, until finance records the payment or says it wasn't received", async () => {
    await world(async (w) => {
      await open(w);
      const { projectId } = await started(w);
      await w.client.query("UPDATE commercial_payments SET due_date = '2026-09-20' WHERE workspace_id = $1 AND case_id = $2 AND id = 'p2'", [w.workspaceId, w.caseId]);
      const token = await signIn(w, APPROVER);
      let milestone = (await w.portal.view(w.slug, token)).projects[0].payments!.milestones.find((item) => item.id === "p2")!;
      expect(milestone).toMatchObject({ status: "upcoming", canReport: true, report: null });
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ffffff" } }).png().toBuffer();
      const proof = randomUUID();
      await w.portal.upload(w.slug, token, w.caseId, proof, { buffer: png, originalname: "transfer.png", mimetype: "image/png", size: png.length });
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "report_payment", caseId: w.caseId, paymentId: "p2", paidOn: "2099-01-01", reference: "TT-1" }))
        .rejects.toThrow(/future/);
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "report_payment", caseId: w.caseId, paymentId: "p2", paidOn: "2026-09-26" }))
        .rejects.toThrow(/reference or a photo/);
      const reported = await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "report_payment", caseId: w.caseId, paymentId: "p2", paidOn: "2026-09-26",
        amount: "4000.50", reference: "TT-4455", uploadIds: [proof] });
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "report_payment", caseId: w.caseId, paymentId: "p2", paidOn: "2026-09-26", reference: "TT-4456" }))
        .rejects.toThrow(/already checking/);
      milestone = (await w.portal.view(w.slug, token)).projects[0].payments!.milestones.find((item) => item.id === "p2")!;
      expect(milestone).toMatchObject({ status: "checking", canReport: false, report: { status: "submitted", paidOn: "2026-09-26", reference: "TT-4455", amount: "4000.5000",
        files: [{ id: proof, name: "transfer.png", mimeType: "image/png", hasPreview: true }] } });
      // Finance and the project's manager hear it, in the app and by email.
      expect((await w.client.query("SELECT DISTINCT recipient_id::text AS who FROM notifications WHERE workspace_id = $1 AND event_type = 'payment.client_reported' AND channel = 'email'",
        [w.workspaceId])).rows.map((row) => row.who)).toContain(w.manager);
      // "Recorded" waits for the receipt; "not received" needs a reason the client reads.
      let reports = await w.admin.paymentReports(actor, w.workspaceId, w.caseId);
      expect(reports.reports).toEqual([expect.objectContaining({ id: reported.reportId, status: "submitted", grantName: "Maya", milestone: "Before production", files: [expect.objectContaining({ id: proof })] })]);
      const report = reports.reports[0];
      await expect(w.admin.decidePaymentReport(actor, w.workspaceId, report.id, { decision: "recorded", note: "", version: report.version })).rejects.toThrow(/receipt/);
      await expect(w.admin.decidePaymentReport(actor, w.workspaceId, report.id, { decision: "not_received", note: "", version: report.version })).rejects.toThrow(/why/);
      reports = await w.admin.decidePaymentReport(actor, w.workspaceId, report.id, { decision: "not_received", note: "Nothing from TT-4455 in our account yet.", version: report.version });
      expect(reports.reports[0]).toMatchObject({ status: "not_received", reason: "Nothing from TT-4455 in our account yet." });
      await expect(w.admin.decidePaymentReport(actor, w.workspaceId, report.id, { decision: "recorded", note: "", version: report.version })).rejects.toThrow(/already closed/);
      milestone = (await w.portal.view(w.slug, token)).projects[0].payments!.milestones.find((item) => item.id === "p2")!;
      expect(milestone).toMatchObject({ status: "upcoming", canReport: true, report: { status: "not_received", reason: "Nothing from TT-4455 in our account yet." } });
      expect((await w.client.query("SELECT channel, body FROM notifications WHERE workspace_id = $1 AND event_type = 'portal.payment_checked'", [w.workspaceId])).rows)
        .toEqual([{ channel: "email", body: expect.stringContaining("Nothing from TT-4455") }]);
      expect(projectId).toBeTruthy();
    });
  });

  it("lets the client report an issue while the work is on, and the manager accepts it as a snag or declines it with a reason", async () => {
    await world(async (w) => {
      await open(w);
      const token = await signIn(w, APPROVER);
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "report_issue", caseId: w.caseId, description: "Chipped panel" })).rejects.toThrow();
      const { projectId } = await started(w);
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#aa0000" } }).png().toBuffer();
      const photo = randomUUID();
      await w.portal.upload(w.slug, token, w.caseId, photo, { buffer: png, originalname: "chip.png", mimetype: "image/png", size: png.length });
      const first = await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "report_issue", caseId: w.caseId, description: "Chipped panel by the fridge",
        areaId: w.kitchen, uploadIds: [photo] });
      const second = await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "report_issue", caseId: w.caseId, description: "A scratch that's really the sample" });
      expect([first.number, second.number]).toEqual([1, 2]);
      let view = (await w.portal.view(w.slug, token)).projects[0];
      expect(view.progress!.canReportIssue).toBe(true);
      expect(view.progress!.issues.map((issue) => [issue.number, issue.status, issue.area, issue.files.length])).toEqual([[2, "to_triage", null, 0], [1, "to_triage", "Kitchen", 1]]);
      expect((await w.client.query("SELECT channel FROM notifications WHERE workspace_id = $1 AND event_type = 'project.client_issue' AND recipient_id = $2 ORDER BY channel",
        [w.workspaceId, w.manager])).rows.map((row) => row.channel)).toEqual(["email", "email", "in_app", "in_app"]);
      let staff = await w.admin.issues(actor, w.workspaceId, projectId);
      expect(staff.canTriage).toBe(true);
      const issue = staff.issues.find((item) => item.id === first.issueId)!;
      await expect(w.admin.triageIssue(actor, w.workspaceId, projectId, issue.id, { decision: "accept", note: "", version: issue.version })).rejects.toThrow(/how serious/);
      staff = await w.admin.triageIssue(actor, w.workspaceId, projectId, issue.id, { decision: "accept", severity: "major", note: "", version: issue.version });
      const snagId = staff.issues.find((item) => item.id === issue.id)!.snagId;
      expect((await w.client.query("SELECT type, source, severity, area_id AS area, title FROM work_items WHERE id = $1", [snagId])).rows)
        .toEqual([{ type: "snag", source: "client", severity: "major", area: w.kitchen, title: "Client issue 1: Chipped panel by the fridge" }]);
      const other = staff.issues.find((item) => item.id === second.issueId)!;
      await expect(w.admin.triageIssue(actor, w.workspaceId, projectId, other.id, { decision: "decline", note: "", version: other.version })).rejects.toThrow(/why/);
      await w.admin.triageIssue(actor, w.workspaceId, projectId, other.id, { decision: "decline", note: "That's the sample board, not your panel.", version: other.version });
      view = (await w.portal.view(w.slug, token)).projects[0];
      expect(view.progress!.issues.map((issue) => [issue.number, issue.status, issue.reason])).toEqual([[2, "declined", "That's the sample board, not your panel."], [1, "accepted", ""]]);
      // The client hears both decisions by email; the reason for declining is theirs to read.
      const told = (await w.client.query<{ body: string }>("SELECT body FROM notifications WHERE workspace_id = $1 AND event_type = 'portal.issue_triaged' ORDER BY created_at",
        [w.workspaceId])).rows.map((row) => row.body);
      expect(told).toEqual([expect.stringContaining("We're fixing it."), expect.stringContaining("That's the sample board, not your panel.")]);
      await w.client.query("UPDATE work_items SET status = 'done', completed_at = now() WHERE id = $1", [snagId]);
      expect((await w.portal.view(w.slug, token)).projects[0].progress!.issues.find((item) => item.number === 1)!.status).toBe("fixed");
    });
  });

  it("never shows a photo whose file is missing, and serves the original when a preview is gone", async () => {
    await world(async (w) => {
      await open(w);
      const { projectId } = await started(w);
      const report = randomUUID(), there = randomUUID(), missing = randomUUID();
      await w.client.query(`INSERT INTO site_reports (id, workspace_id, project_id, report_date, author_id, status, submitted_at, decided_by, decided_at)
        VALUES ($1, $2, $3, '2026-09-25', $4, 'approved', now(), $5, now())`, [report, w.workspaceId, projectId, w.designer, w.manager]);
      const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
      await w.storage.put(`site/${there}/original`, png, "image/png");
      for (const id of [there, missing])
        await w.client.query(`INSERT INTO site_report_photos (id, workspace_id, report_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by, shared_at, shared_by)
          VALUES ($1, $2, $3, 'site.png', 'image/png', 10, $4, $5, repeat('a', 64), $6, now(), $6)`, [id, w.workspaceId, report, `site/${id}/original`, `site/${id}/preview.webp`, w.manager]);
      const token = await signIn(w, APPROVER);
      const view = (await w.portal.view(w.slug, token)).projects[0];
      expect(view.progress!.photoDays).toEqual([{ on: "2026-09-25", photos: [{ id: there }] }]);
      // No preview stored: the original is served instead of nothing.
      expect((await w.portal.file(w.slug, token, "photo", there, true)).mimeType).toBe("image/png");
      await expect(w.portal.file(w.slug, token, "photo", missing, true)).rejects.toThrow(/isn't available/);
    });
  });

  it("keeps a session while it's used for 30 days, ends it when idle, when staff sign the contact out, or when their access changes", async () => {
    await world(async (w) => {
      const { approver } = await open(w);
      let token = await signIn(w, APPROVER);
      expect((await w.portal.view(w.slug, token)).projects).toHaveLength(1);
      await w.client.query("UPDATE client_portal_sessions SET last_seen_at = now() - interval '31 days' WHERE workspace_id = $1", [w.workspaceId]);
      await expect(w.portal.view(w.slug, token)).rejects.toThrow(/signed out/);
      token = await signIn(w, APPROVER);
      const out = await w.admin.signOutContact(actor, w.workspaceId, w.caseId, approver.id);
      expect(out.ended).toBeGreaterThanOrEqual(1);
      await expect(w.portal.view(w.slug, token)).rejects.toThrow(/signed out/);
      token = await signIn(w, APPROVER);
      await w.admin.saveContact(actor, w.workspaceId, w.caseId, { id: approver.id, version: approver.version, name: "Maya", phone: APPROVER, email: "maya@example.com", role: "viewer" });
      await expect(w.portal.view(w.slug, token)).rejects.toThrow(/signed out/);
      await expect(w.admin.saveContact(actor, w.workspaceId, w.caseId, { id: approver.id, version: approver.version, name: "Maya", phone: APPROVER, role: "viewer" }))
        .rejects.toThrow(/Someone else changed/);
      await expect(w.admin.saveContact(actor, w.workspaceId, w.caseId, { name: "Twin", phone: APPROVER })).rejects.toThrow(/already a contact/);
    });
  });

  it("shows only what staff published, field by field, and never an internal value", async () => {
    await world(async (w) => {
      await open(w);
      const { projectId, total, company } = await started(w);
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      // One shared update, one kept inside.
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "post_update", health: "on_track", note: "Cabinets are in the factory.", shareWithClient: true, version: detail.project.version });
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "post_update", health: "at_risk", note: "INTERNAL-RISK supplier late", version: detail.project.version });
      // The material list: its supplier, code and note stay inside.
      const scope = await w.core.scope(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", specification: "Crown cut", supplier: "Secret Supplier LLC", code: "SKU-SECRET",
        note: "INTERNAL-NOTE margin", quantity: "12", unit: "m²", boqLineIds: [scope.lines[0].id], version: detail.project.version });
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "send_materials", version: detail.project.version });
      // An approved site report with one shared photo and one kept inside.
      const site = new SiteService({ asMember: async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => w.savepoint(async () => fn(w.client, { userId: w.designer })),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => code === "projects.view" } as never, w.storage);
      const pmSite = new SiteService({ asMember: async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => w.savepoint(async () => fn(w.client, { userId: w.manager })),
        hasPermission: async () => true } as never, w.storage);
      const report = randomUUID();
      let reports = await site.command(actor, w.workspaceId, projectId, { id: report, action: "save_report", reportDate: "2026-09-25", noWorkReason: "INTERNAL-SITE measuring only" });
      const png = { buffer: await sharp({ create: { width: 8, height: 8, channels: 3, background: "#8a8a8a" } }).png().toBuffer(), originalname: "kitchen.png", mimetype: "image/png", size: 0 };
      const shown = randomUUID(), hidden = randomUUID();
      await site.uploadPhoto(actor, w.workspaceId, projectId, report, shown, png);
      reports = await site.uploadPhoto(actor, w.workspaceId, projectId, report, hidden, png);
      let mine = reports.reports.find((row) => row.id === report)!;
      reports = await site.command(actor, w.workspaceId, projectId, { action: "submit", reportId: report, version: mine.version });
      await expect(pmSite.command(actor, w.workspaceId, projectId, { action: "share_photo", photoId: shown, shared: true })).rejects.toThrow(/Approve the report/);
      mine = reports.reports.find((row) => row.id === report)!;
      await pmSite.command(actor, w.workspaceId, projectId, { action: "approve", reportId: report, version: mine.version });
      reports = await pmSite.command(actor, w.workspaceId, projectId, { action: "share_photo", photoId: shown, shared: true });
      expect(Object.fromEntries(reports.reports.find((row) => row.id === report)!.photos.map((photo) => [photo.id, photo.shared]))).toEqual({ [shown]: true, [hidden]: false });
      // A tax invoice for the advance, paid by a verified receipt; the second milestone has a pay link.
      const finance = new ReceivablesService({ withPermission: async (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => w.savepoint(async () => fn(w.client, { userId: w.manager })),
        hasPermission: async () => true } as never);
      const invoice = randomUUID();
      await finance.command(actor, w.workspaceId, { commandId: randomUUID(), action: "issue", id: invoice, caseId: w.caseId, paymentId: "p1" });
      await w.client.query(`INSERT INTO commercial_receipts (workspace_id, case_id, id, sort_order, payment_id, legal_entity_id, currency, amount, source, status, reference, detail)
        VALUES ($1, $2, 'r1', 0, 'p1', $3, 'AED', $4, 'manual', 'finance_verified', 'TT-SECRET-1', '{"verifiedAt": "2026-09-27T09:00:00Z", "evidence": "INTERNAL-EVIDENCE"}')`, [w.workspaceId, w.caseId, company, total / 2]);
      await w.client.query(`INSERT INTO commercial_allocations (workspace_id, case_id, id, sort_order, receipt_id, payment_id, legal_entity_id, currency, amount, detail)
        VALUES ($1, $2, 'a1', 0, 'r1', 'p1', $3, 'AED', $4, '{}')`, [w.workspaceId, w.caseId, company, total / 2]);
      await w.client.query(`UPDATE commercial_payments SET detail = detail || '{"invoice": {"provider": "SECRET-PROVIDER", "paymentUrl": "https://pay.example.com/p2", "lastError": "INTERNAL-ERROR"}}'::jsonb
        WHERE workspace_id = $1 AND case_id = $2 AND id = 'p2'`, [w.workspaceId, w.caseId]);
      // A design in review, with a note for the team.
      const asset = randomUUID(), design = randomUUID(), version = randomUUID();
      await w.client.query(`INSERT INTO pre_project_brief_assets (id, workspace_id, case_id, original_name, mime_type, byte_size, object_key, sha256, created_by)
        VALUES ($1, $2, $3, 'kitchen-render.png', 'image/png', 10, $4, repeat('a', 64), $5)`, [asset, w.workspaceId, w.caseId, `designs/${asset}`, w.designer]);
      await w.client.query(`INSERT INTO pre_project_designs (id, workspace_id, case_id, room_id, title, document_type, created_by) VALUES ($1, $2, $3, $4, 'Kitchen render', 'Render', $5)`,
        [design, w.workspaceId, w.caseId, w.kitchen, w.designer]);
      await w.client.query(`INSERT INTO pre_project_design_versions (id, workspace_id, case_id, design_id, number, asset_id, note, status, created_by, client_review_expires_at)
        VALUES ($1, $2, $3, $4, 1, $5, 'INTERNAL-DESIGN-NOTE', 'client_review', $6, now() + interval '5 days')`, [version, w.workspaceId, w.caseId, design, asset, w.designer]);

      const token = await signIn(w, APPROVER);
      const view = await w.portal.view(w.slug, token);
      const unlisted = [...new Set(paths(view))].filter((path) => !ALLOWED.has(path) && !path.includes(".presentation."));
      expect(unlisted).toEqual([]);
      const text = JSON.stringify(view);
      for (const secret of ["424242", "999111", "Secret Supplier", "SKU-SECRET", "INTERNAL-NOTE", "INTERNAL-RISK", "INTERNAL-DESIGN-NOTE", "INTERNAL-EVIDENCE", "INTERNAL-PROOF",
        "INTERNAL-COMMENT", "INTERNAL-ERROR", "INTERNAL-SITE", "SECRET-PROVIDER", "TT-SECRET", "Dana Designer", "at_risk", w.designer, hidden])
        expect(text, secret).not.toContain(secret);

      const project = view.projects[0];
      expect(project).toMatchObject({ id: w.caseId, title: "Villa 12", role: "approver", status: "active", paused: false, manager: "Omar Manager",
        stage: { number: 1, total: expect.any(Number), name: expect.any(String) }, latestUpdate: { text: "Cabinets are in the factory." } });
      expect(project.progress!.updates.map((update) => update.text)).toEqual(["Cabinets are in the factory."]);
      expect(project.progress!.photoDays).toEqual([{ on: "2026-09-25", photos: [{ id: shown }] }]);
      expect(project.decisions!.materials).toMatchObject({ number: 1, status: "sent", canDecide: true,
        items: [{ name: "Oak veneer", specification: "Crown cut", quantity: "12.0000", unit: "m²", areas: ["Kitchen"], decision: null }] });
      expect(project.decisions!.designs).toEqual([expect.objectContaining({ id: version, title: "Kitchen render", status: "client_review", room: "Kitchen", canDecide: false })]);
      // One row per payment: the invoice on it, what was received (a receipt the client can print), and the pay link where one is.
      expect(project.payments!.milestones).toEqual([
        expect.objectContaining({ id: "p1", title: "Advance", status: "paid", amount: `${(total / 2).toFixed(2)}00`, paid: `${(total / 2).toFixed(2)}00`, left: "0.0000",
          invoice: expect.objectContaining({ id: invoice }), receipts: [expect.objectContaining({ amount: `${(total / 2).toFixed(2)}00`, receivedOn: "2026-09-27" })], payUrl: null,
          canReport: false }),
        expect.objectContaining({ id: "p2", title: "Before production", status: "upcoming", invoice: null, payUrl: "https://pay.example.com/p2", canReport: false })]);
      const printed = await w.portal.document(w.slug, token, w.caseId, "invoice", invoice);
      expect(printed).toMatchObject({ kind: "invoice", invoice: { status: "paid", balance: "0.0000" } });
      expect(JSON.stringify(printed)).not.toMatch(/issuedByName|Omar/);
      expect(project.documents).toEqual([]);
      expect(project.messages!.requests[0].comments.map((comment) => [comment.text, comment.fromClient])).toEqual([["Yes, we'll add it.", false]]);
      expect(project.next.map((step) => step.kind)).toEqual(["materials"]);
      // A viewer reads the same project but decides nothing.
      const viewer = await w.portal.view(w.slug, await signIn(w, VIEWER, "whatsapp").catch(async () => {
        // The viewer has no WhatsApp and no email: staff add an email so they can sign in.
        const contact = (await w.admin.contacts(actor, w.workspaceId, w.caseId)).contacts.find((item) => item.phone === VIEWER)!;
        await w.admin.saveContact(actor, w.workspaceId, w.caseId, { id: contact.id, version: contact.version, name: "Sam", phone: VIEWER, email: "sam@example.com", role: "viewer" });
        return signIn(w, VIEWER, "email");
      }));
      expect(viewer.projects[0].role).toBe("viewer");
      expect(viewer.projects[0].decisions!.materials!.canDecide).toBe(false);
      expect(viewer.projects[0].next.map((step) => step.kind)).toEqual([]);

      // What clients see is the tenant's choice: no stage names, no dates, no amounts.
      await savePortalSettings(w.client, w.workspaceId, w.manager, { version: 1, progress: { stageNames: false, dates: false, photos: false }, invoiceAmounts: false });
      const plain = (await w.portal.view(w.slug, token)).projects[0];
      expect(plain.stage!.name).toBeNull();
      expect(plain.handoverDate).toBeNull();
      expect(plain.progress!.stages.every((stage) => stage.name === null && stage.startedOn === null)).toBe(true);
      expect(plain.progress!.photoDays).toEqual([]);
      expect(plain.payments!.milestones[0]).toMatchObject({ amount: null, paid: null, left: null, status: "paid" });
      expect(plain.payments!.milestones[0].receipts[0].amount).toBeNull();
      // A photo not shared can't be opened by guessing its id.
      await expect(w.portal.file(w.slug, token, "photo", hidden, false)).rejects.toThrow(/not found/i);
      await savePortalSettings(w.client, w.workspaceId, w.manager, { version: 2, progress: { photos: true } });
      expect((await w.portal.file(w.slug, token, "photo", shown, false)).mimeType).toBe("image/png");
      // Per project: a narrower set of sections, then paused.
      const access = await w.admin.project(actor, w.workspaceId, projectId);
      await w.admin.saveProject(actor, w.workspaceId, projectId, { version: access.access.version, sections: ["progress", "decisions"] });
      const narrow = (await w.portal.view(w.slug, token)).projects[0];
      expect(narrow.sections).toEqual({ progress: true, moodboard: false, decisions: true, payments: false, documents: false, warranty: false, messages: false });
      expect([narrow.payments, narrow.documents, narrow.messages]).toEqual([null, null, null]);
      await w.admin.saveProject(actor, w.workspaceId, projectId, { version: access.access.version + 1, paused: true });
      const paused = (await w.portal.view(w.slug, token)).projects[0];
      expect(paused).toMatchObject({ paused: true, progress: null, decisions: null, payments: null, next: [] });
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "request", caseId: w.caseId, title: "Hi", detail: "Hello" })).rejects.toThrow(/paused/);
    });
  });

  it("lets the team preview the portal exactly as the decision-maker sees it, without a session and without writing anything", async () => {
    await world(async (w) => {
      // No contact yet: the client is shown as a viewer, named as the team knows them.
      const early = await w.admin.preview(actor, w.workspaceId, w.caseId);
      expect(early.preview).toBe(true);
      expect(early.view.contact.name).toBe("Maya Client");
      expect(early.view.projects[0]).toMatchObject({ id: w.caseId, role: "viewer" });
      const { approver } = await open(w);
      const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
      const quote = data.quotes.find((item) => item.id === w.quoteId)!;
      Object.assign(quote, { status: "issued", issuedAt: new Date().toISOString(), validUntil: "2099-12-31", approverId: approver.id });
      quote.hash = freezeHash(quote);
      data.revision = loaded.revision + 1;
      await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
      const token = await signIn(w, APPROVER);
      const client = await w.portal.view(w.slug, token);
      const count = async () => (await w.client.query(
        `SELECT (SELECT count(*) FROM client_portal_sessions WHERE workspace_id = $1)::int + (SELECT count(*) FROM client_portal_commands WHERE workspace_id = $1)::int
              + (SELECT count(*) FROM audit_events WHERE workspace_id = $1)::int AS n`, [w.workspaceId])).rows[0].n;
      const before = await count();
      const preview = await w.admin.preview(actor, w.workspaceId, w.caseId);
      expect(preview.site.slug).toBe(w.slug);
      // The same projects, sections and decisions the decision-maker sees, the quotation still waiting for them.
      expect(preview.view.projects).toEqual(client.projects);
      expect(preview.view.projects[0].decisions!.quotes[0]).toMatchObject({ id: w.quoteId, status: "issued", canDecide: true });
      expect(await count()).toBe(before);
      await expect(w.admin.preview(actor, w.workspaceId, randomUUID())).rejects.toThrow(/not found/i);
    });
  });

  it("takes each decision once, on the exact revision, with a code bound to it; the first decision-maker wins", async () => {
    await world(async (w) => {
      const { approver } = await open(w);
      // A second decision-maker on the same project.
      await w.admin.saveContact(actor, w.workspaceId, w.caseId, { name: "Ravi", phone: "+15550100003", email: "ravi@example.com", role: "approver" });
      // The quotation is issued to Maya.
      const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
      const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
      const quote = data.quotes.find((item) => item.id === w.quoteId)!;
      quote.status = "issued";
      quote.issuedAt = new Date().toISOString();
      quote.validUntil = "2099-12-31";
      quote.approverId = approver.id;
      quote.hash = freezeHash(quote);
      data.revision = loaded.revision + 1;
      await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
      const token = await signIn(w, APPROVER);
      const view = await w.portal.view(w.slug, token);
      expect(view.projects[0].decisions!.quotes[0]).toMatchObject({ id: w.quoteId, status: "issued", canDecide: true });
      expect(view.projects[0].next).toEqual([expect.objectContaining({ kind: "quote", id: w.quoteId })]);
      // Another decision-maker can't ask for a code for Maya's quotation.
      const ravi = await signIn(w, "+15550100003");
      await expect(w.portal.challenge(w.slug, { purpose: `quote:${w.caseId}:${w.quoteId}:accept` }, ravi, "203.0.113.7")).rejects.toThrow(/another decision-maker/);
      // A wrong code is refused, nothing changes, and the try counts.
      const purpose = `quote:${w.caseId}:${w.quoteId}:accept`;
      const { challengeId, code } = await decisionCode(w, token, purpose);
      const command = { commandId: randomUUID(), action: "quote_decision", caseId: w.caseId, quoteId: w.quoteId, decision: "accept", selectedOptionLineIds: ["c"], hash: quote.hash, challengeId };
      await expect(w.portal.command(w.slug, token, { ...command, code: code === "000000" ? "111111" : "000000" })).rejects.toThrow(/isn't right/);
      expect((await w.client.query("SELECT attempts FROM client_portal_challenges WHERE id = $1", [challengeId])).rows[0].attempts).toBe(1);
      expect((await w.client.query("SELECT count(*)::int AS n FROM client_portal_commands WHERE workspace_id = $1", [w.workspaceId])).rows[0].n).toBe(0);
      // The code for "accept" doesn't decline.
      await expect(w.portal.command(w.slug, token, { ...command, commandId: randomUUID(), decision: "decline", note: "No", selectedOptionLineIds: [], code })).rejects.toThrow(/isn't right/);
      const accepted = await w.portal.command(w.slug, token, { ...command, commandId: randomUUID(), code });
      expect(accepted).toMatchObject({ ok: true });
      const saved = ((await commercialRepository.load(w.client, w.workspaceId, w.caseId))!.content as CommercialData).quotes.find((item) => item.id === w.quoteId)!;
      expect(saved).toMatchObject({ status: "accepted", decidedBy: "Maya", clientDecision: { decision: "accept", selectedOptionLineIds: ["c"], quoteHash: quote.hash } });
      // The same command again returns the first result; a different body under its id is refused.
      const replayId = randomUUID();
      await w.portal.command(w.slug, token, { commandId: replayId, action: "request", caseId: w.caseId, title: "Paint", detail: "Which white?" });
      expect(await w.portal.command(w.slug, token, { commandId: replayId, action: "request", caseId: w.caseId, title: "Paint", detail: "Which white?" })).toMatchObject({ ok: true, replayed: true });
      await expect(w.portal.command(w.slug, token, { commandId: replayId, action: "request", caseId: w.caseId, title: "Paint", detail: "Other" })).rejects.toThrow(/different details/);
      // Every command is audited with the client contact.
      const audits = (await w.client.query("SELECT action, source, actor_user_id, after->>'grantId' AS grant FROM audit_events WHERE workspace_id = $1 AND source = 'client_portal' ORDER BY occurred_at",
        [w.workspaceId])).rows;
      expect(audits).toEqual([{ action: "client_portal.quote_decision", source: "client_portal", actor_user_id: null, grant: approver.id },
        { action: "client_portal.request", source: "client_portal", actor_user_id: null, grant: approver.id }]);
      // The account manager hears the client's decision; the case owner hears the request, with a link to its thread.
      expect((await w.client.query("SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND event_type = 'quotation.client_accepted'", [w.workspaceId])).rows[0].n).toBeGreaterThan(0);
      const requestNotices = (await w.client.query<{ deepLink: string; body: string }>(
        "SELECT deep_link AS \"deepLink\", body FROM notifications WHERE workspace_id = $1 AND event_type = 'request.client_raised' AND channel = 'in_app'", [w.workspaceId])).rows;
      expect(requestNotices.length).toBeGreaterThan(0);
      expect(requestNotices[0].deepLink).toMatch(new RegExp(`^/workspace/pre-projects/cases/${w.caseId}/variations\\?request=[0-9a-f-]{36}$`));
      expect(requestNotices[0].body).toContain("Paint: Which white?");

      // A viewer reads but never decides, even with a well-formed command.
      const viewer = await signIn(w, VIEWER, "whatsapp").catch(async () => {
        const contact = (await w.admin.contacts(actor, w.workspaceId, w.caseId)).contacts.find((item) => item.phone === VIEWER)!;
        await w.admin.saveContact(actor, w.workspaceId, w.caseId, { id: contact.id, version: contact.version, name: "Sam", phone: VIEWER, email: "sam@example.com", role: "viewer" });
        return signIn(w, VIEWER, "email");
      });
      await expect(w.portal.challenge(w.slug, { purpose: `quote:${w.caseId}:${w.quoteId}:accept` }, viewer, "203.0.113.7")).rejects.toThrow(/decision-maker/);
      await expect(w.portal.command(w.slug, viewer, { commandId: randomUUID(), action: "materials_decision", caseId: w.caseId, revisionId: randomUUID(), challengeId: randomUUID(), code: "123456" }))
        .rejects.toThrow(/decision-maker/);

      // A design shared for review: approved in the portal with a code bound to that version.
      const asset = randomUUID(), design = randomUUID(), version = randomUUID();
      await w.client.query(`INSERT INTO pre_project_brief_assets (id, workspace_id, case_id, original_name, mime_type, byte_size, object_key, sha256, created_by)
        VALUES ($1, $2, $3, 'render.png', 'image/png', 10, $4, repeat('a', 64), $5)`, [asset, w.workspaceId, w.caseId, `designs/${asset}`, w.designer]);
      await w.client.query(`INSERT INTO pre_project_designs (id, workspace_id, case_id, title, document_type, created_by) VALUES ($1, $2, $3, 'Living render', 'Render', $4)`,
        [design, w.workspaceId, w.caseId, w.designer]);
      await w.client.query(`INSERT INTO pre_project_design_versions (id, workspace_id, case_id, design_id, number, asset_id, status, created_by, client_review_expires_at)
        VALUES ($1, $2, $3, $4, 1, $5, 'client_review', $6, now() + interval '5 days')`, [version, w.workspaceId, w.caseId, design, asset, w.designer]);
      expect((await w.portal.view(w.slug, token)).projects[0].decisions!.designs).toEqual([expect.objectContaining({ id: version, status: "client_review", canDecide: true })]);
      const designProof = await decisionCode(w, token, `design:${w.caseId}:${version}:accept`);
      await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "design_decision", caseId: w.caseId, versionId: version, decision: "accept", ...designProof });
      expect((await w.client.query("SELECT status FROM pre_project_design_versions WHERE id = $1", [version])).rows[0].status).toBe("approved");
      expect((await w.client.query("SELECT decision_source, client_grant_id FROM pre_project_design_activity WHERE version_id = $1", [version])).rows)
        .toEqual([{ decision_source: "client_portal", client_grant_id: approver.id }]);
      // Approved, it moves to Documents.
      expect((await w.portal.view(w.slug, token)).projects[0].documents).toEqual([expect.objectContaining({ id: version, kind: "design", title: "Living render · V1" })]);
    });
  });

  it("signs the material list off item by item, and accepts or refuses a handover, which starts the warranty the client can then claim on", async () => {
    await world(async (w) => {
      await open(w);
      await w.admin.saveContact(actor, w.workspaceId, w.caseId, { name: "Ravi", phone: "+15550100003", email: "ravi@example.com", role: "approver" });
      const { projectId } = await started(w);
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", version: detail.project.version });
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Brass handles", version: detail.project.version });
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "send_materials", version: detail.project.version });
      const token = await signIn(w, APPROVER);
      let materials = (await w.portal.view(w.slug, token)).projects[0].decisions!.materials!;
      const purpose = `materials:${w.caseId}:${materials.id}:submit`;
      let proof = await decisionCode(w, token, purpose);
      await expect(w.portal.command(w.slug, token, { commandId: randomUUID(), action: "materials_decision", caseId: w.caseId, revisionId: materials.id, ...proof,
        decisions: materials.items.map((item) => ({ itemId: item.id, decision: "rejected" })) })).rejects.toThrow(/what the client wants instead/);
      proof = await decisionCode(w, token, purpose);
      await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "materials_decision", caseId: w.caseId, revisionId: materials.id, ...proof,
        decisions: materials.items.map((item) => ({ itemId: item.id, decision: "approved" })) });
      materials = (await w.portal.view(w.slug, token)).projects[0].decisions!.materials!;
      expect(materials).toMatchObject({ status: "signed_off", decidedBy: "Maya", canDecide: false });
      expect((await w.client.query("SELECT decision_method, recorded_by, decided_by_grant_id IS NOT NULL AS by_client FROM project_material_revisions WHERE project_id = $1", [projectId])).rows)
        .toEqual([{ decision_method: "portal", recorded_by: null, by_client: true }]);
      // The other decision-maker is too late and sees why.
      const ravi = await signIn(w, "+15550100003");
      await expect(w.portal.challenge(w.slug, { purpose }, ravi, "203.0.113.7")).rejects.toThrow(/isn't waiting/);

      // Handover: a whole-project pack is issued; refused with why, then the next revision accepted.
      const handover = new HandoverService({ asMember: async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => w.savepoint(async () => fn(w.client, { userId: w.manager })),
        hasPermission: async () => true } as never, w.storage);
      const pack = randomUUID();
      let state = await handover.command(actor, w.workspaceId, projectId, { action: "create_pack", id: pack, title: "Villa handover", areaIds: [] });
      state = await handover.uploadDocument(actor, w.workspaceId, projectId, pack, randomUUID(), { kind: "manual", title: "Care guide" },
        { buffer: Buffer.from("%PDF-1.4\n%care\n"), originalname: "care.pdf", mimetype: "application/pdf", size: 0 });
      state = await handover.command(actor, w.workspaceId, projectId, { action: "issue", packId: pack, version: state.packs[0].version, confirmOpen: true, openReason: "Client walk-through before the last stages" });
      expect((await w.client.query("SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND recipient_type = 'portal_contact' AND event_type = 'portal.decision_waiting'",
        [w.workspaceId])).rows[0].n).toBe(4);
      let view = (await w.portal.view(w.slug, token)).projects[0];
      expect(view.decisions!.handovers).toEqual([expect.objectContaining({ id: pack, revision: 1, status: "issued", canDecide: true, documents: [expect.objectContaining({ title: "Care guide" })] })]);
      expect(view.documents!.map((document) => [document.kind, document.title])).toEqual([["handover", "Care guide"]]);
      proof = await decisionCode(w, token, `handover:${w.caseId}:${pack}:refuse`);
      await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "handover_decision", caseId: w.caseId, packId: pack, decision: "refuse", reason: "Scratch on the island", ...proof });
      const snags = (await w.client.query("SELECT title, severity, source, created_by FROM work_items WHERE project_id = $1 AND type = 'snag'", [projectId])).rows;
      expect(snags).toEqual([{ title: "Handover refused: Scratch on the island", severity: "major", source: "client", created_by: w.manager }]);
      state = await handover.state(actor, w.workspaceId, projectId);
      const next = state.packs.find((item) => item.status === "draft")!;
      state = await handover.command(actor, w.workspaceId, projectId, { action: "issue", packId: next.id, version: next.version, confirmOpen: true, openReason: "Client walk-through before the last stages" });
      proof = await decisionCode(w, token, `handover:${w.caseId}:${next.id}:accept`);
      await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "handover_decision", caseId: w.caseId, packId: next.id, decision: "accept", outstanding: ["Touch up the skirting"], ...proof });
      expect((await w.client.query("SELECT status, decision_method, recorded_by, decided_by_name FROM handover_packs WHERE id = $1", [next.id])).rows)
        .toEqual([{ status: "accepted", decision_method: "portal", recorded_by: null, decided_by_name: "Maya" }]);
      // The warranty started that day, and the client can claim on it.
      view = (await w.portal.view(w.slug, token)).projects[0];
      expect(view.warranty!.canClaim).toBe(true);
      expect(view.warranty!.rooms.length).toBeGreaterThan(0);
      const claim = await w.portal.command(w.slug, token, { commandId: randomUUID(), action: "warranty_claim", caseId: w.caseId, description: "Drawer won't close", lineId: view.warranty!.lines[0].id });
      expect((await w.client.query("SELECT channel, created_by, client_grant_id IS NOT NULL AS by_client, raised_by_name FROM warranty_claims WHERE id = $1", [claim.claimId])).rows)
        .toEqual([{ channel: "portal", created_by: null, by_client: true, raised_by_name: "Maya" }]);
      expect((await w.client.query("SELECT recipient_id::text AS who, channel FROM notifications WHERE workspace_id = $1 AND event_type = 'warranty.claim' ORDER BY channel, recipient_id", [w.workspaceId])).rows)
        .toEqual(expect.arrayContaining([{ who: w.manager, channel: "email" }, { who: w.manager, channel: "in_app" }]));
      view = (await w.portal.view(w.slug, token)).projects[0];
      expect(view.warranty!.claims).toEqual([expect.objectContaining({ number: 1, description: "Drawer won't close", status: "open", reason: "" })]);
    });
  });

  it("tells clients once per event, by email in the tenant's brand, never while paused or for a hidden section", async () => {
    await world(async (w) => {
      await open(w);
      const { projectId } = await started(w);
      const count = async (code: string) => (await w.client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND recipient_type = 'portal_contact' AND event_type = $2", [w.workspaceId, code])).rows[0].n;
      // Only contacts with an email; decisions only to decision-makers.
      expect(await tellClients(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, event: "quote_issued", recordId: "q:1", title: "Main quote (V1)", due: "2026-10-30" })).toMatchObject({ queued: 1 });
      expect(await tellClients(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, event: "quote_issued", recordId: "q:1", title: "Main quote (V1)" })).toMatchObject({ queued: 0 });
      const email = (await w.client.query("SELECT subject, body, deep_link AS link, status FROM notifications WHERE workspace_id = $1 AND event_type = 'portal.quote_issued'", [w.workspaceId])).rows[0];
      expect(email).toEqual({ subject: "Main quote (V1) is ready for you", body: expect.stringContaining("Studio Interiors sent you Main quote (V1) for Villa 12."),
        link: `/portal/${w.slug}?project=${w.caseId}&open=decisions`, status: "pending" });
      // Shared updates tell the client once; an update kept inside tells nobody.
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "post_update", health: "on_track", note: "Tiles laid", version: detail.project.version });
      expect(await count("portal.update_published")).toBe(0);
      const updateId = detail.updates[0].id;
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "share_update", updateId, shared: true, version: detail.project.version });
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "share_update", updateId, shared: false, version: detail.project.version });
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "share_update", updateId, shared: true, version: detail.project.version });
      expect(await count("portal.update_published")).toBe(1);
      // A hidden section and a paused project tell nobody.
      const access = await w.admin.project(actor, w.workspaceId, projectId);
      await w.admin.saveProject(actor, w.workspaceId, projectId, { version: access.access.version, sections: ["decisions"] });
      expect(await tellClients(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, event: "update_published", recordId: "u:2", title: "Villa 12", note: "More" })).toMatchObject({ reason: "hidden" });
      await w.admin.saveProject(actor, w.workspaceId, projectId, { version: access.access.version + 1, paused: true });
      expect(await tellClients(w.client, { workspaceId: w.workspaceId, caseId: w.caseId, event: "decision_waiting", recordId: "d:1", title: "Render" })).toMatchObject({ reason: "paused" });
      // The platform mailer sends them in the tenant's brand, to the contact's email.
      const mailer = { sendStaffNotice: vi.fn(async () => ({ status: "sent" as const, provider: "mailgun" as const, messageId: "m1" })) };
      const notices = new CrmNotificationsService({ tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => Promise<unknown>) => w.savepoint(() => fn(w.client)) } as never,
        {} as never, {} as never, undefined, undefined, mailer as never);
      const result = await notices.dispatchStaffEmailsInternal({ workspaceId: w.workspaceId, limit: 50 });
      expect(result.delivered).toBeGreaterThanOrEqual(2);
      expect(mailer.sendStaffNotice).toHaveBeenCalledWith(expect.objectContaining({ to: "maya@example.com", subject: "Main quote (V1) is ready for you", actionLabel: "Open your project",
        deepLink: `/portal/${w.slug}?project=${w.caseId}&open=decisions` }));
      expect(await count("portal.quote_issued")).toBe(1);
    });
  });

  it("invites the project's client from the project record: one email with the portal address and a link that opens it with their number; the team hears their first sign-in; access can be taken away", async () => {
    await world(async (w) => {
      await savePortalSettings(w.client, w.workspaceId, w.manager, { version: 0, enabled: true });
      const { projectId } = await started(w);
      const contactPoint = (type: "phone" | "email", value: string, label: string | null, country: string | null) => w.client.query(
        `INSERT INTO crm_contact_points (workspace_id, party_id, type, label, raw_value, normalized_value, country_code, is_primary) VALUES ($1, $2, $3::crm_contact_point_type, $4, $5::text, lower($5::text), $6, true)`,
        [w.workspaceId, w.party, type, label, value, country]);
      // The CRM client has neither a mobile number nor an email yet: the project record says what to add, in that order.
      let portal = await w.admin.project(actor, w.workspaceId, projectId);
      expect(portal.portalUrl).toBe(`https://app.example.com/portal/${w.slug}`);
      expect(portal.client).toMatchObject({ name: "Maya Client", partyId: w.party, status: "not_invited", grantId: null, blocked: "no_phone" });
      await expect(w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId: randomUUID(), version: 0 })).rejects.toThrow(/mobile number first/);
      await contactPoint("phone", "050 010 0001", "mobile", "AE");
      expect((await w.admin.project(actor, w.workspaceId, projectId)).client).toMatchObject({ phone: "+971500100001", blocked: "no_email" });
      await expect(w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId: randomUUID(), version: 0 })).rejects.toThrow(/Add an email/);
      await contactPoint("email", "Client@PalmLiving.test", null, null);
      // Invited: the grant exists (a decision-maker), the email went to the client with the tenant's name, and the command replays safely.
      const commandId = randomUUID();
      portal = await w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId, version: 0 });
      expect(portal.client).toMatchObject({ status: "invited", email: "client@palmliving.test", phone: "+971500100001", delivery: "sent", blocked: null, version: 1 });
      expect(portal.client.invitedAt).toBeTruthy();
      expect(portal.client.resendAfter).toBeGreaterThan(0);
      expect(portal.contacts).toEqual([expect.objectContaining({ name: "Maya Client", phone: "+971500100001", email: "client@palmliving.test", role: "approver", active: true })]);
      expect(w.invites).toEqual([expect.objectContaining({ to: "client@palmliving.test", recipientName: "Maya Client", projectName: "Villa 12", company: "Studio Interiors",
        portalUrl: portal.portalUrl, phoneHint: "01", channel: "email" })]);
      expect(w.invites[0].inviteUrl).toMatch(new RegExp(`^https://app\\.example\\.com/portal/${w.slug}\\?invite=[A-Za-z0-9_-]{43}$`));
      expect((await w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId, version: 0 })).client.status).toBe("invited");
      await expect(w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId, version: 1 })).rejects.toThrow(/different details/);
      expect(w.invites).toHaveLength(1);
      // Another invite waits; a stale version is refused.
      await expect(w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId: randomUUID(), version: 1 })).rejects.toMatchObject({ status: 429 });
      await expect(w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId: randomUUID(), version: 0 })).rejects.toThrow(/Reload/);
      expect((await w.client.query("SELECT action FROM audit_events WHERE workspace_id = $1 AND action = 'client_portal.client_invited'", [w.workspaceId])).rowCount).toBe(1);
      // The link opens the portal with the client's number; a made-up one opens nothing.
      const token = new URL(w.invites[0].inviteUrl).searchParams.get("invite")!;
      expect(await w.portal.invitation(w.slug, token)).toEqual({ status: "valid", name: "Maya Client", phone: "+971500100001" });
      await expect(w.portal.invitation(w.slug, "not-a-real-token-at-all-0000")).rejects.toThrow(/isn't valid/);
      // The client signs in: the project's manager hears it once, in the app; the record shows them active.
      const session = await signIn(w, "+971500100001");
      const notices = () => w.client.query("SELECT recipient_id AS who, subject, deep_link AS link FROM notifications WHERE workspace_id = $1 AND event_type = 'client_portal.client_signed_in'", [w.workspaceId]);
      expect((await notices()).rows).toEqual([{ who: w.manager, subject: "Maya Client opened the client portal", link: `/workspace/projects/${projectId}/updates` }]);
      await signIn(w, "+971500100001");
      expect((await notices()).rowCount).toBe(1);
      // One transaction, one now(): the invite is older than the visit in real life.
      await w.client.query("UPDATE client_portal_invitations SET sent_at = sent_at - interval '1 minute' WHERE workspace_id = $1", [w.workspaceId]);
      portal = await w.admin.project(actor, w.workspaceId, projectId);
      expect(portal.client).toMatchObject({ status: "active", version: 1 });
      expect(portal.client.lastVisitAt).toBeTruthy();
      // An expired link says so, without ending access.
      await w.client.query("UPDATE client_portal_invitations SET sent_at = now() - interval '15 days', expires_at = now() - interval '1 day' WHERE workspace_id = $1", [w.workspaceId]);
      expect(await w.portal.invitation(w.slug, token)).toEqual({ status: "expired" });
      expect((await w.portal.view(w.slug, session)).projects).toHaveLength(1);
      // Revoked: sessions end, the client can't sign in, and the command replays safely.
      const revoke = randomUUID();
      portal = await w.admin.revokeClient(actor, w.workspaceId, projectId, { commandId: revoke, version: 1 });
      expect(portal.client).toMatchObject({ status: "revoked", version: 2, lastVisitAt: null });
      expect(portal.contacts[0].active).toBe(false);
      await expect(w.portal.view(w.slug, session)).rejects.toThrow(/signed out|ended/);
      expect((await w.admin.revokeClient(actor, w.workspaceId, projectId, { commandId: revoke, version: 1 })).client.status).toBe("revoked");
      expect((await w.client.query("SELECT 1 FROM audit_events WHERE workspace_id = $1 AND action = 'client_portal.client_revoked'", [w.workspaceId])).rowCount).toBe(1);
      // Invited again (their last visit was before): the same contact, turned back on, with a fresh link; they're invited until they come back.
      await w.client.query("UPDATE client_portal_sessions SET last_seen_at = last_seen_at - interval '1 hour' WHERE workspace_id = $1", [w.workspaceId]);
      await w.client.query("UPDATE client_portal_grants SET last_signed_in_at = last_signed_in_at - interval '1 hour' WHERE workspace_id = $1", [w.workspaceId]);
      portal = await w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId: randomUUID(), version: 2 });
      expect(portal.client).toMatchObject({ status: "invited", grantId: portal.contacts[0].id, version: 3 });
      expect(portal.contacts).toHaveLength(1);
      expect(w.invites).toHaveLength(2);
      expect(w.invites[1].inviteUrl).not.toBe(w.invites[0].inviteUrl);
      // Nothing goes out while the portal is off for the workspace or paused for the project.
      await w.admin.saveProject(actor, w.workspaceId, projectId, { version: 0, paused: true });
      expect((await w.admin.project(actor, w.workspaceId, projectId)).client.blocked).toBe("paused");
      await expect(w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId: randomUUID(), version: 3 })).rejects.toThrow(/paused/);
      await savePortalSettings(w.client, w.workspaceId, w.manager, { version: 1, enabled: false });
      expect((await w.admin.project(actor, w.workspaceId, projectId)).client.blocked).toBe("portal_off");
      await expect(w.admin.inviteClient(actor, w.workspaceId, projectId, { commandId: randomUUID(), version: 3 })).rejects.toThrow(/off for the workspace/);
    });
  });

  it("signs a demonstration contact in with the code an admin set, sends them nothing, and keeps every other number as it was", async () => {
    await world(async (w) => {
      const { approver, viewer } = await open(w);
      // A workspace admin sets the code on one contact: six digits, once per command, version-checked, audited.
      await expect(w.admin.demoCode(actor, w.workspaceId, w.caseId, approver.id, { commandId: randomUUID(), version: approver.version, code: "12345" })).rejects.toThrow(/six-digit/);
      await expect(w.admin.demoCode(actor, w.workspaceId, w.caseId, approver.id, { commandId: randomUUID(), version: approver.version + 5, code: "123456" })).rejects.toThrow(/Reload/);
      const set = randomUUID();
      let contacts = await w.admin.demoCode(actor, w.workspaceId, w.caseId, approver.id, { commandId: set, version: approver.version, code: "123456" });
      let demo = contacts.contacts.find((contact) => contact.id === approver.id)!;
      expect([demo.demoCode, demo.version]).toEqual([true, approver.version + 1]);
      expect((await w.client.query("SELECT demo_code_hash, demo_code_set_by FROM client_portal_grants WHERE id = $1", [approver.id])).rows[0])
        .toEqual({ demo_code_hash: expect.stringMatching(/^[0-9a-f]{64}$/), demo_code_set_by: w.manager });
      // The same command again is a no-op; a different body under the same id is refused.
      expect((await w.admin.demoCode(actor, w.workspaceId, w.caseId, approver.id, { commandId: set, version: approver.version, code: "123456" })).contacts.find((contact) => contact.id === approver.id)!.version).toBe(demo.version);
      await expect(w.admin.demoCode(actor, w.workspaceId, w.caseId, approver.id, { commandId: set, version: approver.version, code: "654321" })).rejects.toThrow(/different details/);
      expect((await w.client.query("SELECT count(*)::int AS n FROM audit_events WHERE workspace_id = $1 AND action = 'client_portal.demo_code_set'", [w.workspaceId])).rows[0].n).toBe(1);

      // Signing in: no WhatsApp or email goes to the demonstration contact; their code opens the session; a wrong one doesn't.
      const sentBefore = w.sent.length;
      const challenge = await w.portal.challenge(w.slug, { phone: APPROVER }, "", "203.0.113.7");
      expect(w.sent).toHaveLength(sentBefore);
      await expect(w.portal.login(w.slug, { challengeId: challenge.challengeId, code: "111111" })).rejects.toThrow(/isn't right/);
      const session = await w.portal.login(w.slug, { challengeId: challenge.challengeId, code: "123456" });
      expect(session.token).toBeTruthy();
      expect((await w.portal.view(w.slug, session.token)).contact.phone).toBe(APPROVER);
      // Another number (a contact without a demonstration code, or a stranger) with 123456 fails.
      for (const phone of [VIEWER, STRANGER]) {
        await w.client.query("UPDATE client_portal_challenges SET created_at = created_at - interval '1 minute' WHERE workspace_id = $1", [w.workspaceId]);
        const other = await w.portal.challenge(w.slug, { phone }, "", "203.0.113.7");
        await expect(w.portal.login(w.slug, { challengeId: other.challengeId, code: "123456" })).rejects.toThrow(/isn't right/);
      }
      expect(viewer.demoCode).toBe(false);

      // Clearing the code ends the demonstration: their sessions end and 123456 no longer signs them in.
      contacts = await w.admin.demoCode(actor, w.workspaceId, w.caseId, approver.id, { commandId: randomUUID(), version: demo.version, code: null });
      demo = contacts.contacts.find((contact) => contact.id === approver.id)!;
      expect(demo.demoCode).toBe(false);
      await expect(w.portal.view(w.slug, session.token)).rejects.toThrow(/signed out/);
      await w.client.query("UPDATE client_portal_challenges SET created_at = created_at - interval '1 minute' WHERE workspace_id = $1", [w.workspaceId]);
      const again = await w.portal.challenge(w.slug, { phone: APPROVER }, "", "203.0.113.7");
      await expect(w.portal.login(w.slug, { challengeId: again.challengeId, code: "123456" })).rejects.toThrow(/isn't right/);
      expect(w.sent.at(-1)).toMatchObject({ channel: "whatsapp", to: APPROVER });
      expect((await w.client.query("SELECT count(*)::int AS n FROM audit_events WHERE workspace_id = $1 AND action = 'client_portal.demo_code_cleared'", [w.workspaceId])).rows[0].n).toBe(1);
      expect((await w.client.query("SELECT demo_code_hash, demo_code_set_by, demo_code_set_at FROM client_portal_grants WHERE id = $1", [approver.id])).rows[0])
        .toEqual({ demo_code_hash: null, demo_code_set_by: null, demo_code_set_at: null });
    });
  });
});
