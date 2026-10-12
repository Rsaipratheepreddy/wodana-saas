import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { fromMinor, minorUnits, toMinor } from "@/lib/money-exact";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import type { ProjectDetail } from "@/lib/project-core/types";
import { nextStepPhrase } from "@/lib/project-core/next-step";
import type { JourneyStageKey, JourneyStageView, JourneyView } from "./design-workspace";
import { caseHref, type CaseCommercialFacts, type CasePlan, type PreProjectCase } from "./types";

/**
 * A planning case read as a record (§5c D.7): where it stands, the one next step computed from its real state
 * (the design stages, the quotation, the agreement, the payments, the project it opened), its money, its
 * timeline and its activity. Everything here is read from the API; a value that isn't known is left out.
 */
export type CaseRecordInput = {
  record: PreProjectCase;
  commercial?: CommercialState | null;
  journey?: JourneyView | null;
  /** The project a released case opened, when it has loaded. */
  project?: ProjectDetail | null;
  /** Today in the workspace's time zone (YYYY-MM-DD). */
  today: string;
};

export type Message = { key: MessageKey; values?: Record<string, string | number> };
export type CaseCommand = "start_journey" | "resume" | "reopen";
export type CaseNextStep = {
  title: Message;
  /** One line on why; a translated message, or text as the record holds it (a hold reason). */
  why?: Message | { text: string } | null;
  owner?: string | null;
  /** When it is due (an ISO moment or a YYYY-MM-DD day). */
  due?: string | null;
  overdue?: boolean;
  action?: { label: Message; href?: string; command?: CaseCommand } | null;
  /** Colours the card: attention while it waits on something late or held. */
  status?: "attention" | "done";
};

export const CASE_PHASES = ["discover", "define", "design", "price", "agree", "release"] as const;
/** Each planning phase's name and what it needs next: the same words as the Planning list. */
export const CASE_PHASE_TEXT: Record<PreProjectCase["phase"], { stage: MessageKey; next: MessageKey; section: string; open: MessageKey }> = {
  discover: { stage: tKey("Requirements"), next: tKey("Capture the requirements"), section: "requirements", open: tKey("Open requirements") },
  define: { stage: tKey("Scope confirmation"), next: tKey("Confirm the scope"), section: "definition", open: tKey("Open the scope") },
  design: { stage: tKey("Design"), next: tKey("Present the design"), section: "designs", open: tKey("Open design") },
  price: { stage: tKey("Quotation"), next: tKey("Send the quotation"), section: "quotations", open: tKey("Open quotations") },
  agree: { stage: tKey("Agreement"), next: tKey("Sign the agreement"), section: "contracts", open: tKey("Open the agreement") },
  release: { stage: tKey("Ready for production"), next: tKey("Release to production"), section: "execution-release", open: tKey("Open release") },
};

type PhaseText = (typeof CASE_PHASE_TEXT)[PreProjectCase["phase"]];

/** The phases a case goes through: its path's own (PLM-121/126), else every planning phase. */
export function casePhases(plan?: CasePlan | null): readonly PreProjectCase["phase"][] {
  return plan?.phases?.length ? plan.phases : CASE_PHASES;
}

/**
 * A phase in the case's words: a path without design work calls its design phase the site visit, and an order of
 * stock or supplier goods is released to fulfilment, not production.
 */
export function casePhaseText(phase: PreProjectCase["phase"], plan?: CasePlan | null): PhaseText {
  if (phase === "design" && plan && plan.siteVisit && !plan.design) return { stage: tKey("Site visit"), next: tKey("Record the site visit"), section: "site", open: tKey("Open the site") };
  if (phase === "release" && plan?.release === "fulfilment") return { stage: tKey("Ready for fulfilment"), next: tKey("Release to fulfilment"), section: "execution-release", open: tKey("Open release") };
  return CASE_PHASE_TEXT[phase] ?? CASE_PHASE_TEXT.discover;
}

/** A recorded phase on the case's own line: a phase its path skips moves on to the next one it uses. */
export function plannedPhase(phase: PreProjectCase["phase"], plan?: CasePlan | null): PreProjectCase["phase"] {
  const phases = casePhases(plan);
  if (phases.includes(phase)) return phase;
  const at = CASE_PHASES.indexOf(phase);
  return phases.find((item) => CASE_PHASES.indexOf(item) > at) ?? phases.at(-1) ?? phase;
}

export const JOURNEY_STAGE_LABEL: Record<JourneyStageKey, MessageKey> = {
  inspiration: tKey("Inspiration"), site_visit: tKey("Site visit"), concepts: tKey("Concepts"), space_planning: tKey("Space planning"),
  material_selection: tKey("Material selection"), renders: tKey("3D renders"), approval: tKey("Design approval"),
};
const DELIVERABLE: JourneyStageKey[] = ["concepts", "space_planning", "material_selection", "renders"];

const dayOf = (value: string) => value.slice(0, 10);
const href = (record: PreProjectCase, section: string, query?: Record<string, string>) => {
  const path = caseHref(record.id, new URLSearchParams(), section);
  return query ? `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(query)}` : path;
};

type FactQuote = CaseCommercialFacts["data"]["quotes"][number];

/** The quotation that matters now: the newest one still in play (not superseded or withdrawn). */
export function currentQuote<Q extends FactQuote>(commercial?: { data: { quotes: Q[] } } | null): Q | null {
  const quotes = commercial?.data.quotes.filter((quote) => quote.kind === "quotation" && !["superseded", "withdrawn"].includes(quote.status)) ?? [];
  return quotes.find((quote) => quote.status === "accepted" && quote.round !== "design") ?? quotes.at(-1) ?? null;
}

/** A quotation as people name it: the number it was issued under once sent (PLM-QUO-2026-00001), else Q-3. */
export function quoteName(quote: Pick<FactQuote, "id" | "number">, commercial?: Pick<CaseCommercialFacts, "quoteReferences"> | null) {
  return commercial?.quoteReferences?.[quote.id] ?? `Q-${quote.number}`;
}

/**
 * What the current quotation asks for next while it is still with the firm or the client, in the case's words; null
 * once it is accepted (the agreement, payments and release follow). The overview and the Planning list both read it.
 */
export function quoteStep(quote: FactQuote, commercial?: Pick<CaseCommercialFacts, "quoteReferences"> | null): { title: Message; why?: Message; attention?: boolean } | null {
  const named = { quote: quoteName(quote, commercial) };
  switch (quote.status) {
    case "draft": return { title: { key: tKey("Finish quotation {quote}"), values: named } };
    case "internal_review": return { title: { key: tKey("Review quotation {quote}"), values: named }, why: { key: tKey("Waiting for the internal review") } };
    case "internal_approved": return { title: { key: tKey("Send quotation {quote} to the client"), values: named } };
    case "issued": return { title: { key: tKey("Waiting for the client's decision") }, why: { key: tKey("Quotation {quote} is with the client"), values: named } };
    case "changes_requested": return { title: { key: tKey("Revise quotation {quote}"), values: named }, why: { key: tKey("The client asked for changes") }, attention: true };
    case "declined": case "expired": return { title: { key: tKey("Prepare a new quotation") },
      why: { key: quote.status === "declined" ? tKey("The client declined {quote}") : tKey("{quote} expired before the client decided"), values: named }, attention: true };
    default: return null;
  }
}

/** The design stage being worked on now, when the design stages have started. */
export function activeJourneyStage(journey?: JourneyView | null): JourneyStageView | null {
  return journey?.journey ? journey.stages.find((stage) => stage.status === "active") ?? null : null;
}

/** What a case's phase is read from: its recorded phase, its path and the day its design was signed off. */
type PhaseRecord = Pick<PreProjectCase, "phase" | "plan" | "designApprovedOn">;

/**
 * Where the case really is: the furthest of its recorded phase and what its records already show (a quotation in
 * review or with the client is pricing; an accepted one is the agreement; a signed agreement is the release).
 * A design fee's round buys the design work, not the order: accepted, it opens the design phase, and its agreement
 * releases nothing. The client's sign-off of the design closes it: the main quotation is priced next. Each record
 * only moves the case on, so a later quotation (the estimate drafted at the design approval) never sends it back.
 */
export function effectivePhase(record: PhaseRecord, commercial?: CaseCommercialFacts | null): PreProjectCase["phase"] {
  const quote = currentQuote(commercial);
  const main = quote && quote.round !== "design" ? quote : null;
  const agreement = commercial?.data.agreement;
  const designFee = (quoteId: string) => commercial?.data.quotes.find((item) => item.id === quoteId)?.round === "design";
  const shown: Array<PreProjectCase["phase"] | null> = [
    record.phase,
    commercial?.data.quotes.some((item) => item.round === "design" && item.status === "accepted") ? "design" : null,
    record.designApprovedOn ? "price" : null,
    main && main.status !== "draft" ? "price" : null,
    main?.status === "accepted" ? "agree" : null,
    agreement?.status === "executed" && !designFee(agreement.quoteId) ? "release" : null,
  ];
  const furthest = Math.max(0, ...shown.map((phase) => (phase ? CASE_PHASES.indexOf(phase) : -1)));
  return plannedPhase(CASE_PHASES[furthest], record.plan);
}

/** The case's position in its phases (1-based) and how many there are. */
export function casePosition(record: PhaseRecord, commercial?: CaseCommercialFacts | null) {
  const phases = casePhases(record.plan);
  return { position: phases.indexOf(effectivePhase(record, commercial)) + 1, count: phases.length };
}

/** The one next step, from the case's real state, in the order the work happens. */
export function caseNextStep({ record, commercial, journey, project, today }: CaseRecordInput): CaseNextStep {
  const owner = record.engagementOwnerName;
  if (record.status === "cancelled") return {
    title: { key: tKey("Planning cancelled") }, why: record.cancellationReason ? { text: record.cancellationReason } : null, status: "attention",
    action: record.canManageLifecycle ? { label: { key: tKey("Reopen planning") }, command: "reopen" } : null,
  };
  if (record.status === "on_hold") return {
    title: { key: tKey("On hold") }, why: record.holdReason ? { text: record.holdReason } : null, owner, status: "attention",
    action: record.canManageLifecycle ? { label: { key: tKey("Resume") }, command: "resume" } : null,
  };
  if (record.projectId || record.status === "released") {
    const open = record.projectId ? { label: { key: tKey("Open the project") }, href: `/workspace/projects/${record.projectId}` } : null;
    if (project && project.project.status === "active") {
      const current = project.stages.find((stage) => stage.status === "current");
      return {
        title: project.next ? nextStepPhrase(project.next) : { key: tKey("Open the project") },
        why: current ? { key: tKey("{project} · {stage} · {position} of {count}"), values: { project: project.project.reference, stage: current.name, position: current.position + 1, count: project.stages.length } } : null,
        owner: project.next?.owner ?? null, due: project.project.promiseDate, overdue: Boolean(project.project.promiseDate && project.project.promiseDate < today), action: open,
      };
    }
    if (project && project.project.status === "completed") return { title: { key: tKey("Project completed") }, why: { key: tKey("{project} was handed over"), values: { project: project.project.reference } }, status: "done", action: open };
    if (project && project.project.status === "on_hold") return { title: { key: tKey("Project on hold") }, why: project.project.holdReason ? { text: project.project.holdReason } : null, status: "attention", action: open };
    return { title: { key: tKey("Released to the project") }, status: "done", action: open };
  }

  // The design stages, once they run, lead the case.
  const stage = activeJourneyStage(journey);
  if (stage) return {
    title: { key: JOURNEY_STAGE_LABEL[stage.stage] ?? (stage.label as MessageKey) },
    why: stage.progress?.total ? { key: tKey("{approved} of {total} approved"), values: { approved: stage.progress.approved, total: stage.progress.total } } : { key: tKey("Design stage {position} of {count}"), values: { position: journey!.stages.indexOf(stage) + 1, count: journey!.stages.length } },
    owner: stage.ownerName ?? owner, due: stage.dueAt, overdue: stage.overdue, status: stage.overdue ? "attention" : undefined,
    action: DELIVERABLE.includes(stage.stage) ? { label: { key: tKey("Open design") }, href: href(record, "designs", { stage: stage.stage }) } : null,
  };
  if (journey && !journey.journey && journey.canStart && (!record.plan || record.plan.siteVisit || record.plan.design)) {
    const site = journey.startsAs === "site_and_materials";
    return { title: { key: site ? tKey("Start the site visit") : tKey("Start the design") }, why: { key: site ? tKey("The order needs measuring before materials are chosen.") : tKey("The design deposit is in; the design stages can start.") }, owner,
      action: { label: { key: site ? tKey("Start site visit") : tKey("Start design") }, command: "start_journey" } };
  }

  const quote = currentQuote(commercial);
  if (quote && commercial) {
    const step = quoteStep(quote, commercial);
    if (step) {
      const { attention, ...shown } = step;
      const open = quote.status === "declined" || quote.status === "expired" ? { label: { key: tKey("Open quotations") }, href: href(record, "quotations") }
        : { label: { key: tKey("Open quotation") }, href: href(record, "quotations", { quote: quote.id }) };
      return { ...shown, owner: quote.status === "internal_review" ? quote.approvedBy ?? owner : owner, action: open,
        ...(attention ? { status: "attention" as const } : {}),
        ...(quote.status === "issued" ? { due: quote.validUntil, overdue: Boolean(quote.validUntil && dayOf(quote.validUntil) < today) } : {}) };
    }
    // Accepted: the agreement, then the payments it schedules, then the release.
    const agreement = commercial.data.agreement;
    if (!agreement || agreement.status !== "executed") return { title: { key: tKey("Sign the agreement") }, why: { key: tKey("{quote} accepted"), values: { quote: quoteName(quote, commercial) } }, owner, action: { label: { key: tKey("Open the agreement") }, href: href(record, "contracts") } };
    const waiting = commercial.data.payments.filter((payment) => payment.status !== "verified").sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"))[0];
    if (waiting) {
      const amount = { title: waiting.title };
      const due = waiting.dueDate || null;
      return waiting.status === "proof_submitted"
        ? { title: { key: tKey("Verify {title}"), values: amount }, why: { key: tKey("The client's payment proof is in") }, due, action: { label: { key: tKey("Open payments") }, href: href(record, "payment-plan", { payment: waiting.id }) } }
        : { title: { key: tKey("Collect {title}"), values: amount }, owner, due, overdue: Boolean(due && dayOf(due) < today), status: due && dayOf(due) < today ? "attention" : undefined,
          action: { label: { key: tKey("Open payments") }, href: href(record, "payment-plan", { payment: waiting.id }) } };
    }
    const review = commercial.data.ownerReview;
    if (!commercial.data.dealFile && review && ["submitted", "pending_finance", "pending_approval"].includes(review.status)) return { title: { key: tKey("Approve the deal") }, why: { key: tKey("Waiting for the owner's review") }, action: { label: { key: tKey("Open approvals") }, href: href(record, "approvals") } };
    // A paid design fee opens the design work (above, once its stages run); the order is priced after it, so nothing is released yet.
    if (quote.round !== "design")
      return { title: { key: casePhaseText("release", record.plan).next }, why: { key: tKey("Agreed and paid") }, owner, action: { label: { key: tKey("Open release") }, href: href(record, "execution-release") } };
  }

  const phase = casePhaseText(effectivePhase(record, commercial), record.plan);
  return { title: { key: phase.next }, owner, due: record.targetDate, overdue: Boolean(record.targetDate && record.targetDate < today), action: { label: { key: phase.open }, href: href(record, phase.section) } };
}

export type CaseMoney = { currency: string; quoted: string | null; agreed: string | null; paid: string | null; outstanding: string | null; paidShare: number | null };

/** The case's money in exact minor units: quoted, agreed, paid (verified) and what's still to come. */
export function caseMoney(commercial?: CommercialState | null): CaseMoney | null {
  if (!commercial) return null;
  const quote = currentQuote(commercial);
  const currency = commercial.data.agreement?.currency ?? quote?.currency ?? commercial.currency;
  const places = minorUnits(currency);
  const text = (minor: number) => fromMinor(minor, currency).toFixed(places);
  const agreedValue = commercial.data.agreement?.status === "executed" ? commercial.data.agreement.acceptedTotal ?? commercial.data.dealFile?.value ?? quote?.total ?? null : commercial.data.dealFile?.value ?? null;
  const agreed = agreedValue === null || agreedValue === undefined ? null : toMinor(agreedValue, currency);
  const verified = commercial.data.payments.filter((payment) => payment.status === "verified");
  const paid = verified.length ? verified.reduce((sum, payment) => sum + toMinor(payment.amount, currency), 0) : null;
  const quoted = quote ? toMinor(quote.total, currency) : null;
  if (quoted === null && agreed === null && paid === null) return null;
  return {
    currency,
    quoted: quoted !== null && agreed === null ? text(quoted) : null,
    agreed: agreed !== null ? text(agreed) : null,
    paid: paid !== null ? text(paid) : null,
    outstanding: agreed !== null ? text(Math.max(0, agreed - (paid ?? 0))) : null,
    paidShare: agreed ? Math.min(100, Math.round(((paid ?? 0) * 100) / agreed)) : null,
  };
}

/** How many things on the case are past their date: design stages, payments still owed, a quotation the client let run out. */
export function caseOverdue({ commercial, journey, record, today }: CaseRecordInput): number {
  if (record.status === "cancelled" || record.status === "released") return 0;
  const stages = journey?.journey ? journey.stages.filter((stage) => stage.status === "active" && stage.overdue).length : 0;
  const executed = commercial?.data.agreement?.status === "executed";
  const payments = executed ? commercial!.data.payments.filter((payment) => payment.status === "pending" && payment.dueDate && dayOf(payment.dueDate) < today).length : 0;
  const quote = currentQuote(commercial);
  const lapsing = quote?.status === "issued" && quote.validUntil && dayOf(quote.validUntil) < today ? 1 : 0;
  return stages + payments + lapsing;
}

export type CaseStep = {
  id: string; label: Message; state: "done" | "current" | "upcoming" | "blocked";
  /** Finished on (ISO or day), when the record knows it. */
  doneAt?: string | null;
  people: Array<{ id: string; name: string }>;
  detail?: Message | null;
};

/**
 * A case's stage and next step as the Planning list shows them, from the same reading as its overview: the phase the
 * records put it in, and what its current quotation waits for while it is with the firm or the client.
 */
export function caseListStep(record: PhaseRecord, commercial?: CaseCommercialFacts | null): { stage: MessageKey; next: Message } {
  const phase = casePhaseText(effectivePhase(record, commercial), record.plan);
  const quote = currentQuote(commercial);
  const step = quote ? quoteStep(quote, commercial) : null;
  return { stage: phase.stage, next: step?.title ?? { key: phase.next } };
}

/** The case's phases as steps (✓ done · ● now · ○ next), with who and when where the records say; then its project. */
export function caseTimeline({ record, commercial, journey, project }: CaseRecordInput): CaseStep[] {
  const released = record.status === "released" || Boolean(record.projectId);
  const phases = casePhases(record.plan);
  const current = phases.indexOf(effectivePhase(record, commercial));
  const accepted = commercial?.data.quotes.find((quote) => quote.status === "accepted" && quote.round !== "design");
  const agreement = commercial?.data.agreement?.status === "executed" ? commercial.data.agreement : null;
  const designers = [...new Map((journey?.journey ? journey.stages : []).filter((stage) => stage.ownerName).map((stage) => [stage.ownerName!, { id: `designer-${stage.ownerName}`, name: stage.ownerName! }])).values()];
  const ownerPerson = record.engagementOwnerName ? [{ id: record.ownerMembershipId ?? "owner", name: record.engagementOwnerName }] : [];
  const doneAt: Partial<Record<PreProjectCase["phase"], string | null>> = {
    design: journey?.journey?.approvedOn ?? record.designApprovedOn ?? null, price: accepted?.decidedAt ?? null, agree: agreement?.executedAt ?? null, release: record.releasedAt,
  };
  const steps: CaseStep[] = phases.map((phase, index) => {
    const state: CaseStep["state"] = released || index < current ? "done" : index === current ? (record.status === "on_hold" || record.status === "cancelled" ? "blocked" : "current") : "upcoming";
    const done = journey?.journey ? journey.stages.filter((stage) => stage.status === "done").length : 0;
    return {
      id: phase, label: { key: casePhaseText(phase, record.plan).stage }, state, doneAt: state === "done" ? doneAt[phase] ?? null : null,
      people: phase === "design" && designers.length ? designers : state === "current" ? ownerPerson : [],
      detail: phase === "design" && journey?.journey && state !== "done" ? { key: tKey("{done} of {total} stages done"), values: { done, total: journey.stages.length } } : null,
    };
  });
  if (record.projectId) {
    const lead = project?.team.find((role) => role.role === "project_manager")?.member;
    const stage = project?.stages.find((item) => item.status === "current");
    steps.push({
      id: "project", label: { key: tKey("Project") },
      state: project?.project.status === "completed" ? "done" : project?.project.status === "on_hold" ? "blocked" : "current",
      doneAt: project?.project.status === "completed" ? project.project.closedAt : null,
      people: lead ? [{ id: lead.membershipId, name: lead.name }] : [],
      detail: stage ? { key: stage.name as MessageKey } : null,
    });
  }
  return steps;
}

/** What each step on the commercial record says, in words; steps without words are left out. */
const AUDIT_TEXT: Record<string, MessageKey> = {
  set_service_path: tKey("{who} chose the service"),
  create: tKey("{who} created a quotation"),
  submit: tKey("{who} sent the quotation for review"),
  qs_approve: tKey("{who} approved the estimate"),
  issue: tKey("{who} issued the quotation"),
  "Client accept (portal)": tKey("The client accepted the quotation"),
  "Client request (portal)": tKey("The client asked for a change"),
  "Client message (portal)": tKey("The client sent a message"),
  agreement: tKey("{who} prepared the agreement"),
  attach_agreement_file: tKey("{who} attached the signed agreement"),
  execute_agreement: tKey("{who} recorded the agreement signed"),
  submit_owner_review: tKey("{who} sent the deal for approval"),
  review_deal_finance: tKey("{who} checked the deal's finance"),
  decide_owner_review: tKey("{who} decided on the deal"),
  report_payment_receipt: tKey("{who} recorded a payment"),
  verify_payment: tKey("{who} verified a payment"),
  comment: tKey("{who} added a note"),
};

/** The latest steps on the case, newest first. */
export function caseActivity(commercial?: CommercialState | null, limit = 6): Array<{ id: string; text: Message; at: string; note: string }> {
  return (commercial?.data.audit ?? []).filter((entry) => AUDIT_TEXT[entry.action]).slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
    .map((entry) => ({ id: entry.id, text: { key: AUDIT_TEXT[entry.action], values: { who: entry.actor } }, at: entry.at, note: entry.note }));
}

export type CasePerson = { id: string; name: string; roles: MessageKey[]; email?: string | null; phone?: string | null };

/** The people on the case, one row each with every role they hold: the client, sales, the owner, the designers, the project manager. */
export function caseTeam({ record, commercial, journey, project }: CaseRecordInput, members: Array<{ id: string; displayName: string; email?: string | null }>): { client: CasePerson | null; team: CasePerson[] } {
  const people = new Map<string, CasePerson>();
  const byId = (id?: string | null) => (id ? members.find((member) => member.id === id) : undefined);
  const byName = (name: string) => members.find((member) => member.displayName === name);
  const add = (key: string, name: string, role: MessageKey, email?: string | null) => {
    const known = people.get(key);
    if (known) { if (!known.roles.includes(role)) known.roles.push(role); if (!known.email && email) known.email = email; return; }
    people.set(key, { id: key, name, roles: [role], email: email ?? null });
  };
  const seller = byId(record.salesMembershipId);
  if (seller) add(seller.id, seller.displayName, tKey("Sales"), seller.email);
  else if (record.leadManagerName) { const match = byName(record.leadManagerName); add(match?.id ?? `sales-${record.leadManagerName}`, record.leadManagerName, tKey("Sales"), match?.email); }
  if (record.engagementOwnerName) { const match = byId(record.ownerMembershipId) ?? byName(record.engagementOwnerName); add(match?.id ?? `owner-${record.engagementOwnerName}`, record.engagementOwnerName, tKey("Case owner"), match?.email); }
  for (const stage of journey?.journey ? journey.stages : []) {
    if (!stage.ownerName) continue;
    const match = byName(stage.ownerName);
    add(match?.id ?? `designer-${stage.ownerName}`, stage.ownerName, tKey("Designer"), match?.email);
  }
  const lead = project?.team.find((role) => role.role === "project_manager")?.member;
  if (lead) add(lead.membershipId, lead.name, tKey("Project manager"), lead.email ?? byId(lead.membershipId)?.email);
  // PLM-100: the team tagged on the enquiry and the opportunity, in the firm's own role names.
  for (const role of record.team ?? []) if (role.member) add(role.member.membershipId, role.member.name, role.label as MessageKey, role.member.email ?? byId(role.member.membershipId)?.email);
  const client = record.customerName ? { id: `client-${record.customerId}`, name: record.customerName, roles: [tKey("Client")], email: commercial?.customerEmail || null, phone: commercial?.customerPhone || null } : null;
  return { client, team: [...people.values()] };
}

export type CaseFile = { id: string; name: string; at?: string | null; href: string; download: boolean };

/** The case's documents: its quotations (sent or accepted) and the signed agreement's files. */
export function caseFiles(record: PreProjectCase, commercial: CommercialState | null | undefined, assetHref: (assetId: string) => string): CaseFile[] {
  if (!commercial) return [];
  const quotes = commercial.data.quotes.filter((quote) => ["issued", "accepted", "changes_requested", "declined", "expired"].includes(quote.status))
    .map((quote) => ({ id: quote.id, name: `Q-${quote.number} · ${quote.title}`, at: quote.decidedAt ?? quote.issuedAt ?? null, href: href(record, "quotations", { quote: quote.id, view: "document" }), download: false }));
  const signed = (commercial.data.agreement?.files ?? []).map((file) => ({ id: file.id, name: file.name, at: file.addedAt, href: assetHref(file.id), download: true }));
  return [...quotes, ...signed];
}
