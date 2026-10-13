import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { RequestActor } from "../../auth/actor";
import { notifyUserInApp, queueUserEmail } from "../../notifications/default-templates";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import { closingSchedule } from "../conversations/inbox/closing-messages";
import { endOfWorkingDayAt } from "../leads/sla-schedule";
import { CrmEventsService } from "../shared/crm-events.service";

type Db = Pick<PoolClient, "query">;

const CHECK_COLUMNS = `check_row.id, check_row.opportunity_id AS "opportunityId", check_row.question, check_row.status, check_row.answer,
  check_row.due_at AS "dueAt", check_row.answered_at AS "answeredAt", check_row.created_at AS "createdAt", check_row.version, check_row.team_code AS "teamCode",
  check_row.assignee_membership_id AS "assigneeMembershipId", check_row.asker_membership_id AS "askerMembershipId",
  (SELECT coalesce(nullif(btrim(account.display_name), ''), account.primary_email) FROM workspace_memberships member JOIN users account ON account.id = member.user_id
    WHERE member.workspace_id = check_row.workspace_id AND member.id = check_row.assignee_membership_id) AS "assigneeName",
  (SELECT coalesce(nullif(btrim(account.display_name), ''), account.primary_email) FROM workspace_memberships member JOIN users account ON account.id = member.user_id
    WHERE member.workspace_id = check_row.workspace_id AND member.id = check_row.asker_membership_id) AS "askerName",
  (SELECT coalesce(nullif(btrim(account.display_name), ''), account.primary_email) FROM users account WHERE account.id = check_row.answered_by) AS "answeredByName"`;

/** A team or role code as configured or held: lower case, without the "team_" a team's role carries. */
const codeKey = (code: string) => code.trim().toLowerCase().replace(/^team_/, "");

/**
 * Timeline checks (PLM-155): Sales collect the client's target date but don't promise design or production timelines.
 * The Account Manager asks one person from the teams the firm chose (Settings › Sales; the designers and Production at
 * Palm) a timeline question on the opportunity; it is due at the end of the working day (the reminder engine chases it,
 * kind crm.timeline_check); the answer is kept on the opportunity and the Account Manager is told to reply to the client.
 * One task with an owner and a due time, on the opportunity's line: open → answered, or cancelled. Every command is
 * version-checked (or, to ask, idempotent by request id) and audited on the opportunity's history.
 */
@Injectable()
export class TimelineChecksService {
  constructor(private readonly access: WorkspaceAccessService, private readonly events: CrmEventsService) {}

  /** The opportunity's checks, the people who can be asked, and the client's target date (from the enquiry). */
  list(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.view", async (client, actorUser) => {
      const opportunity = await this.opportunity(client, workspaceId, opportunityId);
      const checks = (await client.query(`SELECT ${CHECK_COLUMNS} FROM crm_timeline_checks check_row WHERE check_row.workspace_id = $1 AND check_row.opportunity_id = $2
        ORDER BY (check_row.status = 'open') DESC, check_row.created_at DESC LIMIT 50`, [workspaceId, opportunityId])).rows;
      const me = await this.membership(client, workspaceId, actorUser.userId);
      const canManage = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.manage");
      return {
        opportunityId, targetCompletion: opportunity.targetCompletion, canAsk: canManage && opportunity.status === "open",
        people: canManage ? await askable(client, workspaceId) : [],
        checks: checks.map((row) => ({ ...row, canAnswer: row.status === "open" && (row.assigneeMembershipId === me || canManage), canCancel: row.status === "open" && canManage })),
      };
    });
  }

  /** Asks one person a timeline question, due by the end of the working day; they are told in the app and by email. */
  ask(actor: RequestActor, workspaceId: string, opportunityId: string, input: { requestId: string; assigneeMembershipId: string; question: string }) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, actorUser) => {
      const question = input.question.trim().replace(/[ \t]+\n/g, "\n");
      if (!question) throw new UnprocessableEntityException("Write the question");
      const replay = (await client.query<{ id: string; opportunityId: string; question: string; assignee: string }>(
        `SELECT id, opportunity_id AS "opportunityId", question, assignee_membership_id AS assignee FROM crm_timeline_checks WHERE workspace_id = $1 AND request_id = $2`,
        [workspaceId, input.requestId])).rows[0];
      if (replay) {
        if (replay.opportunityId !== opportunityId || replay.question !== question || replay.assignee !== input.assigneeMembershipId) throw new ConflictException("This request was already sent with a different question");
        return this.readOne(client, workspaceId, replay.id);
      }
      const opportunity = await this.opportunity(client, workspaceId, opportunityId, true);
      if (opportunity.status !== "open") throw new ConflictException("This opportunity is closed. Reopen it before asking about timelines.");
      const people = await askable(client, workspaceId);
      if (!people.length) throw new UnprocessableEntityException("Nobody is in the teams that answer timeline questions. Add them in Settings › Sales.");
      const person = people.find((entry) => entry.membershipId === input.assigneeMembershipId);
      if (!person) throw new UnprocessableEntityException("Choose someone from the teams that answer timeline questions");
      const asker = await this.membership(client, workspaceId, actorUser.userId);
      const now = new Date();
      const dueAt = endOfWorkingDayAt(now, await closingSchedule(client, workspaceId));
      const id = randomUUID();
      await client.query(
        `INSERT INTO crm_timeline_checks (id, workspace_id, opportunity_id, question, asker_membership_id, assignee_membership_id, team_code, due_at, request_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, workspaceId, opportunityId, question, asker, person.membershipId, person.teams[0]?.code ?? null, dueAt, input.requestId, actorUser.userId]);
      await this.events.record(client as PoolClient, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.timeline_check_raised.v1", entityType: "crm_opportunity", entityId: opportunityId,
        after: { opportunityId, checkId: id, assigneeMembershipId: person.membershipId, assignee: person.name, dueAt: dueAt.toISOString(), note: question } });
      if (person.userId !== actorUser.userId) {
        const variables = { client: opportunity.client, actor: await this.name(client, actorUser.userId), question, due: await this.dueText(client, workspaceId, dueAt), opportunity: opportunity.label };
        const deepLink = `/workspace/crm/timeline-checks/${id}`;
        await notifyUserInApp(client, { workspaceId, recipientUserId: person.userId, code: "crm.timeline_question", eventType: "crm.timeline_question", variables, deepLink, idempotencyKey: `crm:timeline:asked:${id}` });
        await queueUserEmail(client, { workspaceId, recipientUserId: person.userId, code: "crm.timeline_question", eventType: "crm.timeline_question", variables, deepLink, idempotencyKey: `crm:timeline:asked:${id}:email` });
      }
      return this.readOne(client, workspaceId, id);
    });
  }

  /** One check for the person asked (who may not open opportunities), or anyone who can see the opportunity. */
  get(actor: RequestActor, workspaceId: string, checkId: string) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const row = await this.readOne(client, workspaceId, checkId);
      const me = await this.membership(client, workspaceId, actorUser.userId);
      const canView = row.assigneeMembershipId === me || row.askerMembershipId === me || await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.view");
      if (!canView) throw new NotFoundException("Timeline question not found");
      const canManage = await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.manage");
      const opportunity = await this.opportunity(client, workspaceId, String(row.opportunityId));
      return { ...row, canAnswer: row.status === "open" && (row.assigneeMembershipId === me || canManage),
        opportunity: { id: opportunity.id, reference: opportunity.reference, title: opportunity.title, client: opportunity.client, targetCompletion: opportunity.targetCompletion,
          canOpen: await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.view") } };
    });
  }

  /**
   * Records the answer (the person asked, or someone who manages opportunities, e.g. after a call). The Account Manager
   * is told to reply to the client. Version-checked: two people answering at once, the second is refused.
   */
  answer(actor: RequestActor, workspaceId: string, checkId: string, input: { version: number; answer: string }) {
    return this.access.asMember(actor, workspaceId, async (client, actorUser) => {
      const answer = input.answer.trim();
      if (!answer) throw new UnprocessableEntityException("Write the answer");
      const before = await this.readOne(client, workspaceId, checkId, true);
      const me = await this.membership(client, workspaceId, actorUser.userId);
      if (before.assigneeMembershipId !== me && !(await this.access.hasPermission(client, workspaceId, actorUser.userId, "crm.opportunities.manage")))
        throw new ForbiddenException("Only the person asked, or someone who manages opportunities, can answer");
      if (before.status === "answered" && before.answer === answer) return before;
      if (before.status !== "open") throw new ConflictException(before.status === "answered" ? `${before.answeredByName ?? "Someone"} already answered this question` : "This question was cancelled");
      if (Number(before.version) !== input.version) throw new ConflictException("This question changed; reload and try again");
      await client.query(`UPDATE crm_timeline_checks SET status = 'answered', answer = $3, answered_by = $4, answered_at = now(), version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, checkId, answer, actorUser.userId]);
      const opportunity = await this.opportunity(client, workspaceId, String(before.opportunityId));
      await this.events.record(client as PoolClient, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.timeline_check_completed.v1", entityType: "crm_opportunity", entityId: opportunity.id,
        before: { checkId, status: "open" }, after: { opportunityId: opportunity.id, checkId, status: "answered", question: before.question, answer, note: answer } });
      const asker = before.askerMembershipId ? await this.userOf(client, workspaceId, String(before.askerMembershipId)) : null;
      if (asker && asker !== actorUser.userId) {
        const variables = { client: opportunity.client, actor: await this.name(client, actorUser.userId), answer, opportunity: opportunity.label };
        const deepLink = `/workspace/crm/opportunities?record=${opportunity.id}`;
        await notifyUserInApp(client, { workspaceId, recipientUserId: asker, code: "crm.timeline_answered", eventType: "crm.timeline_answered", variables, deepLink, idempotencyKey: `crm:timeline:answered:${checkId}` });
        await queueUserEmail(client, { workspaceId, recipientUserId: asker, code: "crm.timeline_answered", eventType: "crm.timeline_answered", variables, deepLink, idempotencyKey: `crm:timeline:answered:${checkId}:email` });
      }
      return this.readOne(client, workspaceId, checkId);
    });
  }

  /** Withdraws an open question (asked by mistake, or no longer needed); its reminders stop. */
  cancel(actor: RequestActor, workspaceId: string, checkId: string, input: { version: number }) {
    return this.access.withPermission(actor, workspaceId, "crm.opportunities.manage", async (client, actorUser) => {
      const before = await this.readOne(client, workspaceId, checkId, true);
      if (before.status === "cancelled") return before;
      if (before.status !== "open") throw new ConflictException("This question is already answered");
      if (Number(before.version) !== input.version) throw new ConflictException("This question changed; reload and try again");
      await client.query(`UPDATE crm_timeline_checks SET status = 'cancelled', version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, checkId]);
      await this.events.record(client as PoolClient, { workspaceId, actorUserId: actorUser.userId, source: "user", action: "crm.opportunity.timeline_check_cancelled.v1", entityType: "crm_opportunity", entityId: String(before.opportunityId),
        before: { checkId, status: "open" }, after: { opportunityId: before.opportunityId, checkId, status: "cancelled", note: before.question } });
      return this.readOne(client, workspaceId, checkId);
    });
  }

  private async readOne(client: Db, workspaceId: string, checkId: string, lock = false) {
    const row = (await client.query<Record<string, unknown>>(`SELECT ${CHECK_COLUMNS} FROM crm_timeline_checks check_row WHERE check_row.workspace_id = $1 AND check_row.id = $2${lock ? " FOR UPDATE" : ""}`,
      [workspaceId, checkId])).rows[0];
    if (!row) throw new NotFoundException("Timeline question not found");
    return row as Record<string, unknown> & { opportunityId: string; status: string; version: number; answer: string | null; question: string;
      assigneeMembershipId: string; askerMembershipId: string | null; answeredByName: string | null };
  }

  /** The opportunity with its client and the target date the client gave on the enquiry. */
  private async opportunity(client: Db, workspaceId: string, opportunityId: string, lock = false) {
    const row = (await client.query<{ id: string; status: string; reference: string; title: string; client: string; targetCompletion: string | null }>(
      `SELECT opportunity.id, opportunity.status, opportunity.reference, opportunity.title, coalesce(party.display_name, opportunity.title) AS client,
              nullif(enquiry.details->>'targetCompletion', '') AS "targetCompletion"
         FROM crm_opportunities opportunity
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
         LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
         LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2${lock ? " FOR UPDATE OF opportunity" : ""}`, [workspaceId, opportunityId])).rows[0];
    if (!row) throw new NotFoundException("Opportunity not found");
    return { ...row, label: [row.reference, row.title].filter(Boolean).join(" · ") };
  }

  private async membership(client: Db, workspaceId: string, userId: string) {
    return (await client.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId])).rows[0]?.id ?? null;
  }

  private async userOf(client: Db, workspaceId: string, membershipId: string) {
    return (await client.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, membershipId])).rows[0]?.userId ?? null;
  }

  private async name(client: Db, userId: string) {
    return (await client.query<{ name: string | null }>(`SELECT coalesce(nullif(btrim(display_name), ''), primary_email) AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "A teammate";
  }

  /** "Tue 14 Oct, 18:00" in the workspace's zone and locale. */
  private async dueText(client: Db, workspaceId: string, at: Date) {
    const row = (await client.query<{ locale: string | null; zone: string | null }>(`SELECT default_locale AS locale, default_timezone AS zone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
    try { return new Intl.DateTimeFormat(row?.locale || "en", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: row?.zone || "UTC" }).format(at); }
    catch { return at.toISOString().slice(0, 16).replace("T", " "); }
  }
}

/**
 * Who can be asked: the active people in the teams (or holding the roles) the firm chose in Settings › Sales, with their
 * teams' names; anyone in the workspace when it chose none.
 */
export async function askable(db: Db, workspaceId: string) {
  const codes = ((await db.query<{ codes: string[] | null }>(`SELECT timeline_check_roles AS codes FROM workspace_sales_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.codes ?? [])
    .map(codeKey).filter(Boolean);
  const rows = (await db.query<{ membershipId: string; userId: string; name: string; teams: Array<{ code: string; name: string }> | null; roles: string[] | null }>(
    `SELECT membership.id AS "membershipId", membership.user_id AS "userId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name,
            (SELECT jsonb_agg(jsonb_build_object('code', team.code, 'name', team.name) ORDER BY team.name) FROM workspace_team_members member
               JOIN workspace_teams team ON team.id = member.team_id AND team.workspace_id = member.workspace_id AND team.status = 'active'
              WHERE member.workspace_id = membership.workspace_id AND member.membership_id = membership.id) AS teams,
            (SELECT array_agg(DISTINCT role.code) FROM effective_member_roles assigned JOIN roles role ON role.id = assigned.role_id
              WHERE assigned.workspace_id = membership.workspace_id AND assigned.membership_id = membership.id) AS roles
       FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id AND account.status = 'active'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'
      ORDER BY lower(coalesce(nullif(btrim(account.display_name), ''), account.primary_email)), membership.id`, [workspaceId])).rows;
  return rows.map((row) => {
    const teams = (row.teams ?? []).filter((team) => !codes.length || codes.includes(codeKey(team.code)));
    const byRole = (row.roles ?? []).some((role) => codes.includes(codeKey(role)));
    return { membershipId: row.membershipId, userId: row.userId, name: row.name, teams, included: !codes.length || teams.length > 0 || byRole };
  }).filter((row) => row.included).map(({ included: _included, ...row }) => row);
}
