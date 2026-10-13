import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { CommercialService } from "../commercial/commercial.service";
import { deliverPortalOtp } from "../commercial/portal-otp-delivery";
import { canonicalHash } from "../crm/shared/crm-types";
import { DatabaseService } from "../database/database.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { PreProjectDefinitionService } from "../pre-projects/pre-project-definition.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { DeviceTokenStoreService } from "../crm/notifications/device-token-store.service";
import { confirmName, mobileNumber, openSession, portalCodes, sendCode, signIn, signOut, useCode, type Channel, type Delivery, type PortalContact, type PortalCodes } from "./portal-auth";
import {
  answerRequest, assertDecisionOpen, claimWarranty, decideDefinition, decideDesign, decideDrawingsInPortal, decideHandover, decideMaterials, decideQuote, grantFor,
  type DecisionContext,
} from "./portal-decisions";
import { designComment, designReply, designResolve } from "./portal-design";
import { chooseAlternative } from "./portal-alternatives";
import { decidePortalChange, raiseChange } from "./portal-changes";
import { recordVisits } from "./portal-feed";
import { ledgerDecision, presentationChoice } from "./portal-design-decisions";
import { deviceInput, deviceState, optOutDevice, registerDevice } from "./portal-devices";
import { FilePresence, locateClientAsset, readStored, uploadClientFile } from "./portal-files";
import { openInvitation } from "./portal-invitations";
import { reportIssue } from "./portal-issues";
import { comment, raiseRequest, readThread } from "./portal-messages";
import { minutesComment } from "./portal-meetings";
import { readMeeting } from "../meetings/meeting-minutes";
import { addInspiration, boardComment, react, removeInspiration } from "./portal-moodboard";
import { tellStaffClientSignedIn } from "./portal-notices";
import { invoiceDocument, receiptDocument, reportPayment } from "./portal-payments";
import { askAboutDay, reactToDay } from "./portal-progress";
import { chooseUpdates } from "./portal-updates";
import { isImage, readView, workspaceToday } from "./portal-read";
import { readPortalSettings, SECTIONS, type PortalSettings, type Section } from "./portal-settings";
import { findSite, readSite } from "./portal-site";
import { siteAccess } from "./portal-site-access";
import type { ReferenceUpload } from "../workspaces/reference-upload";

/** Portal work runs as no staff user: the actor is the client, recorded by their contact. */
const PORTAL_ACTOR = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Handler = (ctx: DecisionContext, body: Record<string, unknown>) => Promise<{ ok: boolean; entity?: { type: string; id: string }; audit?: Record<string, unknown>; [key: string]: unknown }>;
/** Every client command, with the portal section it belongs to (a hidden section can't be acted on). */
const COMMANDS: Record<string, [Handler, Section]> = {
  quote_decision: [decideQuote, "decisions"], design_decision: [decideDesign, "decisions"], definition_decision: [decideDefinition, "decisions"],
  request_answer: [answerRequest, "decisions"], materials_decision: [decideMaterials, "decisions"], drawings_decision: [decideDrawingsInPortal, "decisions"], handover_decision: [decideHandover, "decisions"],
  warranty_claim: [claimWarranty, "warranty"], request: [raiseRequest, "messages"], comment: [comment, "messages"], read_thread: [readThread, "messages"],
  react: [react, "moodboard"], board_comment: [boardComment, "moodboard"], add_inspiration: [addInspiration, "moodboard"], remove_inspiration: [removeInspiration, "moodboard"],
  report_payment: [reportPayment, "payments"], report_issue: [reportIssue, "progress"], site_access: [siteAccess, "progress"],
  progress_react: [reactToDay, "progress"], progress_question: [askAboutDay, "progress"], update_preference: [chooseUpdates, "progress"],
  design_comment: [designComment, "decisions"], design_reply: [designReply, "decisions"], design_resolve: [designResolve, "decisions"],
  presentation_choice: [presentationChoice, "decisions"], ledger_decision: [ledgerDecision, "decisions"],
  change_raise: [raiseChange, "decisions"], change_decision: [decidePortalChange, "decisions"], ledger_alternative: [chooseAlternative, "decisions"],
  minutes_comment: [minutesComment, "meetings"],
};

/**
 * The client portal: the tenant's own site where a homeowner signs in with their mobile number and a code,
 * sees their projects as the team publishes them, and decides, pays and reports on the exact revision.
 */
@Injectable()
export class ClientPortalService {
  private readonly codes: PortalCodes;
  /** Which stored files are there, remembered across views. */
  private readonly presence: FilePresence;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly commercial: CommercialService,
    private readonly definitions: PreProjectDefinitionService,
    private readonly mailer: TransactionalEmailService,
    @Optional() private readonly storage?: BrandAssetStorageService,
    @Optional() private readonly deviceTokens?: DeviceTokenStoreService,
  ) {
    const production = config.get("NODE_ENV") === "production";
    if (config.get("PORTAL_DEMO_OTP") === "true" && production) throw new Error("PORTAL_DEMO_OTP cannot be enabled in production.");
    if (production && (config.get<string>("PORTAL_OTP_SECRET") ?? "").length < 32) throw new Error("Set a stable PORTAL_OTP_SECRET of at least 32 characters for production.");
    this.codes = portalCodes(config);
    this.presence = new FilePresence(storage);
  }

  private delivery(): Delivery {
    return {
      whatsapp: ({ workspaceId, challengeId, phone, code }) => deliverPortalOtp(this.config, workspaceId, challengeId, phone, code),
      email: async ({ workspaceId, to, code, purpose }) => (await this.mailer.sendPortalCode({ workspaceId, to, code, purpose })).status === "sent",
    };
  }

  /** The enabled portal behind a link, or the tenant's own domain or sign-in subdomain. */
  async resolve(by: { slug?: string; host?: string; login?: string }) {
    const site = await findSite(this.db, by);
    if (!site) throw new NotFoundException("This client portal isn't available.");
    return site;
  }

  private within<T>(slug: string, work: (client: PoolClient, workspaceId: string, settings: PortalSettings) => Promise<T>) {
    return this.resolve({ slug }).then((site) => this.db.tenantTransaction(site.workspaceId, PORTAL_ACTOR, async (client) =>
      work(client, site.workspaceId, await readPortalSettings(client, site.workspaceId))));
  }

  site(slug: string) {
    return this.within(slug, (client, workspaceId, settings) => readSite(client, workspaceId, settings, this.codes.demo));
  }

  /** A code to sign in, or (signed in) to confirm a decision, by WhatsApp or email. */
  challenge(slug: string, body: Record<string, unknown>, token: string, requester: string | undefined) {
    const channel: Channel = body.channel === "email" ? "email" : "whatsapp";
    const purpose = typeof body.purpose === "string" && body.purpose ? body.purpose.slice(0, 200) : "sign_in";
    return this.within(slug, async (client, workspaceId, settings) => {
      if (purpose === "sign_in") return sendCode(client, workspaceId, this.codes, this.delivery(), { phone: mobileNumber(body.phone), channel, purpose, requester: this.codes.requester(requester) });
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      await assertDecisionOpen(this.context(client, workspaceId, settings, contact, await workspaceToday(client, workspaceId)), purpose);
      return sendCode(client, workspaceId, this.codes, this.delivery(), { phone: contact.phone, channel, purpose, requester: this.codes.requester(requester), session: contact });
    });
  }

  /** Signs the client in; the first time they open a project, the people running it hear about it. */
  async login(slug: string, body: Record<string, unknown>) {
    const result = await this.within(slug, async (client, workspaceId) => {
      const session = await signIn(client, workspaceId, this.codes, { challengeId: typeof body.challengeId === "string" ? body.challengeId : "", code: typeof body.code === "string" ? body.code : "" });
      if (session?.firstSignIns.length) await tellStaffClientSignedIn(client, workspaceId, session.firstSignIns);
      return session;
    });
    if (!result) throw new BadRequestException("That code isn't right or has expired. Check it, or ask for a new one.");
    const { firstSignIns: _first, ...session } = result;
    return session;
  }

  /** What an invitation link opens: the client's number ready to sign in, or that the link no longer works. */
  invitation(slug: string, token: string) {
    return this.within(slug, async (client, workspaceId) => {
      const found = await openInvitation(client, workspaceId, token);
      if (!found) throw new NotFoundException("This invite link isn't valid any more.");
      return found;
    });
  }

  view(slug: string, token: string) {
    return this.within(slug, async (client, workspaceId, settings) => {
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      // AI2: this visit is recorded; "what changed" counts from the contact's previous visit on each project.
      const visits = await recordVisits(client, workspaceId, contact.grants.map((grant) => grant.id));
      return readView(client, workspaceId, contact, settings, this.definitions, this.presence, visits);
    });
  }

  logout(slug: string, token: string) {
    return this.within(slug, async (client, workspaceId) => { await signOut(client, workspaceId, token); return { ok: true }; });
  }

  /**
   * The client app's push notices (plan §0.3c): this phone is registered for the signed-in contact only after they said
   * yes in the app and the phone allowed notifications; turning them off keeps the opt-out and drops the token.
   */
  device(slug: string, token: string, installationId: string) {
    return this.within(slug, async (client, workspaceId) => deviceState(client, workspaceId, await openSession(client, workspaceId, token, this.codes.demo), installationId));
  }

  async registerDevice(slug: string, token: string, body: Record<string, unknown>) {
    const input = deviceInput(body);
    const store = this.deviceTokens;
    if (!store) throw new ServiceUnavailableException("Notifications aren't available right now.");
    return this.within(slug, async (client, workspaceId) => {
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      const result = await registerDevice(client, workspaceId, contact, store, input);
      if (!result.replayed) await recordAudit(client, { workspaceId, actorUserId: null, source: "client_portal", action: "client_portal.device_registered",
        entityType: "client_portal_contact", entityId: contact.grants[0].id, after: { installationId: input.installationId, platform: input.platform } });
      return result;
    });
  }

  optOutDevice(slug: string, token: string, body: Record<string, unknown>) {
    return this.within(slug, async (client, workspaceId) => {
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      const result = await optOutDevice(client, workspaceId, contact, this.deviceTokens, body.installationId);
      await recordAudit(client, { workspaceId, actorUserId: null, source: "client_portal", action: "client_portal.device_opted_out",
        entityType: "client_portal_contact", entityId: contact.grants[0].id, after: { installationId: body.installationId } });
      return result;
    });
  }

  /**
   * One client command, once: the command id makes a retry return the first result (a different body under
   * the same id is refused), and every command is audited with the client contact that gave it.
   */
  async command(slug: string, token: string, body: Record<string, unknown>) {
    const action = typeof body.action === "string" ? body.action : "";
    if (action !== "confirm_name" && !COMMANDS[action]) throw new BadRequestException("This action isn't available.");
    if (typeof body.commandId !== "string" || !UUID.test(body.commandId)) throw new BadRequestException("Try that again.");
    const { code: _code, ...hashed } = body;
    const requestHash = canonicalHash(hashed);
    try {
      return await this.run(slug, token, action, body, requestHash);
    } catch (error) {
      if (!(error instanceof WrongCode)) throw error;
      // The decision rolled back; the wrong try still counts against the code.
      const site = await this.resolve({ slug });
      await this.db.tenantTransaction(site.workspaceId, PORTAL_ACTOR, (client) => client.query(
        `UPDATE client_portal_challenges SET attempts = attempts + 1 WHERE workspace_id = $1 AND id = $2 AND consumed_at IS NULL`, [site.workspaceId, error.challengeId]));
      throw new UnauthorizedException("That code isn't right or has expired. Ask for a new one.");
    }
  }

  private run(slug: string, token: string, action: string, body: Record<string, unknown>, requestHash: string) {
    return this.within(slug, async (client, workspaceId, settings) => {
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      const prior = (await client.query<{ requestHash: string; result: Record<string, unknown> }>(
        `SELECT request_hash AS "requestHash", result FROM client_portal_commands WHERE workspace_id = $1 AND id = $2`, [workspaceId, body.commandId])).rows[0];
      if (prior) {
        if (prior.requestHash !== requestHash) throw new ConflictException("This was already sent with different details. Reload and try again.");
        return { ...prior.result, replayed: true };
      }
      let result: Record<string, unknown>;
      let grantId: string | null = contact.grants[0].id;
      let entity = { type: "client_portal_contact", id: contact.grants[0].id };
      let audit: Record<string, unknown> = {};
      if (action === "confirm_name") {
        result = { ok: true, name: await confirmName(client, workspaceId, contact, body.name) };
        audit = { name: result.name };
      } else {
        const ctx = this.context(client, workspaceId, settings, contact, await workspaceToday(client, workspaceId));
        const [handler, section] = COMMANDS[action];
        grantId = (await grantFor(ctx, body.caseId, section)).grant.id;
        const { entity: target, audit: detail, ...rest } = await handler(ctx, body);
        result = rest;
        if (target) entity = target;
        audit = detail ?? {};
      }
      await client.query(`INSERT INTO client_portal_commands (workspace_id, id, grant_id, action, request_hash, result) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [workspaceId, body.commandId, grantId, action, requestHash, JSON.stringify(result)]);
      await recordAudit(client, { workspaceId, actorUserId: null, source: "client_portal", action: `client_portal.${action}`, entityType: entity.type, entityId: entity.id,
        after: { ...audit, grantId, commandId: body.commandId } });
      return result;
    });
  }

  /**
   * A file the client may open: a design shared with them, a shared site photo, a handover document, the signed
   * agreement, a moodboard photo the team shared, or a file someone on their side added.
   */
  file(slug: string, token: string, kind: string, id: string, preview: boolean) {
    if (!UUID.test(id)) throw new NotFoundException("File not found.");
    return this.within(slug, async (client, workspaceId, settings) => {
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      const ctx = this.context(client, workspaceId, settings, contact, await workspaceToday(client, workspaceId));
      const found = kind === "asset" ? await locateClientAsset(client, workspaceId, id) : await this.locate(client, workspaceId, kind, id);
      if (!found || !contact.grants.some((grant) => grant.caseId === found.caseId)) throw new NotFoundException("File not found.");
      // Open when any section that shows the file is shared with this client (a handover document shows under Decisions and Documents).
      if (!(await this.anySection(ctx, found.caseId, found.sections))) throw new NotFoundException("File not found.");
      return readStored(this.storage, found, preview);
    });
  }

  /** Whether any of these sections of the project is open to this client. */
  private async anySection(ctx: DecisionContext, caseId: string, sections: readonly Section[]) {
    for (const section of sections) if (await grantFor(ctx, caseId, section).then(() => true, () => false)) return true;
    return false;
  }

  /**
   * A photo or PDF the client adds to their project before sending it with something (an inspiration, a message,
   * proof of payment, a problem). The id is the client's, so a retried upload returns the same file.
   */
  upload(slug: string, token: string, caseId: string, id: string, file: ReferenceUpload | undefined) {
    return this.within(slug, async (client, workspaceId, settings) => {
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      const ctx = this.context(client, workspaceId, settings, contact, await workspaceToday(client, workspaceId));
      const grant = contact.grants.find((item) => item.caseId === caseId);
      if (!grant || !(await this.anySection(ctx, caseId, SECTIONS.filter((section) => section !== "documents")))) throw new NotFoundException("This project isn't shared with you.");
      const stored = await uploadClientFile(client, this.storage, workspaceId, grant, id, file);
      await recordAudit(client, { workspaceId, actorUserId: null, source: "client_portal", action: "client_portal.file_added", entityType: "pre_project_case", entityId: caseId,
        after: { grantId: grant.id, assetId: stored.id, mimeType: stored.mimeType } });
      return stored;
    });
  }

  /** A tax invoice or a receipt of the client's, as a document they print or save. */
  document(slug: string, token: string, caseId: string, kind: string, id: string) {
    if (kind !== "invoice" && kind !== "receipt") throw new NotFoundException("Document not found.");
    return this.within(slug, async (client, workspaceId, settings) => {
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      const today = await workspaceToday(client, workspaceId);
      const { row } = await grantFor(this.context(client, workspaceId, settings, contact, today), caseId, "payments");
      return kind === "invoice" ? { kind, invoice: await invoiceDocument(client, workspaceId, row, id, today) } : { kind, receipt: await receiptDocument(client, workspaceId, row, id) };
    });
  }

  private async locate(client: PoolClient, workspaceId: string, kind: string, id: string) {
    type Found = { caseId: string; objectKey: string; previewKey: string | null; mimeType: string; name: string; sections: Section[] };
    if (kind === "design") {
      // Designs shared for review (decisions), approved (documents), and concept and material boards (the moodboard).
      const row = (await client.query<Omit<Found, "sections"> & { status: string; board: boolean }>(
        `SELECT version.case_id AS "caseId", asset.object_key AS "objectKey", asset.preview_key AS "previewKey", asset.mime_type AS "mimeType", asset.original_name AS name, version.status,
                (design.stage IN ('concepts', 'material_selection') OR design.document_type IN ('Concept / mood board', 'Material / finish board')) AS board
           FROM pre_project_design_versions version
           JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
           JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
          WHERE version.workspace_id = $1 AND version.id = $2 AND (version.status IN ('client_review', 'approved', 'changes_requested', 'rejected')
             -- An option of a presentation shown to the client (plan §6.7a), whatever its review state.
             OR EXISTS (SELECT 1 FROM design_presentation_options option JOIN design_presentations presentation ON presentation.workspace_id = option.workspace_id AND presentation.id = option.presentation_id
                         WHERE option.workspace_id = version.workspace_id AND option.design_id = version.design_id AND presentation.status IN ('presented', 'chosen', 'changes_requested')))`, [workspaceId, id])).rows[0];
      if (!row) return null;
      const sections: Section[] = row.status === "approved" ? ["documents", "decisions"] : ["decisions"];
      return { ...row, sections: row.board ? [...sections, "moodboard" as const] : sections };
    }
    if (kind === "photo") {
      const row = (await client.query<Omit<Found, "sections">>(
        `SELECT project.case_id AS "caseId", photo.object_key AS "objectKey", photo.preview_key AS "previewKey", photo.mime_type AS "mimeType", photo.original_name AS name
           FROM site_report_photos photo
           JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id AND (report.status = 'approved' OR report.delivery = 'sent')
           JOIN delivery_projects project ON project.workspace_id = report.workspace_id AND project.id = report.project_id
          WHERE photo.workspace_id = $1 AND photo.id = $2 AND photo.shared_at IS NOT NULL
            -- A day taken off the client's page takes its photos with it (unless a shared update still shows one).
            AND (report.client_hidden_at IS NULL OR EXISTS (SELECT 1 FROM project_update_photos used WHERE used.workspace_id = photo.workspace_id AND used.photo_id = photo.id))`,
        [workspaceId, id])).rows[0];
      const settings = await readPortalSettings(client, workspaceId);
      return row && settings.progress.photos ? { ...row, sections: ["progress" as const] } : null;
    }
    if (kind === "drawing") {
      // A drawing of the technical drawings sent to the client (PLM-059), never one still with the team.
      const row = (await client.query<Omit<Found, "sections">>(
        `SELECT project.case_id AS "caseId", file.object_key AS "objectKey", file.preview_key AS "previewKey", file.mime_type AS "mimeType", file.original_name AS name
           FROM project_drawing_files file
           JOIN project_drawing_revisions revision ON revision.workspace_id = file.workspace_id AND revision.id = file.revision_id AND revision.sent_at IS NOT NULL
           JOIN delivery_projects project ON project.workspace_id = file.workspace_id AND project.id = file.project_id
          WHERE file.workspace_id = $1 AND file.id = $2 AND file.kind = 'drawing'`, [workspaceId, id])).rows[0];
      return row ? { ...row, sections: ["decisions" as const] } : null;
    }
    if (kind === "minutes") {
      // A file kept on a meeting's shared notes (PLM-153); the case is the one the client opened it from (checked below).
      const row = (await client.query<Omit<Found, "sections" | "caseId"> & { minutesActivity: string }>(
        `SELECT file.object_key AS "objectKey", file.preview_key AS "previewKey", file.mime_type AS "mimeType", file.original_name AS name, minutes.activity_id AS "minutesActivity"
           FROM meeting_minutes_files file
           JOIN meeting_minutes minutes ON minutes.workspace_id = file.workspace_id AND minutes.activity_id = file.activity_id AND minutes.shared_at IS NOT NULL
            AND file.id = ANY (minutes.file_ids)
          WHERE file.workspace_id = $1 AND file.id = $2`, [workspaceId, id])).rows[0];
      if (!row) return null;
      const meeting = await readMeeting(client, workspaceId, row.minutesActivity);
      return meeting?.caseId ? { ...row, caseId: meeting.caseId, sections: ["meetings" as const] } : null;
    }
    if (kind === "handover") {
      const row = (await client.query<Omit<Found, "sections">>(
        `SELECT project.case_id AS "caseId", document.object_key AS "objectKey", NULL AS "previewKey", document.mime_type AS "mimeType", document.original_name AS name
           FROM handover_documents document
           JOIN handover_packs pack ON pack.workspace_id = document.workspace_id AND pack.id = document.pack_id AND pack.status <> 'draft'
           JOIN delivery_projects project ON project.workspace_id = pack.workspace_id AND project.id = pack.project_id
          WHERE document.workspace_id = $1 AND document.id = $2`, [workspaceId, id])).rows[0];
      return row ? { ...row, sections: ["documents" as const, "decisions" as const] } : null;
    }
    if (kind === "change") {
      // A change request the client approved by signature: its signed copy (with the certificate page).
      const row = (await client.query<Omit<Found, "sections">>(
        `SELECT change.case_id AS "caseId", version.object_key AS "objectKey", NULL AS "previewKey", version.mime_type AS "mimeType", version.file_name AS name
           FROM change_requests change
           JOIN quote_documents document ON document.workspace_id = change.workspace_id AND document.id = change.document_id
           JOIN quote_document_versions version ON version.workspace_id = document.workspace_id AND version.document_id = document.id AND version.number = document.current_version
          WHERE change.workspace_id = $1 AND change.id = $2 AND change.status = 'approved' AND change.decision_method = 'signed_link'`, [workspaceId, id])).rows[0];
      return row ? { ...row, sections: ["documents" as const] } : null;
    }
    if (kind === "agreement") {
      const row = (await client.query<Omit<Found, "sections">>(
        `SELECT asset.case_id AS "caseId", asset.object_key AS "objectKey", asset.preview_key AS "previewKey", asset.mime_type AS "mimeType", asset.original_name AS name
           FROM pre_project_brief_assets asset WHERE asset.workspace_id = $1 AND asset.id = $2`, [workspaceId, id])).rows[0];
      if (!row) return null;
      const data = await this.commercial.load(client, workspaceId, row.caseId);
      // Only a file of the executed agreement.
      return data.agreement?.status === "executed" && data.agreement.files?.some((file) => file.id === id) ? { ...row, sections: ["documents" as const] } : null;
    }
    return null;
  }

  private context(client: PoolClient, workspaceId: string, settings: PortalSettings, contact: PortalContact, today: string): DecisionContext {
    return {
      db: client, workspaceId, contact, settings, today, definitions: this.definitions,
      commercial: { load: (c, w, caseId) => this.commercial.load(c, w, caseId), persist: (c, w, caseId, data, actor, action, quoteId, note) =>
        this.commercial.persist(c, w, caseId, data, actor, action, quoteId, note) },
      verify: async (purpose, challengeId, code) => {
        if (!(await useCode(client, workspaceId, this.codes, { challengeId, code, purpose, phone: contact.phone }))) throw new WrongCode(challengeId);
        return true;
      },
    };
  }
}

/** A wrong or used decision code: raised inside the decision so nothing of it is saved. */
class WrongCode extends Error {
  constructor(readonly challengeId: string) { super("wrong code"); }
}

export { isImage };
