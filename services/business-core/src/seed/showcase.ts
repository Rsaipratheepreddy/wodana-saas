import { createHash, randomUUID } from "node:crypto";
import { HttpException, ValidationPipe, type INestApplicationContext, type Type } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { ClientPortalAdminService } from "../client-portal/client-portal-admin.service";
import { ClientPortalService } from "../client-portal/client-portal.service";
import { CommercialService } from "../commercial/commercial.service";
import { isOperationalEvidence } from "../commercial/release-integrity";
import { CrmIntakeService } from "../crm/intake/crm-intake.service";
import { CreateIntakeEventDto } from "../crm/intake/dto/intake.dto";
import { CrmLeadsService } from "../crm/leads/crm-leads.service";
import { CrmOpportunitiesService } from "../crm/opportunities/crm-opportunities.service";
import { QualifyLeadDto, TransitionOpportunityDto } from "../crm/opportunities/dto/opportunities.dto";
import { DatabaseService } from "../database/database.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { FactoryService } from "../factory/factory.service";
import { BriefService } from "../pre-projects/brief.service";
import { MoodboardPinDto, SaveBriefEntryDto, SaveRoomDto } from "../pre-projects/brief.dto";
import { DesignService } from "../pre-projects/design.service";
import { DesignActivityDto, UploadDesignFilesDto } from "../pre-projects/design.dto";
import { ItemSpecificationService } from "../pre-projects/item-specification.service";
import { SaveItemSpecificationDto } from "../pre-projects/item-specification.dto";
import { PreProjectsService } from "../pre-projects/pre-projects.service";
import { SiteService as PlanningSiteService } from "../pre-projects/site.service";
import { ReviewSiteMeasurementDto, SaveSiteMeasurementDto, SaveSiteVisitDto } from "../pre-projects/site.dto";
import { ProjectCoreService } from "../project-core/project-core.service";
import { ProjectWorkService } from "../project-core/project-work.service";
import { OrdersService } from "../purchasing/orders.service";
import { ReceivingService } from "../purchasing/receiving.service";
import { SuppliersService } from "../purchasing/suppliers.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { HandoverService } from "../site/handover.service";
import { SiteService } from "../site/site.service";
import { WarrantyService } from "../site/warranty.service";

/**
 * The showcase: one demonstration client and project, "Demo Client — Villa 12", run end to end through the
 * core's own services and commands (validation, permissions, audit and forced RLS apply as for the app).
 * Nothing signs in: every step acts as an existing member of the workspace, resolved by user id.
 *
 * Idempotent: every record has a stable id or reference, so a second run finds what the first made and
 * creates nothing. A stage the product refuses (a rule not met here, a missing person) is reported and the run
 * continues with what it can.
 */

// ---------------------------------------------------------------- input and result

export type ShowcaseRole = "sales" | "salesAdmin" | "designer" | "estimator" | "owner" | "manager" | "projectManager" | "finance" | "buyer" | "factory" | "site";

export type ShowcaseInput = {
  app: INestApplicationContext;
  workspaceId: string;
  /** The person every step falls back to when no one is given for its role: an administrator or the owner. */
  actorUserId: string;
  /** User ids per role; any role not given falls back to actorUserId. */
  actors?: Partial<Record<ShowcaseRole, string | null | undefined>>;
  /** The bootstrap's people by team code (SALES, QS, FINANCE, …); only active members count. */
  roleActors?: Record<string, { userId: string; membershipId?: string | null; active?: boolean }>;
  /** Emails leave the process only when true; otherwise every send is recorded as suppressed. */
  deliverEmail?: boolean;
  log?: (line: string) => void;
  /** A ledger to write into (the bootstrap seed's report); optional. */
  report?: { record?: (type: string, outcome: "created" | "reused" | "pending" | "changed", detail?: string) => void; notes?: string[]; notices?: string[] };
};

export type ShowcaseResult = {
  created: string[];
  reused: string[];
  skipped: Array<{ stage: string; reason: string }>;
  ids: { leadId?: string; partyId?: string; opportunityId?: string; caseId?: string; grantId?: string; quoteId?: string; projectId?: string; orderId?: string; workOrderId?: string };
};

/** The story's constants: a fictional client, clearly a demonstration. */
export const SHOWCASE = {
  reference: "SHOWCASE-VILLA-12",
  client: { displayName: "Dana Demo", email: "demo.client@palmliving.test", mobile: "+971501234567", demoCode: "123456" },
  title: "Demo Client — Villa 12",
  summary: "Demonstration enquiry: a four-bedroom villa; living room, dining room and master bedroom with a fitted media wall made in the factory. All records are a demonstration, not a real client.",
  area: "Dubai Hills",
  rooms: ["Living room", "Dining room", "Master bedroom"],
};

/** The quotation's lines: named after the workspace catalog when it has them, with the seed's rates and costs. */
const QUOTE_LINES = [
  { key: "living-media", room: "Living room", catalog: "TV unit", title: "Fitted media wall · oak veneer, concealed cabling", quantity: "1", unit: "nos", unitCost: "9800", rate: "17100" },
  { key: "living-floor", room: "Living room", catalog: "Engineered oak flooring 14mm", quantity: "45", unit: "sqm", unitCost: "190", rate: "320" },
  { key: "living-paint", room: "Living room", catalog: "Wall painting, 2 coats", quantity: "120", unit: "sqm", unitCost: "14", rate: "28" },
  { key: "living-lights", room: "Living room", catalog: "LED downlight 9W warm", quantity: "12", unit: "nos", unitCost: "45", rate: "95" },
  { key: "dining-light", room: "Dining room", catalog: "Pendant light", quantity: "1", unit: "nos", unitCost: "950", rate: "1600" },
  { key: "dining-ceiling", room: "Dining room", catalog: "Gypsum false ceiling with cove", quantity: "30", unit: "sqm", unitCost: "85", rate: "160" },
  { key: "dining-paint", room: "Dining room", catalog: "Wall painting, 2 coats", quantity: "60", unit: "sqm", unitCost: "14", rate: "28" },
  { key: "bed-wardrobe", room: "Master bedroom", catalog: "Wardrobe · hinged", title: "Hinged wardrobe · wall to wall, matt laminate", quantity: "1", unit: "nos", unitCost: "8400", rate: "14500" },
  { key: "bed-floor", room: "Master bedroom", catalog: "Engineered oak flooring 14mm", quantity: "30", unit: "sqm", unitCost: "190", rate: "320" },
  { key: "bed-paint", room: "Master bedroom", catalog: "Wall painting, 2 coats", quantity: "80", unit: "sqm", unitCost: "14", rate: "28" },
] as Array<{ key: string; room: string; catalog: string; title?: string; quantity: string; unit: string; unitCost: string; rate: string }>;

const TEAM_ROLES: Record<string, ShowcaseRole> = {
  SALES: "sales", SALES_ADMIN: "salesAdmin", SHOWROOM: "sales", INTERIOR_DESIGN: "designer", QS: "estimator", FINANCE: "finance", PROCUREMENT: "buyer",
  PRODUCTION: "factory", PROJECT_MANAGERS: "projectManager", OPS_ADMIN: "manager",
};

type Any = Record<string, any>;
type Actor = RequestActor & { userId: string; membershipId: string | null };
type Upload = { buffer: Buffer; originalname: string; mimetype: string; size: number };

/** A stage that can't go on in this run: reported, never a failure. */
class Skip extends Error {
  constructor(readonly reason: string) { super(reason); }
}

// ---------------------------------------------------------------- entry point

export async function seedShowcase(input: ShowcaseInput): Promise<ShowcaseResult> {
  const seed = new ShowcaseSeed(input);
  await seed.prepare();
  const restore = seed.suppressEmail();
  try {
    return await seed.run();
  } finally {
    restore();
  }
}

class ShowcaseSeed {
  readonly result: ShowcaseResult = { created: [], reused: [], skipped: [], ids: {} };
  private readonly pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  private readonly actors = new Map<string, Actor>();
  private readonly roles: Partial<Record<ShowcaseRole, string>> = {};
  private portal: { token: string } | null = null;
  private slug = "";
  private timezone = "UTC";
  private currency = "";

  constructor(private readonly input: ShowcaseInput) {}

  private get w() { return this.input.workspaceId; }
  private get<T>(type: Type<T>): T { return this.input.app.get(type, { strict: false }); }
  private get db() { return this.get(DatabaseService); }

  private log(line: string) { (this.input.log ?? ((text: string) => process.stdout.write(`${text}\n`)))(line); }
  private made(label: string) { this.result.created.push(label); this.input.report?.record?.("showcase", "created", label); this.log(`  created  ${label}`); }
  private kept(label: string) { this.result.reused.push(label); this.input.report?.record?.("showcase", "reused", label); }
  private skip(stage: string, reason: string) {
    this.result.skipped.push({ stage, reason });
    this.input.report?.notes?.push(`showcase · ${stage}: ${reason}`);
    this.log(`  skipped  ${stage}: ${reason}`);
  }

  /** Runs a body through the API's validation pipe for its DTO, exactly as the controller would. */
  private validated<T>(dto: Type<T>, body: unknown): Promise<T> {
    return this.pipe.transform(body, { type: "body", metatype: dto }) as Promise<T>;
  }

  /** A stable id for a record of this showcase in this workspace (UUID-shaped, deterministic). */
  private id(key: string) {
    const hash = createHash("sha1").update(`wodana-showcase:${this.w}:${key}`).digest();
    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  // ---------------------------------------------------------------- people

  async prepare() {
    const workspace = (await this.db.tenantTransaction(this.w, this.input.actorUserId, (client) => client.query<{ slug: string; timezone: string; currency: string }>(
      `SELECT slug, coalesce(nullif(default_timezone, ''), 'UTC') AS timezone, default_currency AS currency FROM workspaces WHERE id = $1`, [this.w]))).rows[0];
    if (!workspace) throw new Error("Workspace not found.");
    this.timezone = workspace.timezone;
    this.currency = workspace.currency;
    // The client portal's own address (Settings → Client portal), which the client's side of the seed uses.
    const portal = (await this.db.tenantTransaction(this.w, this.input.actorUserId, (client) => client.query<{ slug: string | null }>(
      `SELECT slug FROM client_portal_settings WHERE workspace_id = $1`, [this.w]))).rows[0];
    this.slug = portal?.slug || workspace.slug;
    for (const [team, entry] of Object.entries(this.input.roleActors ?? {})) {
      const role = TEAM_ROLES[team];
      if (role && entry?.userId && entry.active !== false && !this.roles[role]) this.roles[role] = entry.userId;
    }
    for (const [role, userId] of Object.entries(this.input.actors ?? {})) if (userId) this.roles[role as ShowcaseRole] = userId;
    if (this.roles.factory && !this.roles.site) this.roles.site = this.roles.factory;
    await this.actor(this.input.actorUserId);
  }

  /** The person with this user id, as the API sees them after signing in, plus their membership here. */
  private async actor(userId: string): Promise<Actor> {
    const known = this.actors.get(userId);
    if (known) return known;
    const user = (await this.db.query<{ id: string; email: string; displayName: string; provider: string; subject: string }>(
      `SELECT person.id, person.primary_email AS email, person.display_name AS "displayName", identity.provider, identity.provider_subject AS subject
         FROM users person JOIN user_identities identity ON identity.user_id = person.id
        WHERE person.id = $1 ORDER BY (identity.provider = 'local') DESC, identity.created_at LIMIT 1`, [userId])).rows[0];
    if (!user) throw new Error(`No signed-in identity for user ${userId}.`);
    const membership = (await this.db.tenantTransaction(this.w, userId, (client) => client.query<{ id: string }>(
      `SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [this.w, userId]))).rows[0];
    const actor: Actor = { provider: user.provider, subject: user.subject, email: user.email, displayName: user.displayName, userId: user.id, membershipId: membership?.id ?? null };
    this.actors.set(userId, actor);
    return actor;
  }

  /** The person for a role, or the run's actor when nobody is named (or the named person isn't a member). */
  private async as(role: ShowcaseRole): Promise<Actor> {
    const userId = this.roles[role];
    if (userId) {
      const actor = await this.actor(userId).catch(() => null);
      if (actor?.membershipId) return actor;
    }
    return this.actor(this.input.actorUserId);
  }

  /** Someone other than `who`, for the rules that need a second pair of eyes; `who` again when nobody else is there. */
  private async other(who: Actor, prefer: ShowcaseRole[] = ["owner", "manager", "finance", "projectManager", "sales", "estimator"]): Promise<Actor> {
    for (const role of prefer) {
      const candidate = await this.as(role);
      if (candidate.userId !== who.userId) return candidate;
    }
    const fallback = await this.actor(this.input.actorUserId);
    return fallback;
  }

  /** Tries the preferred person first; someone without the permission hands over to the run's actor. */
  private async tryAs<T>(preferred: Actor, work: (actor: RequestActor) => Promise<T>): Promise<T> {
    try { return await work(preferred); } catch (error) {
      const fallback = await this.actor(this.input.actorUserId);
      if (fallback.userId === preferred.userId || !(error instanceof HttpException) || error.getStatus() !== 403) throw error;
      return work(fallback);
    }
  }

  suppressEmail() {
    if (this.input.deliverEmail) return () => undefined;
    const mailer = this.get(TransactionalEmailService) as unknown as { send: (message: unknown) => Promise<unknown> };
    const original = mailer.send;
    mailer.send = async (message: unknown) => {
      const to = (message as { to?: string }).to ?? "?";
      const subject = (message as { subject?: string }).subject ?? "";
      this.input.report?.notices?.push(`email to ${to}: ${subject} (suppressed)`);
      return { status: "suppressed", suppressedReason: "seed", provider: null, messageId: null };
    };
    return () => { mailer.send = original; };
  }

  // ---------------------------------------------------------------- steps

  /** One idempotent step: `find` reads what exists; `create` writes it. */
  private async step<T>(label: string, find: () => Promise<T | null | undefined>, create: () => Promise<T>): Promise<T> {
    const found = await find();
    if (found !== null && found !== undefined) { this.kept(label); return found; }
    try {
      const created = await create();
      this.made(label);
      return created;
    } catch (error) {
      throw new Error(`${label}: ${describe(error)}`, { cause: error });
    }
  }

  /** A change that moves an existing record on; `done` says when there is nothing left to do. */
  private async advance(label: string, done: boolean, change: () => Promise<unknown>) {
    if (done) { this.kept(label); return false; }
    try { await change(); } catch (error) { throw new Error(`${label}: ${describe(error)}`, { cause: error }); }
    this.made(label);
    return true;
  }

  private async stage(name: string, work: () => Promise<void>) {
    this.log(`${name}`);
    try { await work(); } catch (error) {
      if (error instanceof Skip) { this.skip(name, error.reason); return; }
      this.skip(name, describe(error));
    }
  }

  async run() {
    const ids = this.result.ids;
    await this.stage("enquiry", async () => { Object.assign(ids, await this.enquiry()); });
    if (!ids.leadId) return this.result;
    await this.stage("opportunity", async () => { ids.opportunityId = await this.opportunity(ids.leadId!, ids.partyId!); });
    if (!ids.opportunityId) return this.result;
    await this.stage("planning", async () => { ids.caseId = await this.planningCase(ids.opportunityId!); });
    if (!ids.caseId) return this.result;
    const caseId = ids.caseId;
    await this.stage("client contact", async () => { ids.grantId = await this.portalContact(caseId); });
    const rooms = new Map<string, string>();
    await this.stage("brief", () => this.brief(caseId, rooms));
    await this.stage("site visit", () => this.siteVisit(caseId, rooms));
    await this.stage("design", () => this.design(caseId, rooms));
    await this.stage("quotation", async () => { ids.quoteId = await this.quotation(caseId, rooms); });
    if (!ids.quoteId) return this.result;
    const quoteId = ids.quoteId;
    await this.stage("approvals and client acceptance", () => this.approvals(caseId, quoteId, ids.grantId ?? "", ids.opportunityId!));
    await this.stage("project", async () => { ids.projectId = await this.project(caseId, quoteId); });
    if (!ids.projectId) return this.result;
    const projectId = ids.projectId;
    await this.stage("client portal access", () => this.invite(projectId));
    await this.stage("production payment", () => this.productionPayment(caseId, quoteId));
    await this.stage("plan", () => this.plan(projectId));
    await this.stage("material list", () => this.materials(projectId, caseId));
    await this.stage("purchasing", async () => { ids.orderId = await this.purchasing(projectId); });
    await this.stage("factory", async () => { ids.workOrderId = await this.factory(projectId); });
    await this.stage("site", () => this.site(projectId, rooms));
    await this.stage("stages", () => this.stages(projectId));
    await this.stage("handover and warranty", () => this.handover(projectId, caseId, rooms));
    return this.result;
  }

  // ---------------------------------------------------------------- CRM

  private async enquiry() {
    const client = SHOWCASE.client;
    const actor = await this.actor(this.input.actorUserId);
    const sales = await this.as("sales");
    const intake = this.get(CrmIntakeService), leads = this.get(CrmLeadsService);
    const find = async () => {
      const list = (await leads.list(actor, this.w, { search: client.displayName, limit: 100 } as never)) as unknown as { data: Array<{ id: string; partyId: string; partyName: string; title?: string }> };
      const parties = (await this.db.tenantTransaction(this.w, actor.userId, (db) => db.query<{ id: string }>(
        `SELECT DISTINCT party_id AS id FROM crm_contact_points WHERE workspace_id = $1 AND type = 'email' AND lower(raw_value) = $2`, [this.w, client.email.toLowerCase()]))).rows.map((row) => row.id);
      return list.data.find((lead) => lead.partyName === client.displayName && parties.includes(lead.partyId)) ?? null;
    };
    const lead = await this.step(`enquiry ${SHOWCASE.reference}`, find, async () => {
      const options = (await intake.options(actor, this.w)) as { sources: Array<{ id: string }>; channels: Record<string, Array<{ id: string }>>; enquiryTypes: Array<{ id: string }>; emirates: Array<{ id: string }>; customerTypes: Array<{ id: string }>; budgetRanges: Array<{ id: string }> };
      const source = options.sources.find((row) => /social|instagram/i.test(row.id)) ?? options.sources[0];
      if (!source) throw new Skip("the workspace has no enquiry sources configured");
      const channel = (options.channels[source.id] ?? []).find((row) => /instagram/i.test(row.id)) ?? options.channels[source.id]?.[0];
      const enquiryType = options.enquiryTypes.find((row) => /interior|fit.?out|full/i.test(row.id)) ?? options.enquiryTypes.find((row) => row.id !== "not_sure") ?? options.enquiryTypes[0];
      const emirate = options.emirates.find((row) => row.id === "dubai") ?? options.emirates[0];
      const customerType = options.customerTypes.find((row) => /end_user|homeowner|individual/i.test(row.id)) ?? options.customerTypes[0];
      const budgetRange = options.budgetRanges.at(-1) ?? options.budgetRanges[0];
      const body = await this.validated(CreateIntakeEventDto, {
        source: source.id, channel: channel?.id ?? source.id, intakeMethod: "manual", externalEventId: SHOWCASE.reference,
        party: { displayName: client.displayName, email: client.email, mobile: client.mobile },
        title: SHOWCASE.title, summary: SHOWCASE.summary, serviceType: enquiryType?.id ?? "not_sure",
        details: { emirate: emirate?.id ?? "dubai", area: SHOWCASE.area, ...(customerType ? { customerType: customerType.id } : {}), ...(budgetRange ? { budgetRange: budgetRange.id } : {}) },
        assignment: sales.membershipId ? { mode: "manual", ownerMembershipId: sales.membershipId } : { mode: "unassigned" },
        originalPayload: { seed: "showcase", reference: SHOWCASE.reference, demonstration: true },
        receivedAt: daysAgo(42).toISOString(),
      });
      await intake.createManual(actor, this.w, `seed:showcase:enquiry:${this.w}`, randomUUID(), body);
      const created = await find();
      if (!created) throw new Error("the enquiry was recorded but is not listed");
      return created;
    });
    return { leadId: lead.id, partyId: lead.partyId };
  }

  private async opportunity(leadId: string, partyId: string) {
    const sales = await this.as("sales");
    const opportunities = this.get(CrmOpportunitiesService), leads = this.get(CrmLeadsService);
    const find = async () => {
      const list = (await opportunities.list(sales, this.w, { partyId, limit: 50 } as never)) as unknown as { data: Array<{ id: string; title: string }> };
      return list.data.find((row) => row.title === SHOWCASE.title) ?? null;
    };
    const opportunity = await this.step("opportunity (lead qualified)", find, async () => {
      const pipelines = (await opportunities.listPipelines(sales, this.w)) as Array<{ id: string; isDefault: boolean; stages: Array<{ id: string; code: string; position: number }> }>;
      const pipeline = pipelines.find((row) => row.isDefault) ?? pipelines[0];
      if (!pipeline) throw new Skip("no sales pipeline is configured");
      const first = [...pipeline.stages].sort((a, b) => a.position - b.position)[0];
      const lead = (await leads.get(sales, this.w, leadId)) as unknown as { version: number };
      const body = await this.validated(QualifyLeadDto, {
        leadVersion: lead.version, partyId, leadId, pipelineId: pipeline.id, stageId: first.id, ...(sales.membershipId ? { ownerMembershipId: sales.membershipId } : {}),
        title: SHOWCASE.title, description: SHOWCASE.summary, amount: 118_000, currencyCode: this.currency,
        expectedCloseAt: daysAgo(-14).toISOString(), nextActionAt: daysAgo(-2).toISOString(),
      });
      return this.tryAs(sales, (actor) => opportunities.qualifyLead(actor, this.w, leadId, body) as Promise<{ id: string; title: string }>);
    });
    return opportunity.id;
  }

  private async planningCase(opportunityId: string) {
    const sales = await this.as("sales");
    const cases = this.get(PreProjectsService);
    const find = async () => {
      const list = (await cases.list(sales, this.w, { search: "Villa 12", status: "all" } as never)) as { items: Array<{ id: string; opportunityId: string; status: string }> };
      return list.items.find((row) => row.opportunityId === opportunityId && row.status !== "qualified") ?? null;
    };
    const found = await this.step("planning record (converted)", find, async () => {
      await this.tryAs(sales, (actor) => cases.start(actor, this.w, opportunityId));
      const created = await find();
      if (!created) throw new Error("the planning record was started but is not listed");
      return created;
    });
    return found.id;
  }

  /** The client's portal identity on this case, an approver, with the demonstration sign-in code. */
  private async portalContact(caseId: string) {
    const client = SHOWCASE.client;
    const actor = await this.actor(this.input.actorUserId);
    const admin = this.get(ClientPortalAdminService);
    const contacts = async () => ((await admin.contacts(actor, this.w, caseId)) as { contacts: Array<{ id: string; phone: string; version: number; demoCode: boolean }> }).contacts;
    const grant = await this.step("client portal contact", async () => (await contacts()).find((row) => row.phone === client.mobile) ?? null, async () => {
      await admin.saveContact(actor, this.w, caseId, { name: client.displayName, phone: client.mobile, email: client.email, role: "approver", active: true });
      return (await contacts()).find((row) => row.phone === client.mobile)!;
    });
    const withCode = typeof (admin as unknown as { demoCode?: unknown }).demoCode === "function";
    if (!withCode) this.skip("demo sign-in code", "ClientPortalAdminService.demoCode is not available yet; set the code 123456 on the contact once it is");
    else await this.advance("demo sign-in code", grant.demoCode, () => admin.demoCode(actor, this.w, caseId, grant.id, { commandId: this.id(`demo-code:${grant.id}:${grant.version}`), version: grant.version, code: client.demoCode }));
    return grant.id;
  }

  // ---------------------------------------------------------------- Planning

  private async brief(caseId: string, rooms: Map<string, string>) {
    const designer = await this.as("designer");
    const brief = this.get(BriefService);
    for (const name of SHOWCASE.rooms) {
      const id = this.id(`room:${name}`);
      const room = await this.step(`room ${name}`, async () => ((await brief.get(designer, this.w, caseId)) as { rooms: Array<{ id: string; name: string }> }).rooms.find((row) => row.id === id) ?? null,
        async () => brief.saveRoom(designer, this.w, caseId, await this.validated(SaveRoomDto, { id, version: 0, name })) as Promise<{ id: string }>);
      rooms.set(name, room.id);
    }
    const entries = async () => ((await brief.get(designer, this.w, caseId)) as { entries: Array<{ id: string }> }).entries;
    let current = await entries();
    const catalog = await this.catalogByName();
    const requirements = [
      { key: "living-sofa", room: "Living room", title: "Feature sofa for the family lounge", note: "Deep, low seating; must seat five.", category: "Furniture", priority: "must_have", quantity: 1, unit: "nos" },
      { key: "living-media", room: "Living room", title: "Fitted media wall with hidden storage", note: "Wall-to-wall joinery in oak veneer with concealed cable routing; made in the factory.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: "TV unit" },
      { key: "living-floor", room: "Living room", title: "Engineered oak flooring", note: "Wide plank, matt finish.", category: "Flooring", priority: "preferred", quantity: 45, unit: "sqm", catalog: "Engineered oak flooring 14mm" },
      { key: "dining-light", room: "Dining room", title: "Pendant light over the dining table", note: "Warm, dimmable, centred on the table.", category: "Lighting", priority: "preferred", quantity: 1, unit: "nos", catalog: "Pendant light" },
      { key: "dining-ceiling", room: "Dining room", title: "False ceiling with cove lighting", note: "Gypsum cove around the dining area.", category: "Ceiling", priority: "optional", quantity: 30, unit: "sqm" },
      { key: "bed-wardrobe", room: "Master bedroom", title: "Hinged wardrobe, wall to wall", note: "Full-height, soft-close hinges, matt laminate.", category: "Joinery", priority: "must_have", quantity: 1, unit: "nos", catalog: "Wardrobe · hinged" },
    ];
    for (const item of requirements) {
      const id = this.id(`requirement:${item.key}`);
      const record = item.catalog ? catalog.get(item.catalog.toLowerCase()) : undefined;
      await this.step(`requirement ${item.title}`, async () => current.find((row) => row.id === id) ?? null, async () => {
        const body = await this.validated(SaveBriefEntryDto, {
          id, version: 0, kind: "requirement", title: item.title, roomId: rooms.get(item.room) ?? null, note: item.note, category: item.category, priority: item.priority,
          scopeStatus: "included", reviewStatus: "reviewed", quantity: item.quantity, unit: item.unit, referenceUrl: "", avoid: "", source: "client", assetIds: [],
          ...(record?.kind === "work" ? { catalogLinks: [{ role: "work", recordId: record.id }] } : {}),
        });
        const saved = await brief.saveEntry(designer, this.w, caseId, body) as { id: string };
        current = await entries();
        return saved;
      });
    }
    // Inspiration on the moodboard: Core Collection pictures when the workspace has them, otherwise the ideas alone.
    const inspiration = [
      { key: "mood-console", title: "Marble console in the entrance", catalog: "Freja Marble Console" },
      { key: "mood-sofa", title: "Warm boucle seating", catalog: "Annie Sofa - Length 2000mm" },
      { key: "mood-light", title: "Brass pendant over the table", catalog: "Brass pendant light" },
      { key: "mood-oak", title: "Oak and off-white palette", catalog: "Engineered oak flooring 14mm" },
    ];
    const pins: Array<{ entryId: string; x: number; y: number; width: number; z: number; sentiment: "love" | "avoid" }> = [];
    for (const [index, item] of inspiration.entries()) {
      const id = this.id(`inspiration:${item.key}`);
      const assetId = await this.picture(caseId, designer, `inspiration:${item.key}`, item.catalog);
      const entry = await this.step(`inspiration ${item.title}`, async () => current.find((row) => row.id === id) ?? null, async () => {
        const body = await this.validated(SaveBriefEntryDto, {
          id, version: 0, kind: "inspiration", title: item.title, roomId: null, note: item.catalog, category: "Inspiration", priority: "preferred",
          scopeStatus: "included", reviewStatus: "reviewed", unit: "nos", referenceUrl: "", avoid: "", source: "team", assetIds: assetId ? [assetId] : [],
        });
        const saved = await brief.saveEntry(designer, this.w, caseId, body) as { id: string };
        current = await entries();
        return saved;
      });
      pins.push({ entryId: entry.id, x: 40 + (index % 2) * 360, y: 40 + Math.floor(index / 2) * 300, width: 320, z: index, sentiment: "love" });
    }
    const layout = (await brief.get(designer, this.w, caseId)) as { entries: Array<{ id: string; board?: unknown | null }> };
    const pinned = new Set(layout.entries.filter((entry) => entry.board).map((entry) => entry.id));
    await this.advance("moodboard layout", pins.every((pin) => pinned.has(pin.entryId)), async () =>
      brief.saveMoodboardLayout(designer, this.w, caseId, await Promise.all(pins.map((pin) => this.validated(MoodboardPinDto, pin)))));
    // The site plan the quotation needs: a plan file on the record (the seed's own drawing tile).
    const planId = this.id("asset:site-plan"), planEntry = this.id("file:site-plan");
    await this.step("site plan file", async () => current.find((row) => row.id === planEntry) ?? null, async () => {
      await this.upload(caseId, designer, planId, tile("site-plan"));
      const body = await this.validated(SaveBriefEntryDto, {
        id: planEntry, version: 0, kind: "file", title: "Site plan · Villa 12 ground floor", roomId: null, note: "Measured plan from the site visit (demonstration).", category: "site plan",
        priority: "must_have", scopeStatus: "included", reviewStatus: "reviewed", unit: "file", referenceUrl: "", avoid: "", source: "team", assetIds: [planId],
      });
      const saved = await brief.saveEntry(designer, this.w, caseId, body) as { id: string };
      current = await entries();
      return saved;
    });
  }

  /** The workspace catalog by lower-cased name: Core Collection or starter items, whatever is there. */
  private async catalogByName() {
    const byName = new Map<string, { id: string; name: string; kind: string; primaryAsset?: { id: string } | null }>();
    try {
      const { CatalogService } = await import("../catalog/catalog.service");
      const actor = await this.actor(this.input.actorUserId);
      const list = (await this.get(CatalogService).list(actor, this.w)) as { items: Array<{ id: string; name: string; kind: string; primaryAsset?: { id: string } | null }> };
      for (const item of list.items) byName.set(item.name.trim().toLowerCase(), item);
    } catch (error) {
      this.log(`  note     catalog not readable: ${describe(error)}`);
    }
    return byName;
  }

  /** A Core Collection picture copied onto the case when the catalog record has one; otherwise nothing. */
  private async picture(caseId: string, actor: Actor, key: string, recordName: string): Promise<string | null> {
    const record = (await this.catalogByName()).get(recordName.toLowerCase());
    if (!record?.primaryAsset) return null;
    try {
      const { CatalogAssetsService } = await import("../catalog/catalog-assets.service");
      const assets = this.get(CatalogAssetsService) as unknown as { read: (actor: RequestActor, workspaceId: string, recordId: string, assetId: string, preview: boolean) => Promise<{ body?: Buffer; buffer?: Buffer; mimeType?: string; contentType?: string; name?: string }> };
      const file = await assets.read(actor, this.w, record.id, record.primaryAsset.id, false);
      const buffer = file.body ?? file.buffer;
      if (!buffer) return null;
      const id = this.id(`asset:${key}`);
      await this.upload(caseId, actor, id, { buffer, originalname: file.name ?? `${key}.png`, mimetype: file.mimeType ?? file.contentType ?? "image/png", size: buffer.length });
      return id;
    } catch {
      return null;
    }
  }

  /** A case asset by stable id: uploaded once, found afterwards. */
  private async upload(caseId: string, actor: Actor, id: string, file: Upload) {
    const brief = this.get(BriefService);
    try { await brief.asset(actor, this.w, caseId, id, false); return id; } catch { /* not there yet */ }
    await brief.upload(actor, this.w, caseId, id, file);
    return id;
  }

  private async siteVisit(caseId: string, rooms: Map<string, string>) {
    const designer = await this.as("designer");
    const site = this.get(PlanningSiteService), specifications = this.get(ItemSpecificationService), brief = this.get(BriefService);
    const visitId = this.id("site-visit");
    const records = async () => (await site.list(designer, this.w, caseId)) as { visits?: Array<{ id: string; version: number }>; measurements?: Array<{ id: string; version: number; status?: string }>; items?: Array<{ id: string; version: number; status?: string }> };
    const found = (state: Awaited<ReturnType<typeof records>>, id: string): { id: string; version: number; status?: string } | null =>
      [...(state.visits ?? []), ...(state.measurements ?? []), ...(state.items ?? [])].find((row) => row.id === id) ?? null;
    await this.step("site visit", async () => found(await records(), visitId), async () => {
      const body = await this.validated(SaveSiteVisitDto, {
        id: visitId, version: 0, title: "Site visit · measurements and photos", note: "Measured the living room, dining room and master bedroom. Media wall opening 4.5 m; power at both ends.",
        assetIds: [], scheduledAt: daysAgo(35).toISOString(), timezone: this.timezone, durationMinutes: 120, assigneeId: designer.userId,
        location: "Villa 12 (demonstration address)", access: "Security gate; call the client on arrival.", status: "completed",
        outcome: "Measured the living room, dining room and master bedroom. Media wall opening 4.5 m; power at both ends.",
      });
      return site.saveVisit(designer, this.w, caseId, body);
    });
    // The media wall's specification, then the opening measured against it and verified.
    const entryId = this.id("requirement:living-media");
    const entries = ((await brief.get(designer, this.w, caseId)) as { entries: Array<{ id: string }> }).entries;
    if (!entries.some((row) => row.id === entryId)) throw new Skip("the media wall requirement is not on the brief");
    const history = (await specifications.history(designer, this.w, caseId, entryId)) as { items: Array<{ version: number }> };
    await this.advance("media wall specification", history.items.length > 0, async () => specifications.save(designer, this.w, caseId, entryId, await this.validated(SaveItemSpecificationDto, {
      version: 0, refinedRequirement: "Wall-to-wall fitted media wall in oak veneer with concealed cable routing.", construction: "Factory-made carcasses, site-fitted.",
      inclusions: "Carcass, doors, cable management, installation.", exclusions: "Television and audio equipment.", assumptions: "Verified site opening.",
      materials: [], dimensions: [], designRefs: [],
    })));
    const specificationVersion = Math.max(((await specifications.history(designer, this.w, caseId, entryId)) as { items: Array<{ version: number }> }).items[0]?.version ?? 1, 1);
    const measurementId = this.id("measurement:media-wall");
    // Verification needs the measured values and a supporting photo: the seed's site photo of the opening.
    const photoId = await this.upload(caseId, designer, this.id("asset:measurement-photo"), tile("media-wall-opening"));
    const measurementBody = (version: number) => this.validated(SaveSiteMeasurementDto, {
      id: measurementId, version, title: "Media wall opening", note: "Measured on the site visit with a laser measure.", assetIds: [photoId], roomId: rooms.get("Living room") ?? null, entryId, visitId,
      specificationVersion,
      dimensions: [
        { id: this.id("dimension:width"), name: "Width", unit: "mm", basis: "site_opening", measured: 4500, source: "team", evidence: "Laser measure" },
        { id: this.id("dimension:height"), name: "Height", unit: "mm", basis: "site_opening", measured: 2800, source: "team", evidence: "Laser measure" },
      ],
    });
    const measurement = await this.step("media wall measurement", async () => found(await records(), measurementId), async () =>
      site.saveMeasurement(designer, this.w, caseId, await measurementBody(0)) as Promise<{ id: string; version: number; status?: string }>);
    await this.advance("measurement verified", measurement.status === "verified", async () => {
      // An unverified measurement is saved again with its photo (the same values), then verified.
      const saved = await site.saveMeasurement(designer, this.w, caseId, await measurementBody(measurement.version)) as { version: number };
      return this.tryAs(designer, (actor) => site.review(actor, this.w, caseId, measurementId, { version: saved.version, status: "verified", note: "Checked against the drawing." } as ReviewSiteMeasurementDto));
    });
  }

  private async design(caseId: string, rooms: Map<string, string>) {
    const designer = await this.as("designer");
    const designs = this.get(DesignService);
    const designId = this.id("design:concept"), versionId = this.id("design:concept:v1"), assetId = this.id("asset:design-concept");
    const list = async () => ((await designs.list(designer, this.w, caseId)) as { items: Array<{ id: string; version: number; versions: Array<{ id: string; status: string }> }> }).items;
    let design = await this.step("concept board", async () => (await list()).find((row) => row.id === designId) ?? null, async () => {
      await this.upload(caseId, designer, assetId, tile("concept-board"));
      await designs.uploadFiles(designer, this.w, caseId, await this.validated(UploadDesignFilesDto, {
        roomId: rooms.get("Living room") ?? null, note: "Concept board: living room palette and the media wall.",
        files: [{ id: designId, versionId, assetId, title: "Living room concept board", documentType: "Concept / mood board", note: "Revision 1", includedClientRounds: 1 }],
      }));
      return (await list()).find((row) => row.id === designId)!;
    });
    const status = () => design.versions.find((version) => version.id === versionId)?.status ?? "";
    const refresh = async () => { design = (await list()).find((row) => row.id === designId)!; };
    const activity = async (actor: Actor, key: string, action: string, extra: Record<string, unknown> = {}) => {
      await refresh();
      return designs.activity(actor, this.w, caseId, designId, await this.validated(DesignActivityDto, { id: this.id(`design-activity:${key}`), version: design.version, versionId, action, note: "", decisionBy: "", ...extra }));
    };
    const reviewer = await this.other(designer, ["manager", "owner", "projectManager"]);
    if (["draft", "uploaded"].includes(status())) {
      await this.advance("design · internal review requested", false, () => activity(designer, "internal_review", "internal_review", { reviewerId: reviewer.userId, contextConfirmed: true }));
      await refresh();
    }
    if (status() === "internal_review") { await this.advance("design · internally approved", false, () => activity(reviewer, "internal_approved", "internal_approved", { note: "Layout and selections checked." })); await refresh(); }
    if (status() === "internal_approved") { await this.advance("design · shared with the client", false, () => activity(designer, "client_review", "client_review")); await refresh(); }
    if (status() === "client_review") {
      await this.advance("design · accepted by the client in the portal", false, async () => {
        const view = await this.portalView();
        const project = view.projects.find((row) => row.id === caseId);
        const shared = project?.decisions?.designs?.find((row: Any) => row.id === versionId);
        if (!shared?.canDecide) throw new Skip("the design is not open for the client's decision in the portal");
        await this.portalDecision("design_decision", `design:${caseId}:${versionId}:accept`, { caseId, versionId, decision: "accept", note: "Love it. Go ahead." });
      });
    } else if (status() === "approved") this.kept("design · accepted by the client");
    else if (status()) this.skip("design", `the concept board is ${status()}`);
  }

  // ---------------------------------------------------------------- Quotation

  private async quotation(caseId: string, rooms: Map<string, string>) {
    const salesAdmin = await this.as("salesAdmin");
    const commercial = this.get(CommercialService), builder = this.get(QuotationBuilderService);
    const state = async () => (await commercial.state(salesAdmin, this.w, caseId)) as unknown as { data: Any };
    let current = await state();
    await this.advance("service route (main quotation, materials, procurement, factory, site, installation)", Boolean(current.data.palmFlow), async () => {
      await commercial.command(salesAdmin, this.w, caseId, { action: "set_palm_flow", revision: current.data.revision,
        scope: { design: false, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true } });
      current = await state();
    });
    const quote = await this.step("quotation", async () => (current.data.quotes ?? []).find((row: Any) => row.kind === "quotation") ?? null, async () => {
      const created = (await commercial.command(salesAdmin, this.w, caseId, { action: "create", revision: current.data.revision })) as { data: Any };
      current = await state();
      return created.data.quotes.at(-1);
    });
    const quoteId = quote.id as string;
    if (quote.status !== "draft") { this.kept("quotation lines and terms"); return quoteId; }
    const built = (await builder.builder(salesAdmin, this.w, caseId, quoteId)) as unknown as { lines: Array<{ id: string; version: number }>; quote: { paymentTerms: Array<{ title: string; percent: number }> } };
    const existing = new Set(built.lines.map((line) => line.id));
    const search = async (query: string) => {
      const hits = (await builder.search(salesAdmin, this.w, caseId, quoteId, query, 10)) as { items: Array<{ id: string; name: string; unitCode: string; description: string | null; price?: string | null; rate?: string | null; entryRate?: string | null; cost?: string | null }> };
      return hits.items.find((item) => item.name.trim().toLowerCase() === query.toLowerCase()) ?? hits.items[0] ?? null;
    };
    // Realistic lines from the workspace's own catalog; a line whose item isn't in the catalog is entered by hand.
    const ops: unknown[] = [];
    let fromCatalog = 0;
    for (const line of QUOTE_LINES) {
      const id = this.id(`line:${line.key}`);
      if (existing.has(id)) continue;
      const hit = await search(line.catalog).catch(() => null);
      const fields: Any = { id, quantity: line.quantity, unit: hit?.unitCode || line.unit, rate: line.rate, unitCost: line.unitCost, areaId: rooms.get(line.room) ?? null,
        title: line.title ?? hit?.name ?? line.catalog, description: hit?.description ?? "" };
      if (hit) { fromCatalog += 1; ops.push({ op: "catalog", itemId: hit.id, line: fields }); } else ops.push({ op: "upsert", line: fields });
    }
    if (ops.length) {
      await this.advance(`${ops.length} quotation lines (${fromCatalog} from the catalog)`, false, async () => {
        try { await builder.apply(salesAdmin, this.w, caseId, quoteId, { ops }); } catch (error) {
          // Without cost permission the sales admin can't enter the cost side: the run's actor does.
          if (!(error instanceof HttpException) || error.getStatus() !== 403) throw error;
          await builder.apply(await this.actor(this.input.actorUserId), this.w, caseId, quoteId, { ops });
        }
      });
      // A catalog line whose price book has no price keeps the seed's rate; nothing is left unpriced.
    } else this.kept("quotation lines");
    await this.price(caseId, quoteId);
    const terms = [
      { title: "Advance on signing", percent: 50, trigger: "Signed agreement", requiredForRelease: true, requiredForProduction: false },
      { title: "Before production", percent: 40, trigger: "Before factory production starts", requiredForRelease: false, requiredForProduction: true },
      { title: "On handover", percent: 10, trigger: "At client handover", requiredForRelease: false, requiredForProduction: false },
    ];
    const current2 = ((await builder.builder(salesAdmin, this.w, caseId, quoteId)) as unknown as { quote: { paymentTerms: Array<{ title: string; percent: number }> } }).quote.paymentTerms;
    await this.advance("payment schedule 50 / 40 / 10", current2.length === terms.length && current2.every((term, index) => term.title === terms[index].title && Number(term.percent) === terms[index].percent),
      () => builder.setPaymentTerms(salesAdmin, this.w, caseId, quoteId, { terms: terms.map((term) => ({ id: this.id(`term:${term.title}`), ...term })) }));
    return quoteId;
  }

  /**
   * The seed's rate and cost on every line: a catalog build-up without costs, or a price book without a price,
   * would otherwise leave the QS nothing to review. Only a draft can be priced.
   */
  private async price(caseId: string, quoteId: string) {
    const builder = this.get(QuotationBuilderService);
    const actor = await this.actor(this.input.actorUserId);
    const priced = (await builder.builder(actor, this.w, caseId, quoteId)) as unknown as { quote: { status: string }; lines: Array<{ id: string; version: number; rate: string; unitCost: string | null; pricingMode?: string; catalogPrice?: { status: string } | null }> };
    const fix = QUOTE_LINES.map((line) => ({ line, row: priced.lines.find((row) => row.id === this.id(`line:${line.key}`)) }))
      .filter(({ line, row }) => row && (row.pricingMode === "build_up" || Number(row.rate) !== Number(line.rate) || Number(row.unitCost ?? 0) !== Number(line.unitCost) || (row.catalogPrice && row.catalogPrice.status !== "resolved")))
      .map(({ line, row }) => ({ op: "upsert", line: { id: row!.id, version: row!.version, pricingMode: "rate", rate: line.rate, unitCost: line.unitCost } }));
    if (priced.quote.status !== "draft") return fix.length;
    await this.advance(`${fix.length} lines priced by the seed`, !fix.length, () => builder.apply(actor, this.w, caseId, quoteId, { ops: fix }));
    return 0;
  }

  private async approvals(caseId: string, quoteId: string, grantId: string, opportunityId: string) {
    const commercial = this.get(CommercialService);
    const salesAdmin = await this.as("salesAdmin");
    const read = async (actor: Actor) => (await commercial.state(actor, this.w, caseId)) as unknown as { data: Any };
    const command = async (actor: Actor, action: string, extra: Record<string, unknown> = {}) => {
      const current = await read(actor);
      return (await commercial.command(actor, this.w, caseId, { action, revision: current.data.revision, ...extra })) as { data: Any };
    };
    const quote = async () => ((await read(salesAdmin)).data.quotes as Any[]).find((row) => row.id === quoteId)!;
    let status = (await quote()).status as string;
    if (status === "internal_review" && (await this.price(caseId, quoteId)) > 0) {
      // Submitted before its costs were complete: the QS sends it back, the lines are priced, and it goes in again.
      const estimator = await this.as("estimator");
      await this.advance("quotation returned by the QS for costs", false, () => this.tryAs(estimator, (actor) => command({ ...estimator, ...actor } as Actor, "return", { quoteId, note: "Enter the cost side before the estimate review." })));
      await this.price(caseId, quoteId);
      status = "draft";
    }
    if (status === "draft") { await this.advance("quotation submitted for review", false, () => command(salesAdmin, "submit", { quoteId })); status = "internal_review"; }
    if (status === "internal_review") {
      const estimator = await this.as("estimator");
      await this.advance("QS estimate approved", false, () => this.tryAs(estimator, (actor) => command({ ...estimator, ...actor } as Actor, "qs_approve", { quoteId })));
      status = "internal_approved";
    }
    if (status === "internal_approved") {
      if (!grantId) throw new Skip("no client contact to issue the quotation to");
      await this.advance("quotation issued to the client", false, () => command(salesAdmin, "issue", { quoteId, approverId: grantId }));
      status = "issued";
    }
    if (status === "issued") {
      await this.advance("quotation accepted by the client in the portal", false, async () => {
        const view = await this.portalView();
        const project = view.projects.find((row) => row.id === caseId);
        const issued = project?.decisions?.quotes?.find((row: Any) => row.id === quoteId);
        if (!issued?.canDecide) throw new Skip("the quotation is not open for the client's decision in the portal");
        await this.portalDecision("quote_decision", `quote:${caseId}:${quoteId}:accept`, { caseId, quoteId, decision: "accept", selectedOptionLineIds: [], note: "", hash: issued.hash });
      });
      status = "accepted";
    } else if (status === "accepted") this.kept("quotation accepted by the client");
    if (status !== "accepted") throw new Skip(`the quotation is ${status}`);

    let data = (await read(salesAdmin)).data;
    // Evidence reads as it would on a real file: the product refuses to execute or verify anything marked as a demonstration.
    await this.advance("agreement recorded", Boolean(data.agreement) && isOperationalEvidence(data.agreement), () => command(salesAdmin, "agreement", { quoteId, reference: "AGR-VILLA12-2026",
      terms: "Accepted quotation terms; the firm's standard terms and conditions apply.", evidence: "Signed agreement AGR-VILLA12-2026 on file (showcase).", evidenceKind: "operational" }));
    data = (await read(salesAdmin)).data;
    const owner = await this.as("owner");
    await this.advance("agreement executed", data.agreement?.status === "executed", () => this.tryAs(owner, (actor) => command({ ...owner, ...actor } as Actor, "execute_agreement")));
    data = (await read(salesAdmin)).data;
    const release = (data.payments as Any[]).find((payment) => payment.sourceQuoteId === quoteId && payment.requiredForRelease);
    if (!release) throw new Skip("the accepted quotation has no release payment");
    await this.payment(caseId, release, "advance", "RCPT-VILLA12-ADV-1");

    // Sales marks the opportunity won once the client accepted and paid.
    const opportunities = this.get(CrmOpportunitiesService);
    const sales = await this.as("sales");
    const opportunity = (await opportunities.get(sales, this.w, opportunityId)) as unknown as { status: string; version: number; pipelineId: string };
    await this.advance("opportunity won", opportunity.status === "won", async () => {
      const pipelines = (await opportunities.listPipelines(sales, this.w)) as Array<{ id: string; stages: Array<{ id: string; code: string }> }>;
      const won = pipelines.find((row) => row.id === opportunity.pipelineId)?.stages.find((stage) => stage.code === "won");
      const body = await this.validated(TransitionOpportunityDto, { version: opportunity.version, ...(won ? { stageId: won.id } : {}), status: "won", reason: "Quotation accepted and advance received." });
      await this.tryAs(sales, (actor) => opportunities.transition(actor, this.w, opportunityId, body));
    });

    data = (await read(salesAdmin)).data;
    const commissionLines = [{ recipientName: sales.displayName, type: "sales", basis: "percent", value: 2 }];
    const review = data.ownerReview as Any | undefined;
    await this.advance("deal submitted for Finance and Owner review", Boolean(review && review.quoteId === quoteId), () => command(salesAdmin, "submit_owner_review", {
      checklist: { agreement: true, boq: true, documents: true, margin: true, materials: false, payment: true }, commissionLines,
      paymentProofUrl: "https://example.invalid/receipts/RCPT-VILLA12-ADV-1", note: "Showcase deal file.",
    }));
    data = (await read(salesAdmin)).data;
    const finance = await this.as("finance");
    await this.advance("deal confirmed by Finance", !["pending_finance", "submitted"].includes(data.ownerReview?.status), () =>
      this.tryAs(finance, (actor) => command({ ...finance, ...actor } as Actor, "review_deal_finance", { decision: "confirm", paymentVerified: true, commissionLines, note: "Receipt and commission checked." })));
    data = (await read(salesAdmin)).data;
    await this.advance("deal approved by the Owner", data.ownerReview?.status !== "pending_approval", () =>
      this.tryAs(owner, (actor) => command({ ...owner, ...actor } as Actor, "decide_owner_review", { decision: "approve", note: "Approved for delivery." })));
    data = (await read(salesAdmin)).data;
    if (data.ownerReview?.status !== "approved") throw new Skip(`the deal review is ${data.ownerReview?.status ?? "not started"}`);
  }

  /** A client payment: reported by Sales with its bank reference, verified by Finance. */
  private async payment(caseId: string, payment: Any, label: string, reference: string) {
    const commercial = this.get(CommercialService);
    const salesAdmin = await this.as("salesAdmin"), finance = await this.as("finance");
    const read = async (actor: Actor) => (await commercial.state(actor, this.w, caseId)) as unknown as { data: Any };
    if (payment.status === "verified") { this.kept(`${label} payment verified`); return; }
    const data = (await read(salesAdmin)).data;
    const receipts = (data.receipts ?? []) as Any[];
    await this.advance(`${label} payment reported`, receipts.some((receipt) => receipt.paymentId === payment.id), async () => {
      const current = await read(salesAdmin);
      await commercial.command(salesAdmin, this.w, caseId, { action: "report_payment_receipt", revision: current.data.revision, paymentId: payment.id, reference, evidence: "Bank transfer confirmation on file (showcase).", evidenceKind: "operational" });
    });
    await this.advance(`${label} payment verified by Finance`, false, () => this.tryAs(finance, async (actor) => {
      const current = await read({ ...finance, ...actor } as Actor);
      await commercial.command(actor, this.w, caseId, { action: "verify_payment", revision: current.data.revision, paymentId: payment.id });
    }));
  }

  // ---------------------------------------------------------------- Client portal (the client's side)

  private async portalView() {
    const portal = this.get(ClientPortalService);
    if (!this.portal) {
      const challenge = (await portal.challenge(this.slug, { phone: SHOWCASE.client.mobile }, "", "seed")) as { challengeId: string };
      const session = (await portal.login(this.slug, { challengeId: challenge.challengeId, code: SHOWCASE.client.demoCode })) as { token: string };
      this.portal = { token: session.token };
    }
    const view = (await portal.view(this.slug, this.portal.token)) as { projects: Any[] };
    return { token: this.portal.token, projects: view.projects };
  }

  private async portalDecision(action: string, purpose: string, body: Record<string, unknown>) {
    const portal = this.get(ClientPortalService);
    const { token } = await this.portalView();
    const challenge = (await portal.challenge(this.slug, { purpose }, token, "seed")) as { challengeId: string };
    const result = (await portal.command(this.slug, token, { commandId: randomUUID(), action, ...body, challengeId: challenge.challengeId, code: SHOWCASE.client.demoCode })) as { ok?: boolean };
    if (!result.ok) throw new Error(`the client's ${action} did not go through`);
  }

  // ---------------------------------------------------------------- Project

  private async project(caseId: string, quoteId: string) {
    const projects = this.get(ProjectCoreService);
    const pm = await this.as("projectManager");
    const actor = await this.actor(this.input.actorUserId);
    const started = await this.step("project started from the accepted quotation", async () => {
      const readiness = (await projects.startState(actor, this.w, caseId)) as { project?: { id: string } | null };
      return readiness.project?.id ? { projectId: readiness.project.id } : null;
    }, async () => {
      const readiness = (await projects.startState(actor, this.w, caseId)) as { canStart: boolean; checks: Array<{ key: string; ok: boolean }> };
      if (!readiness.canStart) throw new Skip(`start rules: ${readiness.checks.filter((check) => !check.ok).map((check) => check.key).join(", ") || "not startable"}`);
      const lead = pm.membershipId ?? actor.membershipId;
      return this.tryAs(pm, (who) => projects.start(who, this.w, caseId, { quoteId, leadMembershipId: lead, name: SHOWCASE.title, startDate: dayFrom(-21), promiseDate: dayFrom(75) }) as Promise<{ projectId: string }>);
    });
    const projectId = started.projectId;
    const roles: Array<[string, ShowcaseRole]> = [["quantity_surveyor", "estimator"], ["procurement", "buyer"], ["site_supervisor", "site"], ["factory_lead", "factory"], ["designer", "designer"]];
    for (const [role, key] of roles) {
      const person = await this.as(key);
      if (!person.membershipId || person.userId === actor.userId && key !== "designer") continue;
      const detail = (await projects.get(actor, this.w, projectId)) as unknown as { project: { version: number }; team: Array<{ role: string; member: { membershipId: string } | null }> };
      const holder = detail.team.find((row) => row.role === role)?.member?.membershipId ?? null;
      await this.advance(`team · ${role}`, holder === person.membershipId || (holder !== null && holder !== person.membershipId),
        () => projects.command(actor, this.w, projectId, { action: "set_member", role, membershipId: person.membershipId, version: detail.project.version }));
    }
    return projectId;
  }

  private async invite(projectId: string) {
    const admin = this.get(ClientPortalAdminService);
    const actor = await this.actor(this.input.actorUserId);
    const portal = (await admin.project(actor, this.w, projectId)) as { client: { status: string; version: number; blocked: string | null } };
    await this.advance("client invited to the portal (delivery suppressed)", ["invited", "active"].includes(portal.client.status), async () => {
      if (portal.client.blocked) throw new Skip(`the client can't be invited: ${portal.client.blocked}`);
      await admin.inviteClient(actor, this.w, projectId, { commandId: this.id(`invite:${projectId}:${portal.client.version}`), version: portal.client.version });
    });
  }

  private async productionPayment(caseId: string, quoteId: string) {
    const commercial = this.get(CommercialService);
    const salesAdmin = await this.as("salesAdmin");
    const data = ((await commercial.state(salesAdmin, this.w, caseId)) as unknown as { data: Any }).data;
    const production = (data.payments as Any[]).find((payment) => payment.sourceQuoteId === quoteId && payment.requiredForProduction);
    if (!production) throw new Skip("the quotation has no payment before production");
    await this.payment(caseId, production, "production", "RCPT-VILLA12-PROD-2");
  }

  private async plan(projectId: string) {
    const projects = this.get(ProjectCoreService), work = this.get(ProjectWorkService);
    const pm = await this.as("projectManager");
    const detail = async () => (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number; status: string }; stages: Array<{ id: string; key: string; status: string; checks: Array<{ key: string; kind: string; passed: boolean }> }> };
    const scope = async () => (await projects.scope(pm, this.w, projectId)) as unknown as { lines: Array<{ id: string; title: string; packageId: string | null }>; packages: Array<{ id: string; name: string; supply: string }> };
    let current = await scope();
    // The joinery is made in the factory; the rest is bought or done on site.
    const joinery = (line: { title: string }) => /media wall|wardrobe/i.test(line.title);
    let made = current.packages.find((pkg) => pkg.supply === "make" && current.lines.some((line) => joinery(line) && line.packageId === pkg.id)) ?? current.packages.find((pkg) => pkg.supply === "make");
    if (!made) {
      made = await this.step("package · Fitted joinery (made in the factory)", async () => current.packages.find((pkg) => pkg.name === "Fitted joinery") ?? null, async () => {
        const state = await detail();
        await projects.command(pm, this.w, projectId, { action: "save_package", name: "Fitted joinery", supply: "make", version: state.project.version });
        current = await scope();
        return current.packages.find((pkg) => pkg.name === "Fitted joinery")!;
      });
    } else this.kept(`package · ${made.name} (made in the factory)`);
    const moving = current.lines.filter((line) => joinery(line) && line.packageId !== made!.id).map((line) => line.id);
    await this.advance("joinery lines in the factory package", !moving.length, async () => {
      const state = await detail();
      await projects.command(pm, this.w, projectId, { action: "assign_lines", lineIds: moving, packageId: made!.id, version: state.project.version });
      current = await scope();
    });
    // The plan the team works from.
    const board = async () => ((await work.board(pm, this.w, projectId)) as { items: Array<{ id: string; title: string; status: string; version: number }> }).items;
    let items = await board();
    const designer = await this.as("designer"), site = await this.as("site"), buyer = await this.as("buyer");
    const tasks = [
      { key: "task:drawings", title: "Shop drawings for the media wall and wardrobe", assignee: designer, start: -18, due: -12, packageId: made.id },
      { key: "task:ordering", title: "Order veneer and hardware", assignee: buyer, start: -12, due: -8, packageId: made.id, needsMaterials: true },
      { key: "task:flooring", title: "Lay the engineered oak flooring", assignee: site, start: -6, due: -2, packageId: null },
      { key: "task:installation", title: "Install the media wall and wardrobe", assignee: site, start: 3, due: 6, packageId: made.id },
    ];
    for (const task of tasks) {
      const id = this.id(task.key);
      await this.step(`task · ${task.title}`, async () => items.find((row) => row.id === id) ?? null, async () => {
        await work.command(pm, this.w, projectId, { action: "create", id, type: "task", title: task.title, packageId: task.packageId, assigneeId: task.assignee.membershipId,
          startDate: dayFrom(task.start), dueDate: dayFrom(task.due), needsMaterials: task.needsMaterials === true });
        items = await board();
        return items.find((row) => row.id === id)!;
      });
    }
    for (const key of ["task:drawings", "task:ordering", "task:flooring"]) {
      const item = items.find((row) => row.id === this.id(key));
      if (!item) continue;
      await this.advance(`task done · ${item.title}`, item.status === "done", () => work.command(pm, this.w, projectId, { action: "update", itemId: item.id, version: item.version, status: "done" }));
    }
  }

  private async materials(projectId: string, caseId: string) {
    const projects = this.get(ProjectCoreService);
    const pm = await this.as("projectManager");
    const list = async () => (await projects.materials(pm, this.w, projectId)) as unknown as { state?: string; revision?: { status: string } | null; items: Array<{ id: string; name: string }> };
    const scope = (await projects.scope(pm, this.w, projectId)) as unknown as { lines: Array<{ id: string; title: string }> };
    const joinery = scope.lines.filter((line) => /media wall|wardrobe/i.test(line.title)).map((line) => line.id);
    let current = await list();
    const wanted = [
      { name: "Oak veneer, natural", code: "OAK-NAT", specification: "Crown cut, matt lacquer, 0.6 mm on 18 mm MDF", quantity: "14", unit: "sheet" },
      { name: "Soft-close hinges and drawer runners", code: "HW-SC", specification: "Concealed 110° hinges; full-extension runners", quantity: "24", unit: "nos" },
    ];
    for (const material of wanted) {
      await this.step(`material · ${material.name}`, async () => current.items.find((row) => row.name === material.name) ?? null, async () => {
        const detail = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number } };
        await projects.command(pm, this.w, projectId, { action: "save_material", name: material.name, code: material.code, specification: material.specification,
          quantity: material.quantity, unit: material.unit, boqLineIds: joinery, version: detail.project.version });
        current = await list();
        return current.items.find((row) => row.name === material.name)!;
      });
    }
    const state = () => current.state ?? current.revision?.status ?? "draft";
    if (["draft", "changed", "changes_requested"].includes(state())) {
      await this.advance("material list sent to the client", false, async () => {
        const detail = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number } };
        await projects.command(pm, this.w, projectId, { action: "send_materials", version: detail.project.version });
        current = await list();
      });
    }
    if (state() === "sent") {
      await this.advance("material list signed off by the client in the portal", false, async () => {
        const view = await this.portalView();
        const project = view.projects.find((row) => row.id === caseId);
        const materials = project?.decisions?.materials;
        if (!materials?.canDecide) throw new Skip("the material list is not open for the client's decision in the portal");
        await this.portalDecision("materials_decision", `materials:${caseId}:${materials.id}:submit`,
          { caseId, revisionId: materials.id, decisions: materials.items.map((item: Any) => ({ itemId: item.id, decision: "approved" })) });
      });
    } else if (state() === "signed_off") this.kept("material list signed off by the client");
    else throw new Skip(`the material list is ${state()}`);
  }

  // ---------------------------------------------------------------- Purchasing

  /**
   * Two orders: the joinery materials (veneer, hardware) to the first supplier in the register, then everything
   * else the project buys (flooring, lights) to the next one. Each is submitted, approved by someone else, sent
   * without an email, confirmed by the supplier, received at the factory and inspected by someone else.
   */
  private async purchasing(projectId: string) {
    const orders = this.get(OrdersService), suppliers = this.get(SuppliersService);
    const buyer = await this.as("buyer");
    const register = (await suppliers.list(buyer, this.w)) as unknown as { suppliers: Array<{ id: string; name: string; approval: string; status: string }> };
    const usable = register.suppliers.filter((row) => row.status !== "archived" && row.approval === "approved");
    if (!usable.length) throw new Skip("the supplier register has no approved supplier");
    type Need = { title: string; source: string; sourceId: string; projectId: string; remaining: string | null; blocked: string | null; unit: string };
    const needs = async () => ((await orders.needs(buyer, this.w)) as unknown as { needs: Need[] }).needs.filter((need) => need.projectId === projectId);
    const materials = (need: { source: string }) => need.source === "material";
    const first = await this.order(projectId, "joinery-materials", `joinery materials to ${usable[0].name}`, usable[0], materials, (need) => /veneer/i.test(need.title) ? "180" : "12",
      { supplierReference: "SO-VILLA12-1201", deliveryNote: "DN-VILLA12-4471", notes: "Veneer and hardware for the Villa 12 joinery (showcase)." }, needs);
    const second = usable[1] ?? usable[0];
    await this.order(projectId, "fit-out-supplies", `fit-out supplies to ${second.name}`, second, (need) => !materials(need), (need) => /floor/i.test(need.title) ? "190" : /pendant/i.test(need.title) ? "950" : "45",
      { supplierReference: "SO-VILLA12-1218", deliveryNote: "DN-VILLA12-4502", notes: "Flooring and lighting for Villa 12 (showcase)." }, needs);
    return first;
  }

  private async order(projectId: string, key: string, label: string, supplier: { id: string; name: string }, pick: (need: { title: string; source: string }) => boolean,
    price: (need: { title: string }) => string, detail: { supplierReference: string; deliveryNote: string; notes: string },
    needs: () => Promise<Array<{ title: string; source: string; sourceId: string; remaining: string | null; blocked: string | null }>>) {
    const orders = this.get(OrdersService), receiving = this.get(ReceivingService);
    const buyer = await this.as("buyer");
    const orderId = this.id(`purchase-order:${key}`);
    const get = async () => { try { return (await orders.get(buyer, this.w, orderId)) as unknown as { order: Any; lines: Any[]; receipts?: Any[] }; } catch { return null; } };
    let order = await this.step(`purchase order · ${label}`, get, async () => {
      const mine = (await needs()).filter((need) => pick(need) && Number(need.remaining ?? 0) > 0);
      if (!mine.length) throw new Skip(`nothing left to order for ${key}`);
      const blocked = mine.find((need) => need.blocked);
      if (blocked) throw new Skip(`purchasing is blocked: ${blocked.blocked}`);
      const lines = mine.map((need) => ({ source: need.source, ...(need.source === "material" ? { materialItemId: need.sourceId } : { boqLineId: need.sourceId }), quantity: need.remaining, unitPrice: price(need) }));
      await orders.create(buyer, this.w, { id: orderId, vendorId: supplier.id, expectedDate: dayFrom(-10), notes: detail.notes, lines });
      return (await get())!;
    });
    const command = async (actor: Actor, action: string, extra: Record<string, unknown> = {}) => {
      const fresh = (await get())!;
      return orders.command(actor, this.w, orderId, { action, version: fresh.order.version, ...extra });
    };
    let status = order.order.status as string;
    if (status === "draft") { await this.advance(`${key} · submitted`, false, () => command(buyer, "submit")); order = (await get())!; status = order.order.status; }
    if (status === "pending_approval") {
      const approver = await this.other(buyer, ["owner", "manager", "projectManager", "finance"]);
      await this.advance(`${key} · approved`, false, () => command(approver, "approve"));
      status = "approved";
    }
    if (status === "approved") { await this.advance(`${key} · sent to the supplier (no email)`, false, () => command(buyer, "send", { to: null })); status = "sent"; }
    if (status === "sent") { await this.advance(`${key} · supplier confirmation recorded`, false, () => command(buyer, "confirm", { promisedDate: dayFrom(-9), supplierReference: detail.supplierReference })); status = "confirmed"; }
    order = (await get())!;
    const receiptId = this.id(`receipt:${key}`);
    await this.step(`${key} · delivery received at the factory`, async () => (order.receipts ?? []).find((row: Any) => row.id === receiptId) ?? null, async () => {
      const form = (await receiving.receiving(buyer, this.w, orderId)) as unknown as { defaultPlace: string; places: Array<{ key: string; kind: string }>; lines: Array<{ id: string; outstanding: string }> };
      const place = form.places.find((row) => row.kind === "factory")?.key ?? form.places.find((row) => row.kind === "store")?.key ?? form.defaultPlace;
      const lines = form.lines.filter((line) => Number(line.outstanding) > 0).map((line) => ({ orderLineId: line.id, received: line.outstanding }));
      if (!lines.length) throw new Skip("everything on the order has arrived");
      return receiving.receive(buyer, this.w, { id: receiptId, orderId, place, receivedOn: dayFrom(-9), deliveryNote: detail.deliveryNote, lines });
    });
    const inspector = await this.other(buyer, ["owner", "manager", "projectManager", "factory"]);
    const full = (await receiving.receipt(inspector, this.w, receiptId)) as unknown as { lines: Array<{ id: string; pending: string }> };
    await this.advance(`${key} · delivery inspected and accepted`, !full.lines.some((line) => Number(line.pending) > 0), () =>
      receiving.inspect(inspector, this.w, receiptId, { lines: full.lines.filter((line) => Number(line.pending) > 0).map((line) => ({ id: line.id, accepted: line.pending, rejected: "0" })) }));
    return orderId;
  }

  // ---------------------------------------------------------------- Factory

  private async factory(projectId: string) {
    const factory = this.get(FactoryService);
    const maker = await this.as("factory");
    const actor = await this.actor(this.input.actorUserId);
    const state = async () => (await factory.state(maker, this.w)) as unknown as { toMake: Array<{ lineId: string; projectId: string; title: string; left: string }>; orders: Array<{ id: string; boqLineId: string; status: string }>; workcenters: Array<{ id: string; name: string }> };
    let current = await state();
    let workcenter = current.workcenters.find((row) => /joinery/i.test(row.name)) ?? current.workcenters[0];
    if (!workcenter) {
      const id = this.id("workcenter:joinery");
      workcenter = await this.step("workcenter Joinery", async () => null, async () => {
        await factory.saveWorkcenter(actor, this.w, { id, name: "Joinery", hoursPerDay: "8" });
        current = await state();
        return current.workcenters.find((row) => row.id === id) ?? { id, name: "Joinery" };
      });
    } else this.kept(`workcenter ${workcenter.name}`);
    // One work order per line the factory makes (the media wall, the wardrobe), each taken through to a passed check.
    const lines = current.toMake.filter((row) => row.projectId === projectId);
    if (!lines.length) {
      // A finished project no longer lists lines to make; its work orders are the record.
      const done = current.orders.filter((row) => (row as Any).projectId === projectId);
      if (done.length) { this.kept(`${done.length} factory work orders`); return done[0].id; }
      throw new Skip("the project has no factory line (package supply: make)");
    }
    let firstId = "";
    for (const line of lines) {
      // A work order already on the line (however it was planned) is the one taken forward.
      const orderId = current.orders.find((row) => row.boqLineId === line.lineId && row.status !== "cancelled")?.id ?? this.id(`work-order:${line.lineId}`);
      firstId ||= orderId;
      const short = line.title.split("·")[0].trim().toLowerCase();
      const get = async () => { try { return (await factory.order(maker, this.w, orderId)) as unknown as { order: Any; releaseChecks: Array<{ key: string; passed: boolean; missing: string }>; reports: Any[] }; } catch { return null; } };
      let order = await this.step(`factory work order · ${short}`, get, async () => {
        if (Number(line.left) <= 0) throw new Skip(`${short} is fully planned already`);
        await factory.plan(maker, this.w, { id: orderId, lineId: line.lineId, quantity: line.left, workcenterId: workcenter!.id, plannedStart: dayFrom(-7), plannedEnd: dayFrom(-1) });
        return (await get())!;
      });
      const command = async (who: Actor, action: string, extra: Record<string, unknown> = {}) => {
        const fresh = (await get())!;
        await factory.command(who, this.w, orderId, { action, version: fresh.order.version, ...extra });
      };
      let status = order.order.status as string;
      if (status === "planned") {
        await this.advance(`${short} · drawing approved`, order.releaseChecks.some((check) => check.key === "drawing" && check.passed), () => command(maker, "approve_drawing", { reference: `${short.slice(0, 2).toUpperCase()}-12 rev B` }));
        order = (await get())!;
        const blocked = order.releaseChecks.filter((check) => !check.passed);
        if (blocked.length) { this.skip(`factory · ${short}`, `not releasable: ${blocked.map((check) => check.missing).join("; ")}`); continue; }
        await this.advance(`${short} · work order released`, false, () => command(maker, "release"));
        status = "released";
      }
      if (status === "released") { await this.advance(`${short} · production started`, false, () => command(maker, "start")); status = "in_production"; }
      if (status === "in_production") {
        order = (await get())!;
        const reportId = this.id(`work-order:${line.lineId}:report-1`);
        const approver = await this.other(maker, ["owner", "manager", "projectManager"]);
        await this.advance(`${short} · output reported`, order.reports.some((report) => report.id === reportId), () => factory.command(maker, this.w, orderId, { action: "report", id: reportId, good: order.order.left ?? order.order.quantity, note: "Carcass and doors complete." }));
        order = (await get())!;
        const report = order.reports.find((row) => row.id === reportId);
        await this.advance(`${short} · output approved`, !report || report.status !== "pending", () => command(approver, "decide_report", { reportId, decision: "approve" }));
        order = (await get())!;
        await this.advance(`${short} · quality checked`, Number(order.order.toCheck ?? 0) <= 0, () => factory.command(approver, this.w, orderId, { action: "check", id: this.id(`work-order:${line.lineId}:check-1`), passed: order.order.toCheck }));
      } else if (["ready", "closed", "dispatched"].includes(status)) this.kept(`${short} · work order ${status}`);
    }
    return firstId;
  }

  // ---------------------------------------------------------------- Site

  private async site(projectId: string, rooms: Map<string, string>) {
    const site = this.get(SiteService), work = this.get(ProjectWorkService);
    const pm = await this.as("projectManager"), supervisor = await this.as("site");
    const state = async () => (await site.state(pm, this.w, projectId)) as unknown as { site: { startedOn: string | null }; reports: Array<{ id: string; version: number; status: string; photos?: unknown[] }> };
    let current = await state();
    await this.advance("site work started", Boolean(current.site.startedOn), () => site.command(pm, this.w, projectId, { action: "start_site", on: dayFrom(-6) }));
    current = await state();
    const reportId = this.id("site-report:1");
    let report = current.reports.find((row) => row.id === reportId);
    if (!report) {
      await this.step("daily site report with a photo", async () => null, async () => {
        await site.command(supervisor, this.w, projectId, { id: reportId, action: "save_report", reportDate: dayFrom(-3), weather: "Clear", workforce: [{ trade: "Carpenters", people: 3 }, { trade: "Painters", people: 2 }],
          notes: "Media wall carcass installed; first coat of paint in the dining room.", lines: [] });
        await site.uploadPhoto(supervisor, this.w, projectId, reportId, this.id("site-report:1:photo"), tile("media-wall-carcass") as never);
        current = await state();
        return current.reports.find((row) => row.id === reportId)!;
      });
      report = current.reports.find((row) => row.id === reportId);
    } else this.kept("daily site report");
    if (report && report.status === "draft") { await this.advance("site report submitted", false, () => site.command(supervisor, this.w, projectId, { action: "submit", reportId, version: report!.version })); current = await state(); report = current.reports.find((row) => row.id === reportId); }
    if (report && report.status === "submitted") {
      const approver = await this.other(supervisor, ["projectManager", "owner", "manager"]);
      await this.advance("site report approved", false, () => site.command(approver, this.w, projectId, { action: "approve", reportId, version: report!.version }));
    }
    // A snag found at inspection, fixed on site, closed by the project manager with a photo after.
    const snagId = this.id("snag:1");
    const board = async () => ((await work.board(pm, this.w, projectId)) as { items: Array<{ id: string; version: number; status: string }> }).items;
    let snag = (await board()).find((row) => row.id === snagId);
    if (!snag) {
      await this.step("snag · shadow gap uneven on the media wall", async () => null, async () => {
        await work.command(pm, this.w, projectId, { action: "create", id: snagId, type: "snag", title: "Shadow gap uneven on the media wall's left return", severity: "minor", source: "inspection",
          areaId: rooms.get("Living room") ?? null, assigneeId: supervisor.membershipId, dueDate: dayFrom(2) });
        return (await board()).find((row) => row.id === snagId)!;
      });
      snag = (await board()).find((row) => row.id === snagId);
    } else this.kept("snag · shadow gap uneven on the media wall");
    if (snag && snag.status === "todo") { await this.advance("snag fixed (in review)", false, () => work.command(supervisor, this.w, projectId, { action: "update", itemId: snagId, version: snag!.version, status: "in_review" })); snag = (await board()).find((row) => row.id === snagId); }
    if (snag && snag.status === "in_review") {
      const detail = (await work.item(pm, this.w, projectId, snagId)) as unknown as { photos?: Array<{ kind: string }> };
      await this.advance("snag photo after", (detail.photos ?? []).some((photo) => photo.kind === "after"), () => work.uploadPhoto(supervisor, this.w, projectId, snagId, this.id("snag:1:after"), "after", tile("shadow-gap-corrected") as never));
      snag = (await board()).find((row) => row.id === snagId);
      // Someone other than who fixed it closes a snag: the project manager, or the owner when they are the same person.
      const closer = pm.userId === supervisor.userId ? await this.other(supervisor, ["projectManager", "owner", "manager"]) : pm;
      await this.advance("snag closed by the project manager", false, () => work.command(closer, this.w, projectId, { action: "update", itemId: snagId, version: snag!.version, status: "done" }));
    } else if (snag?.status === "done") this.kept("snag closed");
    // The remaining tasks are done once the installation is in.
    for (const item of await board()) {
      if (item.id === this.id("task:installation") && item.status !== "done") await this.advance("task done · installation", false, () => work.command(pm, this.w, projectId, { action: "update", itemId: item.id, version: item.version, status: "done" }));
    }
  }

  /** Stages move forward while their checks pass; the first stage that isn't ready stays current. */
  private async stages(projectId: string) {
    const projects = this.get(ProjectCoreService);
    const pm = await this.as("projectManager");
    for (let guard = 0; guard < 20; guard += 1) {
      const detail = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number; status: string }; stages: Array<{ id: string; key: string; status: string; checks: Array<{ key: string; kind: string; passed: boolean }> }> };
      const stage = detail.stages.find((row) => row.status === "current");
      if (!stage || detail.project.status !== "active") return;
      for (const check of stage.checks.filter((row) => row.kind === "confirm" && !row.passed)) {
        const fresh = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number } };
        await this.advance(`stage ${stage.key} · ${check.key} confirmed`, false, () => projects.command(pm, this.w, projectId, { action: "confirm_check", stageId: stage.id, checkKey: check.key, version: fresh.project.version }));
      }
      const after = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number }; stages: Array<{ id: string; checks: Array<{ passed: boolean; key: string }> }> };
      const ready = after.stages.find((row) => row.id === stage.id)!;
      if (!ready.checks.every((check) => check.passed)) { this.log(`  note     project stays at "${stage.key}": ${ready.checks.filter((check) => !check.passed).map((check) => check.key).join(", ")}`); return; }
      await this.advance(`stage ${stage.key} completed`, false, () => projects.command(pm, this.w, projectId, { action: "complete_stage", stageId: stage.id, version: after.project.version }));
    }
  }

  // ---------------------------------------------------------------- Handover and warranty

  private async handover(projectId: string, caseId: string, rooms: Map<string, string>) {
    const handover = this.get(HandoverService), warranty = this.get(WarrantyService);
    const pm = await this.as("projectManager");
    const packId = this.id("handover:villa-12");
    const state = async () => (await handover.state(pm, this.w, projectId)) as unknown as { packs: Array<{ id: string; status: string; version: number; documents: unknown[] }> };
    let current = await state();
    let pack = current.packs.find((row) => row.id === packId);
    if (!pack) {
      await this.step("handover pack · Villa 12", async () => null, async () => {
        await handover.command(pm, this.w, projectId, { action: "create_pack", id: packId, title: "Villa 12 handover", areaIds: [...rooms.values()] });
        current = await state();
        return current.packs.find((row) => row.id === packId)!;
      });
      pack = current.packs.find((row) => row.id === packId);
    } else this.kept("handover pack · Villa 12");
    if (!pack) return;
    if (pack.status === "draft") {
      await this.advance("warranty document attached", pack.documents.length > 0, async () => {
        const pdf = Buffer.from("%PDF-1.4\n% Demonstration warranty document\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
        await handover.uploadDocument(pm, this.w, projectId, packId, this.id("handover:villa-12:warranty"), { kind: "warranty", title: "Joinery and furniture warranty" },
          { buffer: pdf, originalname: "warranty.pdf", mimetype: "application/pdf", size: pdf.length } as never);
      });
      current = await state();
      pack = current.packs.find((row) => row.id === packId)!;
      await this.advance("handover pack issued to the client", false, async () => {
        try { await handover.command(pm, this.w, projectId, { action: "issue", packId, version: pack!.version }); } catch (error) {
          if (!(error instanceof HttpException) || error.getStatus() !== 409) throw error;
          // Stages still run: the manager confirms the handover goes ahead with what's open.
          await handover.command(pm, this.w, projectId, { action: "issue", packId, version: pack!.version, confirmOpen: true, openReason: "Demonstration handover; remaining stages are administrative." });
        }
      });
      current = await state();
      pack = current.packs.find((row) => row.id === packId)!;
    }
    if (pack.status === "issued") {
      await this.advance("handover accepted by the client in the portal", false, async () => {
        const view = await this.portalView();
        const project = view.projects.find((row) => row.id === caseId);
        const open = project?.decisions?.handovers?.find((row: Any) => row.id === packId && row.canDecide);
        if (!open) throw new Skip("the handover is not open for the client's decision in the portal");
        await this.portalDecision("handover_decision", `handover:${caseId}:${packId}:accept`, { caseId, packId, decision: "accept", outstanding: [] });
      });
    } else if (pack.status === "accepted") this.kept("handover accepted by the client");
    const cover = (await warranty.state(pm, this.w, projectId)) as unknown as { items: Array<{ title: string; startsOn: string; endsOn: string }> };
    if (cover.items.length) this.log(`  note     warranty runs on ${cover.items.length} items from ${cover.items[0].startsOn} to ${cover.items[0].endsOn}`);
    else this.skip("warranty", "no warranty items started (the handover is not accepted)");
  }
}

// ---------------------------------------------------------------- helpers

/** An error as a person reads it: the API message, not a stack. */
function describe(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const message = typeof response === "string" ? response : (response as { message?: string | string[] }).message;
    return Array.isArray(message) ? message.join("; ") : message ?? error.message;
  }
  if (error instanceof Error) return error.cause && error.message.includes(": ") ? error.message : error.message;
  return String(error);
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

/** A calendar date `days` from today (negative: in the past). */
function dayFrom(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** A small, valid PNG for demonstration pictures (the seed carries no camera): a 64×64 tile whose colour comes from its label. */
function tile(label: string): Upload {
  const size = 64;
  const seed = createHash("sha1").update(label).digest();
  const [r, g, b] = [150 + (seed[0] % 80), 140 + (seed[1] % 80), 130 + (seed[2] % 80)];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const shade = (x >> 3) % 2 === (y >> 3) % 2 ? 0 : 18;
      const at = y * (size * 3 + 1) + 1 + x * 3;
      raw[at] = r - shade; raw[at + 1] = g - shade; raw[at + 2] = b - shade;
    }
  }
  const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return { buffer: png, originalname: `${label}.png`, mimetype: "image/png", size: png.length };
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
