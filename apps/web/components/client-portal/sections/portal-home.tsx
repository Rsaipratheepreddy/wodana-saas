"use client";

import {
  CalendarCheck, ClipboardCheck, FileSignature, FileText, Images, MessageCircleReply, Package, PenLine, Receipt, Sparkles, Sun, Wallet, type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalBudget, PortalDigest, PortalFeedCard, PortalFeedKind } from "@/lib/client-portal/types";
import { StateLabel } from "../portal-labels";
import type { PortalFormat } from "../portal-format";
import styles from "../portal-home.module.css";
import type { PortalTarget } from "./section-types";

const ICONS: Record<PortalFeedKind, LucideIcon> = {
  day: Sun, update: ClipboardCheck, design: Images, presentation: Sparkles, document: FileText, quote: FileSignature, change: PenLine, invoice: Receipt, payment: Wallet,
  reply: MessageCircleReply, handover: Package, choice: CalendarCheck,
};

/** The names of each card kind, for the feed's small label and the digest's lines. */
function useKindText() {
  const t = useT();
  const kind: Record<PortalFeedKind, string> = {
    day: t("Day on site"), update: t("Update"), design: t("Design shared"), presentation: t("Concepts to choose"), document: t("Document"), quote: t("Quotation"),
    change: t("Change request"), invoice: t("Invoice"), payment: t("Payment received"), reply: t("Reply from your team"), handover: t("Handover"), choice: t("Choice changed"),
  };
  // One, or a count: "1 change request", "3 change requests".
  const count = (item: PortalDigest["items"][number]) => {
    const one: Record<PortalFeedKind, string> = {
      day: t("1 day on site"), update: t("1 update"), design: t("1 design shared"), presentation: t("1 set of concepts to choose"), document: t("1 document"), quote: t("1 quotation"),
      change: t("1 change request"), invoice: t("1 invoice"), payment: t("1 payment received"), reply: t("1 reply from your team"), handover: t("1 handover pack"), choice: t("1 choice changed"),
    };
    if (item.count === 1) return one[item.kind];
    return ({
      day: t("{count} days on site", { count: item.count }), update: t("{count} updates", { count: item.count }), design: t("{count} designs shared", { count: item.count }),
      presentation: t("{count} concepts to choose", { count: item.count }), document: t("{count} documents", { count: item.count }), quote: t("{count} quotations", { count: item.count }),
      change: t("{count} change requests", { count: item.count }), invoice: t("{count} invoices", { count: item.count }), payment: t("{count} payments received", { count: item.count }),
      reply: t("{count} replies from your team", { count: item.count }), handover: t("{count} handover packs", { count: item.count }), choice: t("{count} choices changed", { count: item.count }),
    } satisfies Record<PortalFeedKind, string>)[item.kind];
  };
  return { kind, count };
}

/**
 * AI2, "what changed since you last looked": the feed's events since this contact's previous visit, counted by kind
 * with the first few names. Written from the record, word for word the same every time (no AI needed).
 */
export function WhatChanged({ digest, format }: { digest: PortalDigest | null | undefined; format: PortalFormat }) {
  const t = useT();
  const text = useKindText();
  if (!digest?.items.length) return null;
  return <section className={styles.digest} aria-labelledby="portal-digest">
    <h3 className={styles.digestTitle} id="portal-digest"><Sparkles aria-hidden="true" size={16} />{t("Since you last looked")}</h3>
    <ul className={styles.digestList}>{digest.items.map((item) => <li key={item.kind}>
      <strong>{text.count(item)}</strong>
      <span className={styles.digestNames} dir="auto">{item.titles.map((title) => (item.kind === "day" ? format.date(title) : title)).join(" · ")}</span>
    </li>)}</ul>
  </section>;
}

/** Where a feed card opens: its decision or conversation, or its section. */
export function feedTarget(card: PortalFeedCard): { target?: PortalTarget; section?: "progress" | "decisions" | "documents" | "payments" | "messages" } {
  switch (card.kind) {
    case "quote": return { target: { kind: "quote", id: card.id } };
    case "design": return { target: { kind: "design", id: card.id } };
    case "change": return { target: { kind: "change", id: card.id } };
    case "handover": return { target: { kind: "handover", id: card.id } };
    case "reply": return { target: { kind: "thread", id: card.id } };
    case "presentation": case "choice": return { section: "decisions" };
    case "document": return { section: "documents" };
    case "invoice": case "payment": return { section: "payments" };
    default: return { section: "progress" };
  }
}

/** The home feed: typed cards, newest first; each opens what it is about. */
export function FeedList({ cards, format, onOpen, thumb }: { cards: PortalFeedCard[]; format: PortalFormat; onOpen: (card: PortalFeedCard) => void;
  /** A picture for a card that has one (a day's photo, a shared design). */
  thumb?: (card: PortalFeedCard) => string | null }) {
  const text = useKindText();
  // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
  const picture = (url: string | null) => (url ? <img alt="" loading="lazy" src={url} /> : null);
  return <ol className={styles.feed}>{cards.map((card) => {
    const Icon = ICONS[card.kind];
    const amount = card.kind === "payment" || card.kind === "invoice";
    return <li key={`${card.kind}-${card.id}`}>
      <button className={styles.card} data-kind={card.kind} type="button" onClick={() => onOpen(card)}>
        <span className={styles.cardIcon} aria-hidden="true">{picture(thumb?.(card) ?? null) ?? <Icon size={18} />}</span>
        <span className={styles.cardText}>
          <span className={styles.cardKind}>{text.kind[card.kind]}</span>
          <span className={styles.cardTitle} dir="auto">{card.kind === "day" ? format.date(card.title) : card.title}</span>
          {card.note && !amount ? <span className={styles.cardNote} dir="auto">{card.note}</span> : null}
        </span>
        <span className={styles.cardEnd}>
          <span>{format.date(card.at)}</span>
          {card.status && card.status !== "changed" ? <StateLabel state={card.status} /> : card.status === "changed" ? <StateLabel state="changed" /> : null}
        </span>
      </button>
    </li>;
  })}</ol>;
}

/**
 * R1, the client's budget: what was agreed, each approved change (linked to the decision it came from), allowance
 * spend beyond what was included, and the forecast final; changes still waiting are shown beside it, not in it.
 */
export function BudgetTracker({ budget, format, onOpen, compact = false }: { budget: PortalBudget; format: PortalFormat; onOpen: (target: PortalTarget) => void; compact?: boolean }) {
  const t = useT();
  const money = (value: string) => <bdi className={styles.amount} dir="ltr">{format.money(value, budget.currency)}</bdi>;
  const signed = (value: string) => <bdi className={styles.amount} dir="ltr">{value.startsWith("-") ? "" : "+"}{format.money(value, budget.currency)}</bdi>;
  const overrun = budget.allowances.filter((line) => line.over !== "0.00");
  return <section className={styles.budget} aria-labelledby="portal-budget">
    <h3 className={styles.digestTitle} id="portal-budget">{t("Your budget")}</h3>
    <ul className={styles.budgetRows}>
      <li className={styles.budgetRow}><span>{t("Agreed value")}</span>{money(budget.agreed)}</li>
      {compact ? (budget.changes.length ? <li className={styles.budgetRow}><span>{t("Approved changes")}</span>{signed(budget.changesTotal)}</li> : null)
        : budget.changes.map((change) => <li className={styles.budgetRow} key={`${change.kind}-${change.id}`}>
          <button className={styles.budgetLink} type="button" onClick={() => onOpen(change.kind === "variation" ? { kind: "quote", id: change.id } : { kind: "change", id: change.id })}>
            <bdi>{[change.reference, change.title].filter(Boolean).join(" · ")}</bdi>
          </button>
          {signed(change.amount)}
        </li>)}
      {budget.allowances.length && !compact ? <li className={styles.budgetRow}>
        <span>{t("Allowances: {spent} spent of {included}", { spent: format.money(budget.allowanceSpent, budget.currency), included: format.money(budget.allowanceIncluded, budget.currency) })}</span>
        {budget.allowanceOverrun !== "0.00" ? signed(budget.allowanceOverrun) : <span className={styles.amount}>{t("Within allowance")}</span>}
      </li> : compact && overrun.length ? <li className={styles.budgetRow}><span>{t("Allowance spend over what was included")}</span>{signed(budget.allowanceOverrun)}</li> : null}
      {!compact ? overrun.map((line) => <li className={`${styles.budgetRow} ${styles.budgetSub}`} key={line.lineId}><bdi>{line.title}</bdi>{signed(line.over)}</li>) : null}
      <li className={styles.budgetRow} data-total><span>{t("Forecast final")}</span><span className={styles.forecast}>{money(budget.forecast)}</span></li>
      {budget.pending.length ? <li className={`${styles.budgetRow} ${styles.budgetSub}`}>
        <span>{budget.pending.length === 1 ? t("1 change waiting for your decision") : t("{count} changes waiting for your decision", { count: budget.pending.length })}</span>
        {signed(budget.pendingTotal)}
      </li> : null}
    </ul>
  </section>;
}
