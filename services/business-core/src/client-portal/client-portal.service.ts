import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { CommercialService } from "../commercial/commercial.service";
import { deliverPortalOtp } from "../commercial/portal-otp-delivery";
import { canonicalHash } from "../crm/shared/crm-types";
import { DatabaseService } from "../database/database.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { PreProjectDefinitionService } from "../pre-projects/pre-project-definition.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { confirmName, mobileNumber, openSession, PortalCodes, sendCode, signIn, signOut, useCode, type Channel, type Delivery, type PortalContact } from "./portal-auth";
import {
  answerRequest, assertDecisionOpen, claimWarranty, comment, decideDefinition, decideDesign, decideHandover, decideMaterials, decideQuote, grantFor, raiseRequest,
  type DecisionContext,
} from "./portal-decisions";
import { openInvitation } from "./portal-invitations";
import { tellStaffClientSignedIn } from "./portal-notices";
import { isImage, readView, workspaceToday } from "./portal-read";
import { readPortalSettings, type PortalSettings } from "./portal-settings";
import { findSite, readSite } from "./portal-site";

/** Portal work runs as no staff user: the actor is the client, recorded by their contact. */
const PORTAL_ACTOR = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Handler = (ctx: DecisionContext, body: Record<string, unknown>) => Promise<{ ok: boolean; entity?: { type: string; id: string }; audit?: Record<string, unknown>; [key: string]: unknown }>;
const COMMANDS: Record<string, Handler> = {
  quote_decision: decideQuote, design_decision: decideDesign, definition_decision: decideDefinition, request_answer: answerRequest,
  materials_decision: decideMaterials, handover_decision: decideHandover, warranty_claim: claimWarranty, request: raiseRequest, comment,
};

/**
 * The client portal: the tenant's own site where a homeowner signs in with their mobile number and a code,
 * sees their projects as the team publishes them, and decides, pays and reports on the exact revision.
 */
@Injectable()
export class ClientPortalService {
  private readonly codes: PortalCodes;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly commercial: CommercialService,
    private readonly definitions: PreProjectDefinitionService,
    private readonly mailer: TransactionalEmailService,
    @Optional() private readonly storage?: BrandAssetStorageService,
  ) {
    const production = config.get("NODE_ENV") === "production";
    if (config.get("PORTAL_DEMO_OTP") === "true" && production) throw new Error("PORTAL_DEMO_OTP cannot be enabled in production.");
    const secret = config.get<string>("PORTAL_OTP_SECRET") ?? "";
    if (production && secret.length < 32) throw new Error("Set a stable PORTAL_OTP_SECRET of at least 32 characters for production.");
    this.codes = new PortalCodes(secret || config.get<string>("LOCAL_AUTH_JWT_SECRET") || randomBytes(32).toString("hex"), config.get("PORTAL_DEMO_OTP") === "true" && !production);
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
    return this.within(slug, async (client, workspaceId, settings) =>
      readView(client, workspaceId, await openSession(client, workspaceId, token, this.codes.demo), settings, this.definitions));
  }

  logout(slug: string, token: string) {
    return this.within(slug, async (client, workspaceId) => { await signOut(client, workspaceId, token); return { ok: true }; });
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
        grantId = (await grantFor(ctx, body.caseId, action === "warranty_claim" ? "warranty" : action === "request" || action === "comment" ? "messages" : "decisions")).grant.id;
        const { entity: target, audit: detail, ...rest } = await COMMANDS[action](ctx, body);
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

  /** A file the client may open: a design shared with them, a shared site photo, a handover document or the signed agreement. */
  file(slug: string, token: string, kind: string, id: string, preview: boolean) {
    if (!UUID.test(id)) throw new NotFoundException("File not found.");
    return this.within(slug, async (client, workspaceId, settings) => {
      const contact = await openSession(client, workspaceId, token, this.codes.demo);
      const ctx = this.context(client, workspaceId, settings, contact, await workspaceToday(client, workspaceId));
      const found = await this.locate(client, workspaceId, kind, id);
      if (!found || !contact.grants.some((grant) => grant.caseId === found.caseId)) throw new NotFoundException("File not found.");
      // Open when any section that shows the file is shared with this client (a handover document shows under Decisions and Documents).
      let open = false;
      for (const section of found.sections) if (!open) open = await grantFor(ctx, found.caseId, section).then(() => true, () => false);
      if (!open) throw new NotFoundException("File not found.");
      if (!this.storage) throw new NotFoundException("File not found.");
      const key = preview && found.previewKey ? found.previewKey : found.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("This file isn't available right now. Ask your project team.");
      return { body: stored.body, mimeType: key === found.previewKey ? "image/webp" : found.mimeType, name: found.name };
    });
  }

  private async locate(client: PoolClient, workspaceId: string, kind: string, id: string) {
    type Found = { caseId: string; objectKey: string; previewKey: string | null; mimeType: string; name: string; sections: Array<"decisions" | "documents" | "progress"> };
    if (kind === "design") {
      // Designs shared for review (decisions) or approved (documents).
      const row = (await client.query<Found & { status: string }>(
        `SELECT version.case_id AS "caseId", asset.object_key AS "objectKey", asset.preview_key AS "previewKey", asset.mime_type AS "mimeType", asset.original_name AS name, version.status
           FROM pre_project_design_versions version
           JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id AND design.archived_at IS NULL
           JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
          WHERE version.workspace_id = $1 AND version.id = $2 AND version.status IN ('client_review', 'approved', 'changes_requested', 'rejected')`, [workspaceId, id])).rows[0];
      return row ? { ...row, sections: row.status === "approved" ? ["documents" as const, "decisions" as const] : ["decisions" as const] } : null;
    }
    if (kind === "photo") {
      const row = (await client.query<Found>(
        `SELECT project.case_id AS "caseId", photo.object_key AS "objectKey", photo.preview_key AS "previewKey", photo.mime_type AS "mimeType", photo.original_name AS name
           FROM site_report_photos photo
           JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id AND report.status = 'approved'
           JOIN delivery_projects project ON project.workspace_id = report.workspace_id AND project.id = report.project_id
          WHERE photo.workspace_id = $1 AND photo.id = $2 AND photo.shared_at IS NOT NULL`, [workspaceId, id])).rows[0];
      const settings = await readPortalSettings(client, workspaceId);
      return row && settings.progress.photos ? { ...row, sections: ["progress" as const] } : null;
    }
    if (kind === "handover") {
      const row = (await client.query<Found>(
        `SELECT project.case_id AS "caseId", document.object_key AS "objectKey", NULL AS "previewKey", document.mime_type AS "mimeType", document.original_name AS name
           FROM handover_documents document
           JOIN handover_packs pack ON pack.workspace_id = document.workspace_id AND pack.id = document.pack_id AND pack.status <> 'draft'
           JOIN delivery_projects project ON project.workspace_id = pack.workspace_id AND project.id = pack.project_id
          WHERE document.workspace_id = $1 AND document.id = $2`, [workspaceId, id])).rows[0];
      return row ? { ...row, sections: ["documents" as const, "decisions" as const] } : null;
    }
    if (kind === "agreement") {
      const row = (await client.query<Found>(
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
