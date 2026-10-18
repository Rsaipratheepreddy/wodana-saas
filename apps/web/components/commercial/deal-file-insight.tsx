"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AmountList, Card, CheckList, StateChip, useDesignSystem, type ItemState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { amountText } from "@/lib/approvals/policies";
import type { ApprovalStatus } from "@/lib/approvals/policies";
import { dealPeople } from "@/lib/commercial/deal-team";
import { SideSection } from "@/components/record/record-layout";
import { PeopleList, PersonRow, RecordTimeline } from "@/components/record/record-parts";
import type { DealInsight, DealSection } from "../../../../services/business-core/src/commercial/deal-file-insight";
import s from "./deal-file-insight.module.css";

const SECTION: Record<string, MessageKey> = {
  enquiry: tKey("Enquiry"), client: tKey("Client"), quotation: tKey("Quotation"), payment_proofs: tKey("Payment proofs"), finance_values: tKey("Finance values"),
  commission: tKey("Commission"), approval: tKey("Owner approval"), history: tKey("History"), items: tKey("Items & quantities"), collection: tKey("Collection"),
  collection_delivery: tKey("Collection or delivery"), approved_drawing: tKey("Approved drawing"), materials_approval: tKey("Creative director approval"),
  supplier_orders: tKey("Supplier orders"), proof_of_delivery: tKey("Proof of delivery"), design_fee_proposal: tKey("Proposal 1 · Design fee"), inspiration: tKey("Inspiration"),
  site_visit: tKey("Site visit"), concepts: tKey("Mood boards & concepts"), space_planning: tKey("Space planning"), material_list: tKey("Material list"), renders: tKey("Renders"),
  kickoff: tKey("Kick-off meeting"), samples: tKey("Samples"), site_measure: tKey("Site measure"), moodboards: tKey("Mood boards"), concept_2d: tKey("2D concept"),
  final_render: tKey("Final render"),
  design_approval: tKey("Design approval"), main_quotation: tKey("Proposal 2 · Main quotation"), boq: tKey("BOQ"), technical_drawings: tKey("Technical drawings"),
  production: tKey("Production"), delivery_installation: tKey("Delivery & installation"), building_permit: tKey("Building permit"),
};
const GROUP: Record<DealSection["group"], MessageKey> = { common: tKey("Deal File"), furniture: tKey("Furniture"), design: tKey("Design"), production: tKey("Production") };
const STATE: Record<DealSection["state"], ItemState> = { present: "done", open: "in_progress", missing: "missing" };
const RISK: Record<DealInsight["risks"][number], MessageKey> = {
  payment_proof_missing: tKey("payment proof"), commission_missing: tKey("commission"), margin_below_floor: tKey("margin below the floor"),
  qs_estimate_missing: tKey("QS price check"), balance_outstanding: tKey("balance outstanding"), value_zero: tKey("deal value"),
};
const CLOSING: Record<string, MessageKey> = {
  collected: tKey("Closes when the client collects it"), delivered: tKey("Closes on delivery"), collected_or_delivered: tKey("Closes on collection or delivery"),
  design_handover: tKey("Closes at design handover"), all_produced_delivered_installed: tKey("Closes when everything is produced, delivered and installed"),
  completion_handover: tKey("Closes at the signed completion and handover"),
};
const CHECK: Record<string, MessageKey> = {
  collected: tKey("Collected"), delivered: tKey("Delivered"), collected_or_delivered: tKey("Collected or delivered"), installed: tKey("Installed"), produced: tKey("Produced"),
  design_approved: tKey("Design approved"), handover_accepted: tKey("Handover accepted"),
};
const VIA: Record<string, MessageKey> = { delegate: tKey("as cover"), escalation: tKey("after escalation"), waiver: tKey("with a recorded waiver"), legacy: tKey("before approvals moved"), direct: tKey("Approved"), system: tKey("Approved") };

/** What a reviewer should check on the Deal File (an outstanding balance is the Money section's, not a risk). */
export function dealRisks(insight: DealInsight) {
  return insight.risks.filter((risk) => risk !== "balance_outstanding");
}

/** What a reviewer should check, as one line ("Check: commission, QS price check"); null when nothing is at risk. */
export function dealRiskText(t: Translate, insight: DealInsight) {
  const risks = dealRisks(insight);
  return risks.length ? t("Check: {items}", { items: risks.map((risk) => t(RISK[risk])).join(", ") }) : null;
}

/** How many of the Deal File's requirements are in, and how many are missing. */
export function dealRequirementCount(insight: DealInsight) {
  return { done: insight.sections.filter((section) => section.state === "present").length, missing: insight.sections.filter((section) => section.state === "missing").length, total: insight.sections.length };
}

/** The paid share of the agreed value, in whole percent; null without an agreed value. */
export function dealPaidShare(insight: DealInsight) {
  const agreed = Number(insight.agreed);
  return agreed > 0 ? Math.round((Number(insight.received) / agreed) * 100) : null;
}

/**
 * PLM-066 / PLM-102 / PLM-123: what the Deal File holds, each requirement a link to its live record with its state
 * (done, in progress, missing), grouped as the enquiry type sets them.
 */
export function DealRequirements({ insight, id, title }: { insight: DealInsight; id?: string;
  /** None inside the Requirements tab, which names it already. */
  title?: string }) {
  const t = useT();
  const groups = (["common", "furniture", "design", "production"] as const).map((group) => [group, insight.sections.filter((section) => section.group === group)] as const)
    .filter(([, sections]) => sections.length);
  if (!groups.length) return null;
  const count = dealRequirementCount(insight);
  return <Card level={3} id={id} title={title} chip={<span className={s.count}>{t("{done} of {total} done", { done: count.done, total: count.total })}</span>}>
    {groups.map(([group, sections]) => <div key={group} className={s.group}>
      <h4>{t(GROUP[group])}</h4>
      <ul className={s.sections} aria-label={t(GROUP[group])}>{sections.map((section) => <li key={section.key} data-state={section.state}>
        <span className={s.sectionName}>{section.href ? <Link href={section.href}>{t(SECTION[section.key] ?? tKey("Deal File"))}</Link> : t(SECTION[section.key] ?? tKey("Deal File"))}
          {section.count ? <small>{section.count}</small> : null}</span>
        <StateChip state={STATE[section.state]} />
      </li>)}</ul>
    </div>)}
  </Card>;
}

/** PLM-066: the Deal File's money (paid, outstanding, next due, each proposal's own), amounts at the end. */
export function DealMoney({ insight, extra = [], withAgreed = true }: { insight: DealInsight; extra?: Array<{ id: string; label: string; amount: ReactNode; detail?: string }>;
  /** False where the agreed value is already on the page (the Deal File's KPI tiles). */
  withAgreed?: boolean }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const money = (amount: string) => amountText(amount, insight.currency, locale);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  const rounds = insight.rounds.length > 1 ? insight.rounds.map((round) => ({
    id: `round-${round.round}`, label: round.round === "design" ? t("Proposal 1 · Design fee") : t("Proposal 2 · Main quotation"),
    detail: t("{paid} of {agreed} paid", { paid: money(round.received), agreed: money(round.agreed) }), amount: money(round.outstanding),
  })) : [];
  return <SideSection title={t("Money")}>
    <AmountList label={t("Money")} rows={[
      ...(withAgreed ? [{ id: "agreed", label: t("Agreed value"), amount: money(insight.agreed) }] : []),
      { id: "paid", label: t("Paid"), amount: <span className={s.good}>{money(insight.received)}</span> },
      { id: "outstanding", label: t("Outstanding"), amount: <span className={Number(insight.outstanding) > 0 ? s.attention : undefined}>{money(insight.outstanding)}</span> },
      insight.nextDue ? { id: "next", label: t("Next due"), amount: money(insight.nextDue.amount),
        detail: [insight.nextDue.title, insight.nextDue.dueDate ? date(insight.nextDue.dueDate) : null].filter(Boolean).join(" · ") } : { id: "next", label: t("Next due"), amount: t("Nothing due") },
      ...rounds,
      ...extra,
    ]} />
  </SideSection>;
}

/** PLM-102: the event that closes the deal for its enquiry type, as checks read from the records. */
export function DealClosing({ insight }: { insight: DealInsight }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const closing = insight.closing;
  if (!closing?.event) return null;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  return <SideSection title={t("Closing")} chip={closing.closed ? <StateChip state="done" label={t("Closed")} /> : <StateChip state="in_progress" label={t("Open")} />}>
    <p className={s.closingText}>{closing.closed && closing.closedAt ? t("Deal closed · {date}", { date: date(closing.closedAt) }) : t(CLOSING[closing.event] ?? tKey("Deal File"))}</p>
    <CheckList label={t("Closing")} items={closing.checks.map((item) => ({ id: item.key, label: t(CHECK[item.key] ?? tKey("Deal File")), done: item.done, detail: item.done && item.at ? date(item.at) : null }))} />
  </SideSection>;
}

/** PLM-100: who works on the deal, as tagged on the enquiry and the opportunity: each person once, with every role they hold. */
export function DealTeam({ insight }: { insight: DealInsight }) {
  const t = useT();
  const team = dealPeople(insight.team);
  if (!team.people.length && !team.notApplicable.length) return null;
  return <SideSection title={t("Team")}>
    {team.people.length ? <PeopleList label={t("Team")}>{team.people.map((person) => <PersonRow key={person.id} id={person.id} name={person.name} email={person.email}
      role={person.roles.map((role) => t(role as never)).join(" · ")} />)}</PeopleList> : null}
    {team.notApplicable.length ? <p className={s.muted}>{t("Not applicable: {roles}", { roles: team.notApplicable.map((role) => t(role as never)).join(", ") })}</p> : null}
  </SideSection>;
}

/** The Deal File's approval steps on the E3 engine, as steps: who decided each (for whom, how, when), and who holds the current one. */
export function DealApprovalSteps({ approval }: { approval: ApprovalStatus }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const day = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(value));
  const people = (names: string[]) => names.map((name) => ({ id: `person-${name}`, name }));
  return <>
    <RecordTimeline layout="list" label={t("Approval steps")} steps={approval.steps.map((step) => ({
      id: String(step.position),
      label: step.label || t("Approver {number}", { number: step.position }),
      state: step.state === "done" ? "done" : step.state === "current" ? "current" : step.state === "upcoming" ? "upcoming" : "blocked",
      people: step.decidedBy ? people([step.decidedBy]) : step.state === "current" ? people(approval.waitingFor) : [],
      date: step.decidedAt ? day(step.decidedAt) : null,
      detail: step.decidedBy
        ? [step.decidedBy, step.onBehalfOf ? t("for {name}", { name: step.onBehalfOf }) : null, step.via && step.via !== "direct" && step.via !== "system" ? t(VIA[step.via] ?? tKey("Approved")) : null].filter(Boolean).join(" · ")
        : step.state === "current" && approval.waitingFor.length ? t("Waiting for {names}", { names: approval.waitingFor.join(", ") })
        : null,
      late: step.state === "returned" ? t("Returned") : step.state === "rejected" ? t("Rejected") : null,
    }))} />
    {approval.escalated ? <p className={s.escalated}>{t("Escalated: the next approver can decide")}</p> : null}
  </>;
}
