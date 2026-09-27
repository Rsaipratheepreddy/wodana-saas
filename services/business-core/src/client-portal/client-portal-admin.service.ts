import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { endSessions, mobileNumber } from "./portal-auth";
import { optionalEmail, readPortalSettings, readProjectAccess, savePortalSettings, saveProjectAccess, SECTIONS } from "./portal-settings";
import { readSite } from "./portal-site";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Contact = { id: string; name: string; confirmedName: string | null; phone: string; email: string | null; role: "approver" | "viewer"; active: boolean; testContact: boolean;
  lastSignedInAt: string | null; version: number };

/**
 * The firm's side of the client portal: what clients see (Settings → Client portal), each project's own
 * choice and pause, and the client contacts who can sign in.
 */
@Injectable()
export class ClientPortalAdminService {
  constructor(private readonly access: WorkspaceAccessService, private readonly config: ConfigService) {}

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
      const { caseId, canManage } = await this.projectRole(client, workspaceId, projectId, user.userId);
      return this.readProject(client, workspaceId, projectId, caseId, canManage);
    });
  }

  saveProject(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const { caseId, canManage } = await this.projectRole(client, workspaceId, projectId, user.userId);
      if (!canManage) throw new ForbiddenException("Only the project manager changes what the client sees.");
      const { before, after } = await saveProjectAccess(client, workspaceId, projectId, user.userId, body);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: after.paused && !before.paused ? "client_portal.project_paused"
        : !after.paused && before.paused ? "client_portal.project_resumed" : "client_portal.project_sections", entityType: "project", entityId: projectId, before, after });
      return this.readProject(client, workspaceId, projectId, caseId, true);
    });
  }

  private async readProject(client: PoolClient, workspaceId: string, projectId: string, caseId: string, canManage: boolean) {
    const settings = await readPortalSettings(client, workspaceId);
    return {
      enabled: settings.enabled, sections: SECTIONS.filter((section) => settings.sections[section]), access: await readProjectAccess(client, workspaceId, projectId),
      contacts: await this.readContacts(client, workspaceId, caseId), caseId, canManage,
    };
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
    return { caseId: project.caseId, canManage: all || portal || Boolean(assignment?.lead) };
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
              grant_row.test_contact AS "testContact", grant_row.last_signed_in_at AS "lastSignedInAt", grant_row.version,
              EXISTS (SELECT 1 FROM client_portal_sessions session WHERE session.workspace_id = grant_row.workspace_id AND session.phone = grant_row.phone
                        AND session.revoked_at IS NULL AND session.expires_at > now() AND session.last_seen_at > now() - interval '30 days') AS "signedIn"
         FROM client_portal_grants grant_row WHERE grant_row.workspace_id = $1 AND grant_row.case_id = $2 ORDER BY grant_row.created_at`, [workspaceId, caseId])).rows;
  }
}
