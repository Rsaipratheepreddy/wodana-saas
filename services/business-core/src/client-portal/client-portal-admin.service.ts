import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { canonicalHash } from "../crm/shared/crm-types";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { PreProjectDefinitionService } from "../pre-projects/pre-project-definition.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { demoCodeInput, endSessions, mobileNumber, portalCodes, setDemoCode, type Grant, type PortalCodes, type PortalContact } from "./portal-auth";
import { inviteClient, readClientAccess, revokeClient, type InviteDelivery } from "./portal-invitations";
import { readView } from "./portal-read";
import { optionalEmail, readPortalSettings, readProjectAccess, savePortalSettings, saveProjectAccess, SECTIONS } from "./portal-settings";
import { portalUrl, readSite } from "./portal-site";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Contact = { id: string; name: string; confirmedName: string | null; phone: string; email: string | null; role: "approver" | "viewer"; active: boolean; testContact: boolean;
  demoCode: boolean; lastSignedInAt: string | null; version: number };
type Command = { id: string; version: number; hash: string };

/**
 * The firm's side of the client portal: what clients see (Settings → Client portal), each project's own
 * choice and pause, the client contacts who can sign in, and inviting the project's client.
 */
@Injectable()
export class ClientPortalAdminService {
  private readonly codes: PortalCodes;

  constructor(private readonly access: WorkspaceAccessService, private readonly config: ConfigService, private readonly mailer: TransactionalEmailService,
    @Optional() private readonly definitions?: PreProjectDefinitionService) {
    this.codes = portalCodes(config);
  }

  /**
   * The portal exactly as this case's client sees it, for the team (a preview, and Woddy's tours): the site in the
   * tenant's brand and the view read as the case's decision-maker (or its first contact; with none yet, as a
   * viewer named after the client). Read-only: nothing is recorded, no session is opened and no one is told.
   */
  preview(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["portal.manage", "pre_projects.view", "projects.view"], async (client) => {
      const id = this.caseId(caseId);
      const grant = (await client.query<Grant>(
        `SELECT id, case_id AS "caseId", coalesce(confirmed_name, name) AS name, role, email, name_confirmed_at IS NOT NULL AS confirmed,
                demo_code_hash IS NOT NULL AS demo
           FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND active
          ORDER BY (role = 'approver') DESC, created_at LIMIT 1`, [workspaceId, id])).rows[0] ?? await this.previewGrant(client, workspaceId, id);
      const settings = await readPortalSettings(client, workspaceId);
      const contact: PortalContact = { sessionId: "preview", phone: "", name: grant.name, nameConfirmed: true, grants: [grant] };
      const definitions = this.definitions ?? { portalData: async () => null };
      return { site: await readSite(client, workspaceId, settings, this.demo), view: await readView(client, workspaceId, contact, settings, definitions), preview: true as const };
    });
  }

  /** No contact yet: the client as a viewer, named as the team knows them. */
  private async previewGrant(client: PoolClient, workspaceId: string, caseId: string): Promise<Grant> {
    const found = (await client.query<{ name: string }>(
      `SELECT coalesce(party.display_name, opportunity.title) AS name
         FROM pre_project_cases pre_case
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
    if (!found) throw new NotFoundException("Project not found.");
    return { id: "preview", caseId, name: found.name, role: "viewer", email: null, confirmed: true, demo: false };
  }

  private get demo() {
    return this.config.get("PORTAL_DEMO_OTP") === "true" && this.config.get("NODE_ENV") !== "production";
  }

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["portal.manage", "pre_projects.view", "projects.view"], async (client, user) =>
      this.readSettings(client, workspaceId, await this.access.hasPermission(client, workspaceId, user.userId, "portal.manage")));
  }

  saveSettings(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "portal.manage", async (client, user) => {
      const { before, after } = await savePortalSettings(client, workspaceId, user.userId, body);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "client_portal.settings_changed", entityType: "workspace", entityId: workspaceId, before, after });
      return this.readSettings(client, workspaceId, true);
    });
  }

  private async readSettings(client: PoolClient, workspaceId: string, canManage: boolean) {
    const settings = await readPortalSettings(client, workspaceId);
    // The live preview shows the real brand, exactly as clients will see it.
    return { settings, site: await readSite(client, workspaceId, settings, this.demo), canManage, demo: this.demo };
  }

  /** A project's portal: which sections its client sees, whether it's paused, and who can sign in. */
  project(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { caseId, canManage, canDemo } = await this.projectRole(client, workspaceId, projectId, user.userId);
      return this.readProject(client, workspaceId, projectId, caseId, canManage, canDemo);
    });
  }

  saveProject(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { caseId, canManage, canDemo } = await this.projectRole(client, workspaceId, projectId, user.userId);
      if (!canManage) throw new ForbiddenException("Only the project manager changes what the client sees.");
      const { before, after } = await saveProjectAccess(client, workspaceId, projectId, user.userId, body);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: after.paused && !before.paused ? "client_portal.project_paused"
        : !after.paused && before.paused ? "client_portal.project_resumed" : "client_portal.project_sections", entityType: "project", entityId: projectId, before, after });
      return this.readProject(client, workspaceId, projectId, caseId, true, canDemo);
    });
  }

  private async readProject(client: PoolClient, workspaceId: string, projectId: string, caseId: string, canManage: boolean, canSetDemoCode: boolean) {
    const settings = await readPortalSettings(client, workspaceId);
    const access = await readProjectAccess(client, workspaceId, projectId);
    return {
      enabled: settings.enabled, sections: SECTIONS.filter((section) => settings.sections[section]), access,
      contacts: await this.readContacts(client, workspaceId, caseId), caseId, canManage, canSetDemoCode,
      portalUrl: await portalUrl(client, this.config, workspaceId, settings.slug),
      client: await readClientAccess(client, { workspaceId, projectId, caseId, settings, access }),
    };
  }

  /**
   * Invites the project's client to the portal: their identity for this project is created or reused, and they
   * get the tenant's email with the portal address, how to sign in and a link that opens it with their number.
   * One command once (commandId), version-checked against the client's access, audited.
   */
  inviteClient(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { caseId, canManage, canDemo } = await this.projectRole(client, workspaceId, projectId, user.userId);
      if (!canManage) throw new ForbiddenException("Only the project manager invites the client.");
      const command = this.command(body, { action: "invite_client", projectId });
      if (!(await this.replayed(client, workspaceId, command))) {
        const settings = await readPortalSettings(client, workspaceId);
        const access = await readProjectAccess(client, workspaceId, projectId);
        const facts = (await client.query<{ project: string; company: string; whatsapp: boolean }>(
          `SELECT project.name AS project, coalesce(branding.display_name, workspace.name) AS company,
                  EXISTS (SELECT 1 FROM integration_connections connection WHERE connection.workspace_id = workspace.id AND connection.provider = 'whatsapp'
                           AND connection.status = 'connected') AS whatsapp
             FROM delivery_projects project JOIN workspaces workspace ON workspace.id = project.workspace_id
             LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id
            WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
        const address = await portalUrl(client, this.config, workspaceId, settings.slug);
        const result = await inviteClient(client, {
          workspaceId, projectId, caseId, userId: user.userId, settings, access, version: command.version,
          send: async ({ to, name, phone, token, expiresAt }) => {
            const link = new URL(address);
            link.searchParams.set("invite", token);
            const outcome = await this.mailer.sendPortalInvitation({ workspaceId, to, recipientName: name, projectName: facts.project, company: facts.company, portalUrl: address,
              inviteUrl: link.toString(), phoneHint: phone.slice(-2), channel: facts.whatsapp && !this.demo ? "whatsapp" : "email", expiresAt });
            return (outcome.status === "sent" ? "sent" : outcome.suppressedReason ? "suppressed" : outcome.status) satisfies InviteDelivery;
          },
        });
        await this.remember(client, workspaceId, command, result.grantId, "invite_client", { invitationId: result.invitationId, delivery: result.delivery });
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "client_portal.client_invited", entityType: "project", entityId: projectId,
          after: { grantId: result.grantId, invitationId: result.invitationId, email: result.email, delivery: result.delivery, reused: result.reused, commandId: command.id } });
      }
      return this.readProject(client, workspaceId, projectId, caseId, true, canDemo);
    });
  }

  /** Takes the client's portal access away for this project's case: no sign-in, sessions ended, invitation links dead. */
  revokeClient(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { caseId, canManage, canDemo } = await this.projectRole(client, workspaceId, projectId, user.userId);
      if (!canManage) throw new ForbiddenException("Only the project manager changes the client's access.");
      const command = this.command(body, { action: "revoke_client", projectId });
      if (!(await this.replayed(client, workspaceId, command))) {
        const settings = await readPortalSettings(client, workspaceId);
        const access = await readProjectAccess(client, workspaceId, projectId);
        const current = await readClientAccess(client, { workspaceId, projectId, caseId, settings, access });
        if (current.grantId && await this.namedOnIssuedQuote(client, workspaceId, caseId, current.grantId))
          throw new ConflictException("This client decides an issued quotation. Withdraw it before taking their access away.");
        const result = await revokeClient(client, { workspaceId, projectId, caseId, userId: user.userId, settings, access, version: command.version });
        await this.remember(client, workspaceId, command, result.grantId, "revoke_client", { ended: result.ended, changed: result.changed });
        if (result.changed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "client_portal.client_revoked", entityType: "project", entityId: projectId,
          after: { grantId: result.grantId, sessions: result.ended, commandId: command.id } });
      }
      return this.readProject(client, workspaceId, projectId, caseId, true, canDemo);
    });
  }

  /**
   * Sets or clears one contact's demonstration sign-in code (a workspace admin only): six digits, stored as a
   * hash bound to the contact; the same code again changes nothing. One command once (commandId), version-
   * checked against the contact, audited. A contact with a demonstration code is sent no code at all.
   */
  demoCode(actor: RequestActor, workspaceId: string, caseId: string, contactId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "portal.manage", async (client, user) => {
      const id = this.caseId(caseId);
      const code = body.code === null || body.code === undefined || body.code === "" ? null : demoCodeInput(body.code);
      const command = this.command(body, { action: "demo_code", contactId, code: code === null ? null : this.codes.demoHash(contactId, code) });
      if (!(await this.replayed(client, workspaceId, command))) {
        const contact = (await client.query<{ version: number }>(
          `SELECT version FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, id, UUID.test(contactId) ? contactId : null])).rows[0];
        if (!contact) throw new NotFoundException("Contact not found.");
        if (command.version !== contact.version) throw new ConflictException("Someone else changed this contact. Reload to see their change.");
        const result = (await setDemoCode(client, workspaceId, this.codes, { grantId: contactId, code, userId: user.userId }))!;
        await this.remember(client, workspaceId, command, contactId, "demo_code", { changed: result.changed, demo: result.demo, ended: result.ended });
        if (result.changed) await recordAudit(client, { workspaceId, actorUserId: user.userId, action: code ? "client_portal.demo_code_set" : "client_portal.demo_code_cleared",
          entityType: "pre_project_case", entityId: id, after: { contactId, sessions: result.ended, commandId: command.id } });
      }
      return { contacts: await this.readContacts(client, workspaceId, id), canManage: true, demo: this.demo };
    });
  }

  /** A staff command on the client's access: its id (for a safe retry), the version it saw, and a hash of what it asked. */
  private command(body: Record<string, unknown>, expected: Record<string, unknown>): Command {
    if (typeof body.commandId !== "string" || !UUID.test(body.commandId)) throw new BadRequestException("Try that again.");
    if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 0) throw new BadRequestException("Reload and try again.");
    return { id: body.commandId, version: body.version, hash: canonicalHash({ ...expected, version: body.version }) };
  }

  /** A retry of the same command changes nothing; the same id with different details is refused. */
  private async replayed(client: PoolClient, workspaceId: string, command: Command) {
    const prior = (await client.query<{ requestHash: string }>(`SELECT request_hash AS "requestHash" FROM client_portal_commands WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, command.id])).rows[0];
    if (prior && prior.requestHash !== command.hash) throw new ConflictException("This was already sent with different details. Reload and try again.");
    return Boolean(prior);
  }

  private remember(client: PoolClient, workspaceId: string, command: Command, grantId: string, action: string, result: Record<string, unknown>) {
    return client.query(`INSERT INTO client_portal_commands (workspace_id, id, grant_id, action, request_hash, result) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [workspaceId, command.id, grantId, action, command.hash, JSON.stringify(result)]);
  }

  private async projectRole(client: PoolClient, workspaceId: string, projectId: string, userId: string) {
    if (!UUID.test(projectId)) throw new NotFoundException("Project not found.");
    const project = (await client.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
    if (!project) throw new NotFoundException("Project not found.");
    const all = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
    const portal = await this.access.hasPermission(client, workspaceId, userId, "portal.manage");
    const assignment = (await client.query<{ lead: boolean }>(
      `SELECT assignment.is_manager AS lead FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND membership.user_id = $3 AND assignment.active`, [workspaceId, projectId, userId])).rows[0];
    if (!all && !portal && !assignment) throw new NotFoundException("Project not found.");
    return { caseId: project.caseId, canManage: all || portal || Boolean(assignment?.lead), canDemo: portal };
  }

  contacts(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["portal.manage", "pre_projects.view"], async (client, user) => ({
      contacts: await this.readContacts(client, workspaceId, this.caseId(caseId)),
      canManage: await this.access.hasPermission(client, workspaceId, user.userId, "portal.manage"), demo: this.demo,
    }));
  }

  /**
   * Adds or changes a client contact (name, mobile, email, decision-maker or viewer, active). Any change to
   * how they sign in or what they may do ends their sessions; the named decision-maker of an issued
   * quotation keeps that role until the quotation is withdrawn.
   */
  saveContact(actor: RequestActor, workspaceId: string, caseId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "portal.manage", async (client, user) => {
      const id = this.caseId(caseId);
      await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id]);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 160) throw new BadRequestException("Enter the client's name.");
      const phone = mobileNumber(body.phone);
      const email = optionalEmail(body.email, "Email") || null;
      const role = body.role === "approver" ? "approver" : "viewer";
      const active = body.active !== false;
      const testContact = this.demo && body.testContact === true;
      const existing = typeof body.id === "string" ? (await client.query<Contact>(
        `SELECT id, phone, role, active, version FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`, [workspaceId, id, body.id])).rows[0] : undefined;
      if (typeof body.id === "string" && !existing) throw new NotFoundException("Contact not found.");
      const duplicate = (await client.query<{ id: string }>(`SELECT id FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND phone = $3`, [workspaceId, id, phone])).rows[0];
      if (duplicate && duplicate.id !== existing?.id) throw new ConflictException("This mobile number is already a contact on this project.");
      let contactId = existing?.id ?? randomUUID();
      if (existing) {
        if (body.version !== existing.version) throw new ConflictException("Someone else changed this contact. Reload to see their change.");
        if (existing.role === "approver" && (role !== "approver" || !active) && await this.namedOnIssuedQuote(client, workspaceId, id, existing.id))
          throw new ConflictException("This contact decides an issued quotation. Withdraw it before changing their access.");
        await client.query(
          `UPDATE client_portal_grants SET name = $4, phone = $5, email = $6, role = $7, active = $8, test_contact = $9, version = version + 1, updated_at = now()
            WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, id, existing.id, name, phone, email, role, active, testContact]);
        if (existing.phone !== phone || existing.role !== role || existing.active !== active) await endSessions(client, workspaceId, existing.phone, "access_changed");
      } else {
        contactId = (await client.query<{ id: string }>(
          `INSERT INTO client_portal_grants (id, workspace_id, case_id, name, phone, email, role, active, test_contact) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [contactId, workspaceId, id, name, phone, email, role, active, testContact])).rows[0].id;
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: existing ? "client_portal.contact_changed" : "client_portal.contact_added", entityType: "pre_project_case",
        entityId: id, before: existing ?? null, after: { contactId, name, phone, email, role, active } });
      return { contacts: await this.readContacts(client, workspaceId, id), canManage: true, demo: this.demo };
    });
  }

  /** Signs a contact out everywhere (a lost phone, or someone who shouldn't be in any more). */
  signOutContact(actor: RequestActor, workspaceId: string, caseId: string, contactId: string) {
    return this.access.withPermission(actor, workspaceId, "portal.manage", async (client, user) => {
      const id = this.caseId(caseId);
      const contact = (await client.query<{ phone: string }>(`SELECT phone FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND id = $3`,
        [workspaceId, id, UUID.test(contactId) ? contactId : null])).rows[0];
      if (!contact) throw new NotFoundException("Contact not found.");
      const ended = await endSessions(client, workspaceId, contact.phone, "staff_signed_out");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "client_portal.contact_signed_out", entityType: "pre_project_case", entityId: id,
        after: { contactId, sessions: ended } });
      return { contacts: await this.readContacts(client, workspaceId, id), canManage: true, demo: this.demo, ended };
    });
  }

  private caseId(value: string) {
    if (!UUID.test(value)) throw new NotFoundException("Project not found.");
    return value;
  }

  private async namedOnIssuedQuote(client: PoolClient, workspaceId: string, caseId: string, grantId: string) {
    const data = (await commercialRepository.load(client, workspaceId, caseId))?.content as CommercialData | undefined;
    return Boolean(data?.quotes?.some((quote) => quote.status === "issued" && quote.approverId === grantId));
  }

  private async readContacts(client: PoolClient, workspaceId: string, caseId: string) {
    return (await client.query<Contact & { signedIn: boolean }>(
      `SELECT grant_row.id, grant_row.name, grant_row.confirmed_name AS "confirmedName", grant_row.phone, grant_row.email, grant_row.role, grant_row.active,
              grant_row.test_contact AS "testContact", grant_row.demo_code_hash IS NOT NULL AS "demoCode", grant_row.last_signed_in_at AS "lastSignedInAt", grant_row.version,
              EXISTS (SELECT 1 FROM client_portal_sessions session WHERE session.workspace_id = grant_row.workspace_id AND session.phone = grant_row.phone
                        AND session.revoked_at IS NULL AND session.expires_at > now() AND session.last_seen_at > now() - interval '30 days') AS "signedIn"
         FROM client_portal_grants grant_row WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2 ORDER BY grant_row.created_at`, [workspaceId, caseId])).rows;
  }
}
