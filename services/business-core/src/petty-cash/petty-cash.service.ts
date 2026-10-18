import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { membershipOf, readProject } from "../project-core/project-core.store";
import { currencyDecimals } from "../purchasing/orders";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { CATEGORIES, readClaims, type ClaimRow } from "./petty-cash";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const ACTIONS = ["save", "submit", "approve", "reject"] as const;
const OPEN = ["active", "on_hold"];
type Notice = { code: string; users: string[]; note: string; link: "project" | "finance" };

/**
 * Petty cash: what someone on a project's team spent for it — the day, the amount in the workspace's
 * currency, what for, a receipt (or why there's none) and optionally the package. The project's manager
 * (or anyone who manages projects) approves or rejects it with why, never their own; approved, it's a cost
 * of the project, and the people who pay suppliers reimburse it. Every command runs once by its id.
 */
@Injectable()
export class PettyCashService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  state(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => this.read(client, workspaceId, projectId, user.userId));
  }

  command(actor: RequestActor, workspaceId: string, projectId: string, body: Record<string, unknown>) {
    const action = body.action as (typeof ACTIONS)[number];
    if (!ACTIONS.includes(action)) throw new BadRequestException("Unknown action.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const who = await this.who(client, workspaceId, projectId, user.userId);
      const commandId = uuid(body.commandId, "Command");
      const claimId = uuid(action === "save" ? body.id : body.claimId, "Claim");
      if (!(await this.firstTime(client, workspaceId, commandId, claimId, action, user.userId))) return this.read(client, workspaceId, projectId, user.userId);
      const notices: Notice[] = [];
      let audit: Record<string, unknown>;
      if (action === "save") audit = await this.save(client, workspaceId, who, claimId, body, user.userId);
      else {
        const claim = await this.lock(client, workspaceId, projectId, claimId, body.version);
        if (action === "submit") audit = await this.submit(client, workspaceId, who, claim, user.userId, notices);
        else audit = await this.decide(client, workspaceId, who, claim, action, body, user.userId, notices);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `petty_cash.${action}`, entityType: "petty_cash_claim", entityId: claimId, after: audit });
      await this.tell(client, workspaceId, claimId, notices, user.userId);
      return this.read(client, workspaceId, projectId, user.userId);
    });
  }

  /** The claim's receipt (a photo or PDF), while its claimant still has it as a draft; the same file again changes nothing. */
  async uploadReceipt(actor: RequestActor, workspaceId: string, projectId: string, claimId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/") && prepared.mimeType !== "application/pdf") throw new BadRequestException("Choose a PDF or a photo.");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      await this.who(client, workspaceId, projectId, user.userId);
      const claim = (await client.query<{ status: string; claimedBy: string; sha: string | null }>(
        `SELECT status, claimed_by AS "claimedBy", receipt_sha256 AS sha FROM petty_cash_claims WHERE workspace_id = $1 AND id = $2 AND project_id = $3 FOR UPDATE`,
        [workspaceId, uuid(claimId, "Claim"), projectId])).rows[0];
      if (!claim) throw new NotFoundException("Claim not found.");
      if (claim.sha === prepared.digest) return this.read(client, workspaceId, projectId, user.userId);
      if (claim.claimedBy !== user.userId) throw new ForbiddenException("Only who claimed it adds its receipt.");
      if (claim.status !== "draft") throw new ConflictException("A submitted claim doesn't change.");
      const key = `petty-cash/${workspaceId}/${claimId}/${prepared.digest}`;
      await storage.put(key, prepared.body, prepared.mimeType);
      await client.query(`UPDATE petty_cash_claims SET receipt_name = $3, receipt_type = $4, receipt_key = $5, receipt_sha256 = $6, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, claimId, prepared.name.slice(0, 255), prepared.mimeType, key, prepared.digest]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "petty_cash.receipt", entityType: "petty_cash_claim", entityId: claimId,
        after: { name: prepared.name, sha256: prepared.digest } });
      return this.read(client, workspaceId, projectId, user.userId);
    });
  }

  /** A receipt, for who claimed it, whoever decides the project's claims, and the people who pay. */
  receipt(actor: RequestActor, workspaceId: string, claimId: string) {
    return this.access.asMember(actor, workspaceId, async (client, user) => {
      const row = (await client.query<{ projectId: string; claimedBy: string; key: string | null; type: string | null }>(
        `SELECT project_id AS "projectId", claimed_by AS "claimedBy", receipt_key AS key, receipt_type AS type FROM petty_cash_claims WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, uuid(claimId, "Claim")])).rows[0];
      if (!row?.key || !row.type || !this.storage) throw new NotFoundException("Receipt not found.");
      const allowed = row.claimedBy === user.userId || await this.access.hasPermission(client, workspaceId, user.userId, "payables.view")
        || (await this.who(client, workspaceId, row.projectId, user.userId).catch(() => null))?.manager;
      if (!allowed) throw new NotFoundException("Receipt not found.");
      const stored = await this.storage.read(row.key).catch(() => null);
      if (!stored) throw new NotFoundException("Receipt not found.");
      return { body: stored.body, contentType: row.type };
    });
  }

  /** For the people who pay: approved claims to reimburse, and those reimbursed, across projects. */
  reimbursements(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client, user) => this.payables(client, workspaceId, user.userId));
  }

  /** An approved claim paid back to who claimed it, with the payment's reference; runs once by its id. */
  reimburse(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      const commandId = uuid(body.commandId, "Command");
      const claimId = uuid(body.claimId, "Claim");
      if (!(await this.firstTime(client, workspaceId, commandId, claimId, "reimburse", user.userId))) return this.payables(client, workspaceId, user.userId);
      const claim = await this.lock(client, workspaceId, null, claimId, body.version);
      if (claim.status === "reimbursed") throw new ConflictException("This claim is already reimbursed.");
      if (claim.status !== "approved") throw new ConflictException("Only an approved claim is reimbursed.");
      const reference = text(body.reference, 120, "Reference");
      await client.query(`UPDATE petty_cash_claims SET status = 'reimbursed', reimbursed_by = $3, reimbursed_at = now(), reimbursement_reference = $4, version = version + 1
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, claimId, user.userId, reference]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "petty_cash.reimburse", entityType: "petty_cash_claim", entityId: claimId, after: { reference } });
      await this.tell(client, workspaceId, claimId, [{ code: "petty_cash.reimbursed", users: [claim.claimedBy], note: reference, link: "project" }], user.userId);
      return this.payables(client, workspaceId, user.userId);
    });
  }

  // ---------- commands ----------

  /** A new claim, or its claimant's changes to a draft. Numbered PC-n per workspace. */
  private async save(client: Db, workspaceId: string, who: Awaited<ReturnType<PettyCashService["who"]>>, id: string, body: Record<string, unknown>, userId: string) {
    if (!who.onTeam) throw new ForbiddenException("Only the project's team claims petty cash for it.");
    if (!OPEN.includes(who.project.status)) throw new ConflictException("The project is closed.");
    const existing = (await client.query<{ projectId: string; claimedBy: string; status: string; version: number }>(
      `SELECT project_id AS "projectId", claimed_by AS "claimedBy", status, version FROM petty_cash_claims WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
    if (existing) {
      if (existing.projectId !== who.project.id) throw new NotFoundException("Claim not found.");
      if (existing.claimedBy !== userId) throw new ForbiddenException("Only who claimed it changes a claim.");
      if (existing.status !== "draft") throw new ConflictException("A submitted claim doesn't change.");
      if (body.version !== existing.version) throw new ConflictException("This claim changed elsewhere. Reload to see it.");
    }
    const currency = (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency;
    const spentOn = date(body.spentOn, "Date spent");
    if (spentOn > (await this.today(client, workspaceId))) throw new BadRequestException("Claim petty cash once it's spent.");
    const amount = money(body.amount, "Amount", currency);
    if (Dec.of(amount).cmp(0) <= 0) throw new BadRequestException("Enter what was spent.");
    const description = text(body.description, 500, "What it was for");
    if (!description) throw new BadRequestException("Say what it was for.");
    const category = body.category as (typeof CATEGORIES)[number];
    if (!CATEGORIES.includes(category)) throw new BadRequestException("Choose what kind of spending it was.");
    const packageId = body.packageId === null || body.packageId === undefined || body.packageId === "" ? null : uuid(body.packageId, "Package");
    if (packageId && !(await client.query(`SELECT 1 FROM project_packages WHERE workspace_id = $1 AND project_id = $2 AND id = $3`, [workspaceId, who.project.id, packageId])).rowCount)
      throw new BadRequestException("Choose a package of this project.");
    const noReceiptReason = text(body.noReceiptReason, 300, "Why there's no receipt");
    const values = [workspaceId, id, packageId, spentOn, amount, currency, description, category, noReceiptReason];
    if (existing) {
      await client.query(`UPDATE petty_cash_claims SET package_id = $3, spent_on = $4, amount = $5, currency = $6, description = $7, category = $8, no_receipt_reason = $9,
        version = version + 1 WHERE workspace_id = $1 AND id = $2`, values);
    } else {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('petty-cash-number:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM petty_cash_claims WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      await client.query(`INSERT INTO petty_cash_claims (workspace_id, id, package_id, spent_on, amount, currency, description, category, no_receipt_reason, number, project_id, claimed_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [...values, number, who.project.id, userId]);
    }
    return { projectId: who.project.id, packageId, spentOn, amount, currency, description, category, noReceiptReason, created: !existing };
  }

  /** Its claimant sends a draft for approval, with its receipt or why there's none; the project's managers hear. */
  private async submit(client: Db, workspaceId: string, who: Awaited<ReturnType<PettyCashService["who"]>>, claim: ClaimRow, userId: string, notices: Notice[]) {
    if (claim.claimedBy !== userId) throw new ForbiddenException("Only who claimed it submits a claim.");
    if (!OPEN.includes(who.project.status)) throw new ConflictException("The project is closed.");
    if (claim.status !== "draft") throw new ConflictException("This claim is already submitted.");
    if (!claim.receiptName && !claim.noReceiptReason) throw new ConflictException("Attach the receipt, or say why there's none.");
    await client.query(`UPDATE petty_cash_claims SET status = 'submitted', submitted_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, claim.id]);
    // The project's managers decide; with none named, whoever manages projects.
    let approvers = (await this.managers(client, workspaceId, claim.projectId)).filter((person) => person !== userId);
    if (!approvers.length) approvers = (await this.holders(client, workspaceId, "projects.manage")).filter((person) => person !== userId);
    notices.push({ code: "petty_cash.submitted", users: approvers, note: claim.description, link: "project" });
    return { status: "submitted" };
  }

  /** Approved (a cost of the project, to reimburse) or rejected with why, by someone other than who claimed it. */
  private async decide(client: Db, workspaceId: string, who: Awaited<ReturnType<PettyCashService["who"]>>, claim: ClaimRow, action: "approve" | "reject",
    body: Record<string, unknown>, userId: string, notices: Notice[]) {
    if (!who.manager) throw new ForbiddenException("Only the project manager approves petty cash.");
    if (claim.claimedBy === userId) throw new ForbiddenException("Someone other than who claimed it decides.");
    if (claim.status !== "submitted") throw new ConflictException("Only a submitted claim is approved or rejected.");
    const note = text(body.note, 500, "Note");
    if (action === "reject" && !note) throw new BadRequestException("Say why it's rejected.");
    await client.query(`UPDATE petty_cash_claims SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, claim.id, action === "approve" ? "approved" : "rejected", userId, note]);
    if (action === "approve") {
      notices.push({ code: "petty_cash.approved", users: [claim.claimedBy], note, link: "project" });
      notices.push({ code: "petty_cash.to_reimburse", users: await this.holders(client, workspaceId, "payables.manage"), note: claim.claimedByName, link: "finance" });
    } else notices.push({ code: "petty_cash.rejected", users: [claim.claimedBy], note, link: "project" });
    return { status: action === "approve" ? "approved" : "rejected", note };
  }

  // ---------- reads ----------

  private async read(client: Db, workspaceId: string, projectId: string, userId: string) {
    const who = await this.who(client, workspaceId, projectId, userId);
    return {
      // Whoever decides sees every claim on the project; everyone else, their own.
      claims: await readClaims(client, workspaceId, { projectId, claimedBy: who.manager ? undefined : userId }),
      packages: (await client.query<{ id: string; name: string }>(`SELECT id, name FROM project_packages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position, name`,
        [workspaceId, projectId])).rows,
      currency: (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency,
      today: await this.today(client, workspaceId),
      me: userId, canClaim: who.onTeam && OPEN.includes(who.project.status), canApprove: who.manager,
    };
  }

  private async payables(client: Db, workspaceId: string, userId: string) {
    return {
      // Every claim still to reimburse, however old, and the latest reimbursed ones.
      claims: [...await readClaims(client, workspaceId, { statuses: ["approved"] }), ...await readClaims(client, workspaceId, { statuses: ["reimbursed"] })],
      canReimburse: await this.access.hasPermission(client, workspaceId, userId, "payables.manage"),
    };
  }

  // ---------- helpers ----------

  /** Who this person is on the project: on its team (claims), its manager (decides). */
  private async who(client: Db, workspaceId: string, projectId: string, userId: string) {
    const project = await readProject(client, workspaceId, projectId);
    if (!project) throw new NotFoundException("Project not found.");
    const all = await this.access.hasPermission(client, workspaceId, userId, "projects.manage");
    if (!all && !(await this.access.hasPermission(client, workspaceId, userId, "projects.view"))) throw new ForbiddenException("You don't have access to projects.");
    const membershipId = await membershipOf(client, workspaceId, userId);
    const assignment = (await client.query<{ lead: boolean }>(
      `SELECT is_manager AS lead FROM project_assignments WHERE workspace_id = $1 AND project_id = $2 AND membership_id = $3 AND active`, [workspaceId, projectId, membershipId])).rows[0];
    if (!all && !assignment) throw new NotFoundException("Project not found.");
    return { project, onTeam: all || Boolean(assignment), manager: all || Boolean(assignment?.lead) };
  }

  /** The claim, locked and version-checked (and on this project, when one is given). */
  private async lock(client: Db, workspaceId: string, projectId: string | null, claimId: string, version: unknown) {
    await client.query(`SELECT 1 FROM petty_cash_claims WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, claimId]);
    const claim = (await readClaims(client, workspaceId, { id: claimId }))[0];
    if (!claim || (projectId && claim.projectId !== projectId)) throw new NotFoundException("Claim not found.");
    if (version !== claim.version) throw new ConflictException("This claim changed elsewhere. Reload to see it.");
    return claim;
  }

  private async firstTime(client: Db, workspaceId: string, commandId: string, entityId: string, action: string, actorId: string) {
    return Boolean((await client.query(
      `INSERT INTO petty_cash_commands (workspace_id, id, entity_id, action, actor_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, id) DO NOTHING`,
      [workspaceId, commandId, entityId, action, actorId])).rowCount);
  }

  private async managers(client: Db, workspaceId: string, projectId: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, projectId])).rows.map((row) => row.userId);
  }

  private async holders(client: Db, workspaceId: string, code: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, code])).rows.map((row) => row.userId);
  }

  /** Each notice to its people (never the one acting), once per claim and event. */
  private async tell(client: Db, workspaceId: string, claimId: string, notices: Notice[], actorId: string) {
    if (!notices.length) return;
    const claim = (await readClaims(client, workspaceId, { id: claimId }))[0];
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "";
    const variables = { claim: claim.reference, project: `${claim.projectReference} · ${claim.projectName}`, actor,
      amount: `${claim.currency} ${Dec.of(claim.amount).toFixed(currencyDecimals(claim.currency))}` };
    for (const notice of notices)
      for (const userId of new Set(notice.users.filter((id) => id !== actorId)))
        await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code: notice.code, eventType: notice.code, variables: { ...variables, note: notice.note.slice(0, 480) },
          deepLink: notice.link === "finance" ? `/workspace/finance/petty-cash?claim=${claimId}` : `/workspace/projects/${claim.projectId}/money?view=petty-cash&claim=${claimId}`,
          idempotencyKey: `${notice.code}:${claimId}:${userId}` });
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  }
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}

/** An amount of money in the currency's own minor units (no more decimals than it uses). */
function money(value: unknown, label: string, currency: string) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(raw)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  if (Dec.of(raw).round(currencyDecimals(currency)).cmp(raw) !== 0) throw new BadRequestException(`${label} has more decimals than ${currency} uses.`);
  return raw;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
