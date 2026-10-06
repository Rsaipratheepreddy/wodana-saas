"use client";

import { ChevronRight, PenLine } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { StateLabel } from "../portal-labels";
import styles from "../portal.module.css";
import type { PortalTarget, SectionProps } from "./section-types";
import { DesignChoices } from "./design-choices";

type Row = { key: string; target: PortalTarget; title: string; meta: string; state: string; waiting: boolean };

/** Everything the team asked the client to decide, each at the revision they sent: what waits first, then what's decided. */
export function DecisionsSection({ project, format, open, api, reload }: SectionProps) {
  const t = useT();
  const decisions = project.decisions;
  if (!decisions) return null;
  const rows: Array<{ group: string; rows: Row[] }> = [
    { group: t("Quotations"), rows: decisions.quotes.map((quote) => ({ key: quote.id, target: { kind: "quote" as const, id: quote.id }, title: `${quote.title} · V${quote.number}`,
      meta: [quote.kind === "variation" ? t("Variation") : "", format.money(quote.decision?.acceptedTotal ?? quote.total, quote.currency)].filter(Boolean).join(" · "),
      state: quote.expired && quote.status === "issued" ? "expired" : quote.status, waiting: quote.canDecide })) },
    { group: t("Requirements"), rows: decisions.definition ? [{ key: decisions.definition.id, target: { kind: "definition" as const, id: decisions.definition.id },
      title: t("Your requirements · R{number}", { number: decisions.definition.number }), meta: decisions.definition.publishedAt ? format.date(decisions.definition.publishedAt) : "",
      state: decisions.definition.status, waiting: decisions.definition.canDecide }] : [] },
    { group: t("Designs"), rows: decisions.designs.map((design) => ({ key: design.id, target: { kind: "design" as const, id: design.id }, title: `${design.title} · V${design.number}`,
      meta: [design.room, design.type].filter(Boolean).join(" · "), state: design.status, waiting: design.canDecide })) },
    { group: t("Material list"), rows: decisions.materials ? [{ key: decisions.materials.id, target: { kind: "materials" as const, id: decisions.materials.id },
      title: t("Material list · R{number}", { number: decisions.materials.number }), meta: decisions.materials.items.length === 1 ? t("1 material") : t("{count} materials", { count: decisions.materials.items.length }),
      state: decisions.materials.status, waiting: decisions.materials.canDecide }] : [] },
    { group: t("Drawings"), rows: decisions.drawings ? [{ key: decisions.drawings.id, target: { kind: "drawings" as const, id: decisions.drawings.id },
      title: t("Drawings · R{number}", { number: decisions.drawings.number }), meta: format.date(decisions.drawings.sentAt), state: decisions.drawings.status, waiting: decisions.drawings.canDecide }] : [] },
    { group: t("Handover"), rows: decisions.handovers.map((pack) => ({ key: pack.id, target: { kind: "handover" as const, id: pack.id }, title: `${pack.title} · R${pack.revision}`,
      meta: format.date(pack.issuedAt), state: pack.status, waiting: pack.canDecide })) },
    // Change requests (R11): sent to the client to approve, or asked for by them (with the team until assessed).
    { group: t("Changes"), rows: (project.changes ?? []).map((change) => ({ key: change.id, target: { kind: "change" as const, id: change.id }, title: `${change.reference} · ${change.title}`,
      meta: change.priceImpact !== null && change.currency ? `${change.priceImpact.startsWith("-") ? "" : "+"}${format.money(change.priceImpact, change.currency)}` : "",
      state: change.status, waiting: change.canDecide })) },
    { group: t("Questions"), rows: decisions.requests.map((question) => ({ key: question.id, target: { kind: "request" as const, id: question.id }, title: question.title,
      meta: question.decision ? question.decision.choiceLabel : question.dueDate ? t("by {date}", { date: format.date(question.dueDate) }) : "",
      state: question.decision ? "resolved" : "awaiting_decision", waiting: question.canDecide })) },
  ].filter((group) => group.rows.length);
  // Concepts to choose from and materials and design choices to confirm (plan §6.7a) come first.
  const choices = project.choices && (project.choices.presentations.length || project.choices.choices.length)
    ? <DesignChoices caseId={project.id} choices={project.choices} api={api} format={format} onChanged={reload} /> : null;
  const ask = project.role === "approver" && project.changes ? <div className={styles.groupHead}><span />
    <Button size="compact" variant="quiet" onPress={() => open({ kind: "raise-change" })}><PenLine aria-hidden="true" size={16} />{t("Ask for a change")}</Button></div> : null;
  if (!rows.length) return <>{ask}{choices ?? <EmptyState illustration="done" title={t("Nothing to decide yet")} description={t("When your team sends you something to decide, it will be here.")} />}</>;
  const waiting = rows.flatMap((group) => group.rows.filter((row) => row.waiting));
  const list = (items: Row[], label: string): ReactNode => <ul aria-label={label} className={styles.list}>{items.map((row) => <li key={row.key}>
    <button className={`${styles.item} ${styles.itemButton}`} data-tour={row.target.kind === "quote" ? "portal-quote" : row.target.kind === "materials" ? "portal-materials" : undefined}
      data-tour-safe type="button" onClick={() => open(row.target)}>
      <span className={styles.itemText}><span className={styles.itemTitle}>{row.title}</span>{row.meta ? <span className={styles.itemMeta}>{row.meta}</span> : null}</span>
      <span className={styles.itemEnd}><StateLabel state={row.state} canDecide={row.waiting} /><ChevronRight aria-hidden="true" size={18} /></span>
    </button>
  </li>)}</ul>;
  return <div className={styles.section} data-tour="portal-decisions">
    {ask}
    {choices}
    {waiting.length ? <section className={styles.group} aria-labelledby="portal-waiting">
      <h2 className={styles.groupTitle} id="portal-waiting">{t("Waiting for you")}</h2>{list(waiting, t("Waiting for you"))}
    </section> : null}
    {rows.map((group) => {
      const done = group.rows.filter((row) => !row.waiting);
      return done.length ? <section className={styles.group} key={group.group} aria-label={group.group}>
        <h2 className={styles.groupTitle}>{group.group}</h2>{list(done, group.group)}
      </section> : null;
    })}
  </div>;
}
