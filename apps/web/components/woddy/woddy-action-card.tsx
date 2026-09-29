"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Button, Checkbox, InlineNotice, useDesignSystem, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { decideWoddyCard, type WoddyCard, type WoddyCardStatus, type WoddyPreviewField } from "@/lib/woddy/agent";
import styles from "./woddy.module.css";

const STATUS: Record<WoddyCardStatus, { label: MessageKey; tone: StatusTone }> = {
  proposed: { label: tKey("Waiting for you"), tone: "info" },
  confirmed: { label: tKey("Running"), tone: "info" },
  executed: { label: tKey("Done"), tone: "success" },
  rejected: { label: tKey("Cancelled"), tone: "neutral" },
  failed: { label: tKey("Not done"), tone: "danger" },
  expired: { label: tKey("Expired"), tone: "neutral" },
};

/** A value as the card shows it: a time in the workspace's zone and locale, a known label translated, or as it is. */
function useValue() {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  return (value: string | null | undefined, format?: WoddyPreviewField["format"]) => {
    if (!value) return "—";
    if (format === "datetime" && Number.isFinite(Date.parse(value))) return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    if (format === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`));
    return translateKnown(t, value);
  };
}

/** The card's title in the person's language (the key Business Core sent, with its values). */
export function cardTitle(t: Translate, card: Pick<WoddyCard, "title" | "summary">) {
  if (!card.title?.key) return card.summary;
  // A value that is itself a known label (e.g. the kind "Call") is translated too; names stay as they are.
  const values = Object.fromEntries(Object.entries(card.title.values ?? {}).map(([name, value]) => [name, typeof value === "string" ? translateKnown(t, value) : value]));
  return t(card.title.key as MessageKey, values);
}

/**
 * What Woddy prepared, for the person to confirm or cancel: the fields it sets or changes (before and after),
 * every record it applies to (each can be unticked), or the exact text. Nothing changes until Confirm.
 * While it runs the buttons are off; an expired card says so; a refusal shows the module's own message.
 */
export function WoddyActionCard({ workspaceId, card: initial, onChange }: { workspaceId: string; card: WoddyCard; onChange?: (card: WoddyCard) => void }) {
  const t = useT();
  const value = useValue();
  const [card, setCard] = useState(initial);
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const [failure, setFailure] = useState("");
  const items = card.preview.kind === "targets" ? card.preview.items : [];
  const [kept, setKept] = useState<Set<string>>(() => new Set(items.map((item) => item.id)));
  const [timedOut, setTimedOut] = useState(false);
  // An open card turns into "expired" at its time, without a reload.
  useEffect(() => {
    if (card.status !== "proposed") return;
    const timer = setTimeout(() => setTimedOut(true), Math.max(0, Math.min(Date.parse(card.expiresAt) - Date.now(), 2_000_000_000)));
    return () => clearTimeout(timer);
  }, [card.status, card.expiresAt]);
  const status: WoddyCardStatus = busy === "confirm" ? "confirmed" : card.status === "proposed" && timedOut ? "expired" : card.status;
  const recordLabel = card.record ? translateKnown(t, card.target && card.record.id === card.target.id ? card.target.label : card.record.label) : "";
  const open = status === "proposed";
  const selectable = card.preview.kind === "targets" && card.preview.selectable && open;
  const decide = async (decision: "confirm" | "reject") => {
    if (busy) return;
    setBusy(decision); setFailure("");
    try {
      const next = await decideWoddyCard(workspaceId, card, decision, selectable ? items.filter((item) => kept.has(item.id)).map((item) => item.id) : undefined);
      setCard(next); onChange?.(next);
    } catch (error) { setFailure(error instanceof Error ? translateKnown(t, error.message) : t("The action could not be completed.")); }
    finally { setBusy(null); }
  };
  const fields = card.preview.fields;
  return <section className={styles.card} data-status={status} aria-label={t("Woddy action")} aria-busy={Boolean(busy)}>
    <header className={styles.cardHeader}><strong>{cardTitle(t, card)}</strong><Badge tone={STATUS[status].tone}>{t(STATUS[status].label)}</Badge></header>
    {card.preview.kind === "targets" ? <ul className={styles.targets} aria-label={t("Records")}>
      {card.preview.items.map((item) => {
        const text = <span><span>{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}</span>{item.now ? <small>{t("Now: {value}", { value: translateKnown(t, item.now) })}</small> : item.detail ? <small>{item.detail}</small> : null}</span>;
        return <li key={item.id}>{selectable ? <Checkbox aria-label={item.label} isSelected={kept.has(item.id)} isDisabled={Boolean(busy)}
          onChange={(checked) => setKept((current) => { const next = new Set(current); if (checked) next.add(item.id); else next.delete(item.id); return next; })} /> : null}{text}</li>;
      })}
    </ul> : null}
    {card.preview.kind === "text" ? <blockquote className={styles.quote}>{card.preview.text}</blockquote> : null}
    {fields.length ? <dl className={styles.fields}>{fields.map((field) => <div key={field.label}>
      <dt>{translateKnown(t, field.label)}</dt>
      <dd>{field.before !== undefined ? <><span className={styles.before}>{value(field.before, field.format)}</span><ArrowRight aria-label={t("changes to")} size={12} /></> : null}
        <span className={field.before !== undefined ? styles.after : undefined}>{value(field.after, field.format)}</span></dd>
    </div>)}</dl> : null}
    {status === "failed" ? <InlineNotice tone="error" message={translateKnown(t, card.error ?? t("The action could not be completed."))} /> : null}
    {card.failures.length && status !== "failed" ? <ul className={styles.failures}>{card.failures.map((item) => <li key={item.id}>{t("{record}: {reason}", { record: item.label, reason: translateKnown(t, item.message) })}</li>)}</ul> : null}
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    <footer className={styles.cardActions}>
      {status === "expired" ? <p>{t("This suggestion expired. Ask Woddy again.")}</p>
        : status === "rejected" ? <p>{t("Cancelled. Nothing was changed.")}</p>
        : status === "executed" && card.record?.href ? <Link className="wd-button" data-size="compact" data-variant="secondary" href={card.record.href}>{t("Open {record}", { record: recordLabel })}</Link>
        : null}
      {open || status === "confirmed" ? <>
        <Button size="compact" isDisabled={Boolean(busy)} onPress={() => void decide("reject")}>{t("Cancel")}</Button>
        <Button size="compact" variant="primary" isLoading={busy === "confirm"} isDisabled={Boolean(busy) || (selectable && !kept.size)} onPress={() => void decide("confirm")}>{t("Confirm")}</Button>
      </> : null}
    </footer>
  </section>;
}
