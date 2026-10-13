"use client";

import Link from "next/link";
import { Check, Circle, CircleDot } from "lucide-react";
import { Badge, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { amountText } from "@/lib/approvals/policies";
import type { ApprovalStatus } from "@/lib/approvals/policies";
import { dealPeople } from "@/lib/commercial/deal-team";
import { PeopleList, PersonRow } from "@/components/record/record-parts";
import type { DealInsight, DealSection } from "../../../../services/business-core/src/commercial/deal-file-insight";
import s from "./deal-file-insight.module.css";

const SECTION: Record<string, MessageKey> = {
  enquiry: tKey("Enquiry"), client: tKey("Client"), quotation: tKey("Quotation"), payment_proofs: tKey("Payment proofs"), finance_values: tKey("Finance values"),
  commission: tKey("Commission"), approval: tKey("Owner approval"), history: tKey("History"), items: tKey("Items & quantities"), collection: tKey("Collection"),
  collection_delivery: tKey("Collection or delivery"), approved_drawing: tKey("Approved drawing"), materials_approval: tKey("Creative director approval"),
  supplier_orders: tKey("Supplier orders"), proof_of_delivery: tKey("Proof of delivery"), design_fee_proposal: tKey("Proposal 1 · Design fee"), inspiration: tKey("Inspiration"),
  site_visit: tKey("Site visit"), concepts: tKey("Mood boards & concepts"), space_planning: tKey("Space planning"), material_list: tKey("Material list"), renders: tKey("Renders"),
  kickoff: tKey("Kick-off meeting"), samples: tKey("Samples"),
  design_approval: tKey("Design approval"), main_quotation: tKey("Proposal 2 · Main quotation"), boq: tKey("BOQ"), technical_drawings: tKey("Technical drawings"),
  production: tKey("Production"), delivery_installation: tKey("Delivery & installation"), building_permit: tKey("Building permit"),
};
const GROUP: Record<DealSection["group"], MessageKey> = { common: tKey("Deal File"), furniture: tKey("Furniture"), design: tKey("Design"), production: tKey("Production") };
const STATE: Record<DealSection["state"], { label: MessageKey; tone: "success" | "info" | "warning" }> = {
  present: { label: tKey("Done"), tone: "success" }, open: { label: tKey("In progress"), tone: "info" }, missing: { label: tKey("Missing"), tone: "warning" },
};
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

/**
 * PLM-066 / PLM-102 / PLM-123: the Deal File's money (agreed, paid, outstanding, next due), whether the deal is closed
 * by its enquiry type's closing event, what a reviewer should check, and its contents — each a link to the live record.
 */
export function DealFileInsight({ insight }: { insight: DealInsight }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const money = (amount: string) => amountText(amount, insight.currency, locale);
  const risks = insight.risks.filter((risk) => risk !== "balance_outstanding");
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  const groups = (["common", "furniture", "design", "production"] as const).map((group) => [group, insight.sections.filter((section) => section.group === group)] as const)
    .filter(([, sections]) => sections.length);
  const closing = insight.closing;
  const team = dealPeople(insight.team);
  return <section className={s.insight} aria-label={t("Deal File contents")}>
    <dl className={s.money}>
      <div><dt>{t("Agreed value")}</dt><dd>{money(insight.agreed)}</dd></div>
      <div><dt>{t("Paid")}</dt><dd>{money(insight.received)}</dd></div>
      <div data-attention={Number(insight.outstanding) > 0 || undefined}><dt>{t("Outstanding")}</dt><dd>{money(insight.outstanding)}</dd></div>
      <div><dt>{t("Next due")}</dt><dd>{insight.nextDue ? <>{money(insight.nextDue.amount)}<small>{[insight.nextDue.title, insight.nextDue.dueDate ? date(insight.nextDue.dueDate) : null].filter(Boolean).join(" · ")}</small></> : t("Nothing due")}</dd></div>
    </dl>
    {insight.rounds.length > 1 ? <p className={s.rounds}>{insight.rounds.map((round) => t(round.round === "design" ? "Proposal 1: {paid} of {agreed} paid" : "Proposal 2: {paid} of {agreed} paid",
      { paid: money(round.received), agreed: money(round.agreed) })).join(" · ")}</p> : null}
    {closing?.event ? <div className={s.closing} data-closed={closing.closed || undefined}>
      <strong>{closing.closed && closing.closedAt ? t("Deal closed · {date}", { date: date(closing.closedAt) }) : t(CLOSING[closing.event] ?? tKey("Deal File"))}</strong>
      <ul>{closing.checks.map((item) => <li key={item.key} data-done={item.done || undefined}>
        {item.done ? <Check aria-hidden="true" size={13} /> : <Circle aria-hidden="true" size={13} />}{t(CHECK[item.key] ?? tKey("Deal File"))}
      </li>)}</ul>
    </div> : null}
    <p className={s.risks} data-tone={risks.length ? "attention" : "calm"}>
      {risks.length ? t("Check: {items}", { items: risks.map((risk) => t(RISK[risk])).join(", ") }) : t("Nothing missing on this Deal File.")}
    </p>
    {/* PLM-100: who works on the deal, as tagged on the enquiry and the opportunity: each person once, with every role they hold. */}
    {team.people.length || team.notApplicable.length ? <div className={s.group}>
      <h3>{t("Team")}</h3>
      {team.people.length ? <PeopleList label={t("Team")}>{team.people.map((person) => <PersonRow key={person.id} id={person.id} name={person.name} email={person.email}
        role={person.roles.map((role) => t(role as never)).join(" · ")} />)}</PeopleList> : null}
      {team.notApplicable.length ? <p className={s.muted}>{t("Not applicable: {roles}", { roles: team.notApplicable.map((role) => t(role as never)).join(", ") })}</p> : null}
    </div> : null}
    {groups.map(([group, sections]) => <div key={group} className={s.group}>
      <h3>{t(GROUP[group])}</h3>
      <ul className={s.sections}>{sections.map((section) => <li key={section.key}>
        {section.href ? <Link href={section.href}>{t(SECTION[section.key] ?? tKey("Deal File"))}</Link> : <span>{t(SECTION[section.key] ?? tKey("Deal File"))}</span>}
        {section.count ? <small>{section.count}</small> : null}
        <Badge tone={STATE[section.state].tone}>{t(STATE[section.state].label)}</Badge>
      </li>)}</ul>
    </div>)}
  </section>;
}

/** The Deal File's approval steps on the E3 engine: who decided each, for whom and how, and who holds the current one. */
export function DealApprovalSteps({ approval }: { approval: ApprovalStatus }) {
  const t = useT();
  const { locale } = useDesignSystem();
  return <ol className={s.approval} aria-label={t("Approval steps")}>
    {approval.steps.map((step) => <li key={step.position} data-state={step.state}>
      {step.state === "done" ? <Check aria-hidden="true" size={14} /> : step.state === "current" ? <CircleDot aria-hidden="true" size={14} /> : <Circle aria-hidden="true" size={14} />}
      <span className={s.stepName}>{step.label || t("Approver {number}", { number: step.position })}</span>
      <small>{step.decidedBy
        ? [step.decidedBy, step.onBehalfOf ? t("for {name}", { name: step.onBehalfOf }) : null, step.via && step.via !== "direct" ? t(VIA[step.via] ?? tKey("Approved")) : null,
          step.decidedAt ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(step.decidedAt)) : null].filter(Boolean).join(" · ")
        : step.state === "current" && approval.waitingFor.length ? t("Waiting for {names}", { names: approval.waitingFor.join(", ") })
        : step.state === "returned" ? t("Returned") : step.state === "rejected" ? t("Rejected") : ""}</small>
    </li>)}
    {approval.escalated ? <li data-state="escalated"><small>{t("Escalated: the next approver can decide")}</small></li> : null}
  </ol>;
}
