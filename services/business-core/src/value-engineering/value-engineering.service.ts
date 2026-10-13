import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { caseFacts } from "../design/design-journey.store";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { noteText, overBudgetBy, startProblem } from "./value-engineering.domain";
import {
  agreeOptions, bookMeeting, clientBudget, closeRound, freeRounds, jobLead, membershipOf, quoteFacts, readRounds, roundView, settleRounds, startRound, type MeetingInput, type RoundRow,
} from "./value-engineering.store";

const VIEW = "pre_projects.view";
/** The QS prices; a manager approves quotations. Either may start value engineering or stop it. */
const QS = "commercial.estimate", MANAGER = "commercial.approve";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PLM-147: value engineering on a job's estimate. The QS (or a manager) starts it, also automatically when the QS
 * confirms a price above the client's recorded budget; the lead designer leads it (the savings agreed with the QS, the
 * meeting where the options go to the client); the client's decision ends it (a new version sent, or the price kept,
 * recorded by the lead, the Account Manager or a manager). Every command is validated, version-checked and audited.
 */
@Injectable()
export class ValueEngineeringService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** The job's rounds (the open one first in effect), the client's budget and what the person may do; `quoteId` asks whether a round can start on it. */
  view(actor: RequestActor, workspaceId: string, caseId: string, quoteId?: string | null) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await settleRounds(client, workspaceId, caseId);
      return this.read(client, workspaceId, caseId, user.userId, quoteId && quoteId.length <= 120 ? quoteId : null);
    });
  }

  start(actor: RequestActor, workspaceId: string, caseId: string, input: { quoteId?: unknown; note?: unknown }) {
    const quoteId = typeof input.quoteId === "string" && input.quoteId.trim() && input.quoteId.length <= 120 ? input.quoteId.trim() : null;
    if (!quoteId) throw new BadRequestException("Choose the estimate.");
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      const qs = await this.access.hasPermission(client, workspaceId, user.userId, QS);
      if (!qs && !(await this.access.hasPermission(client, workspaceId, user.userId, MANAGER))) throw new ForbiddenException("Only the QS or a manager starts value engineering.");
      await startRound(client, { workspaceId, caseId, quoteId, origin: "manual", actorUserId: user.userId, note: noteText(input.note), qsUserId: qs ? user.userId : null });
      return this.read(client, workspaceId, caseId, user.userId, quoteId);
    });
  }

  agree(actor: RequestActor, workspaceId: string, caseId: string, roundId: string, input: { version?: unknown; note?: unknown }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await this.mustLead(client, workspaceId, caseId, roundId, user.userId);
      await agreeOptions(client, { workspaceId, caseId, roundId, version: input.version, note: noteText(input.note, 4000), actorUserId: user.userId });
      return this.read(client, workspaceId, caseId, user.userId, null);
    });
  }

  meeting(actor: RequestActor, workspaceId: string, caseId: string, roundId: string, input: MeetingInput & { version?: unknown }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      await this.mustLead(client, workspaceId, caseId, roundId, user.userId);
      await bookMeeting(client, { workspaceId, caseId, roundId, version: input.version, actorUserId: user.userId,
        meeting: { startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone, address: input.address?.trim() || null } });
      return this.read(client, workspaceId, caseId, user.userId, null);
    });
  }

  /** The client keeps the price: recorded by the lead, the Account Manager (who presents the price) or a manager. */
  keepPrice(actor: RequestActor, workspaceId: string, caseId: string, roundId: string, input: { version?: unknown; note?: unknown }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      const membership = await membershipOf(client, workspaceId, user.userId);
      const round = await this.round(client, workspaceId, caseId, roundId);
      const facts = await caseFacts(client, workspaceId, caseId);
      const lead = await this.currentLead(client, workspaceId, caseId, round);
      if (!(membership && (membership === lead || membership === facts?.accountManagerId)) && !(await this.access.hasPermission(client, workspaceId, user.userId, MANAGER)))
        throw new ForbiddenException("The lead designer or the Account Manager records the client's decision.");
      await closeRound(client, { workspaceId, caseId, roundId, version: input.version, outcome: "kept_price", note: noteText(input.note), actorUserId: user.userId });
      return this.read(client, workspaceId, caseId, user.userId, null);
    });
  }

  /** Stops a round that shouldn't run (started by mistake, the job is lost): the QS or a manager, with the reason. */
  withdraw(actor: RequestActor, workspaceId: string, caseId: string, roundId: string, input: { version?: unknown; note?: unknown }) {
    return this.access.withPermission(actor, workspaceId, VIEW, async (client, user) => {
      if (!(await this.access.hasPermission(client, workspaceId, user.userId, QS)) && !(await this.access.hasPermission(client, workspaceId, user.userId, MANAGER)))
        throw new ForbiddenException("Only the QS or a manager stops value engineering.");
      await closeRound(client, { workspaceId, caseId, roundId, version: input.version, outcome: "withdrawn", note: noteText(input.note), actorUserId: user.userId });
      return this.read(client, workspaceId, caseId, user.userId, null);
    });
  }

  /** The designer leads: the round's lead (the job's lead designer now), or a manager. The Account Manager attends without design input. */
  private async mustLead(client: PoolClient, workspaceId: string, caseId: string, roundId: string, userId: string) {
    if (!UUID.test(roundId)) throw new BadRequestException("Choose the value engineering round.");
    const round = await this.round(client, workspaceId, caseId, roundId);
    const membership = await membershipOf(client, workspaceId, userId);
    if (membership && membership === await this.currentLead(client, workspaceId, caseId, round)) return;
    if (await this.access.hasPermission(client, workspaceId, userId, MANAGER)) return;
    throw new ForbiddenException("The lead designer leads value engineering.");
  }

  private async round(client: PoolClient, workspaceId: string, caseId: string, roundId: string) {
    if (!UUID.test(roundId)) throw new BadRequestException("Choose the value engineering round.");
    return (await readRounds(client, workspaceId, caseId)).find((round) => round.id === roundId) ?? null;
  }

  private async currentLead(client: PoolClient, workspaceId: string, caseId: string, round: RoundRow | null) {
    const { lead } = await jobLead(client, workspaceId, caseId);
    return lead && !(lead.fallback && round && !round.leadFallback) ? lead.membershipId : round?.leadMembershipId ?? null;
  }

  private async read(client: PoolClient, workspaceId: string, caseId: string, userId: string, quoteId: string | null) {
    const rounds = await readRounds(client, workspaceId, caseId);
    const views = [];
    for (const round of rounds) views.push(await roundView(client, workspaceId, round));
    const open = rounds.find((round) => round.status === "open") ?? null;
    const membership = await membershipOf(client, workspaceId, userId);
    const facts = await caseFacts(client, workspaceId, caseId);
    const job = await jobLead(client, workspaceId, caseId);
    const isQs = await this.access.hasPermission(client, workspaceId, userId, QS);
    const isManager = await this.access.hasPermission(client, workspaceId, userId, MANAGER);
    const lead = open ? await this.currentLead(client, workspaceId, caseId, open) : null;
    const budget = await clientBudget(client, workspaceId, caseId);
    const quote = quoteId ? await quoteFacts(client, workspaceId, caseId, quoteId) : null;
    const problem = quote ? startProblem({ kind: quote.kind, round: quote.round, status: quote.status, latest: quote.latest }, job.lead, job.designWork) : null;
    const timezone = (await client.query<{ timezone: string }>(`SELECT default_timezone AS timezone FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.timezone ?? "UTC";
    return {
      timezone, budget, freeRounds: await freeRounds(client, workspaceId), designWork: job.designWork,
      rounds: views, open: views.find((round) => round.status === "open") ?? null,
      // Whether a round could start on the quote asked about, and the price against the budget (the quote page's line).
      quote: quote ? { id: quote.id, total: quote.total, currency: quote.currency, overBy: overBudgetBy(quote.total, quote.currency, budget), problem } : null,
      can: {
        start: Boolean((isQs || isManager) && !open && quote && !problem),
        lead: Boolean(open && ((membership && membership === lead) || isManager)),
        decide: Boolean(open && ((membership && (membership === lead || membership === facts?.accountManagerId)) || isManager)),
        withdraw: Boolean(open && (isQs || isManager)),
      },
    };
  }
}
