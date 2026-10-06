"use client";

import { useState } from "react";
import { Button, InlineNotice, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalChange } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import { StateLabel } from "../portal-labels";
import home from "../portal-home.module.css";
import styles from "../portal.module.css";
import { ConfirmCode } from "./confirm-code";

/**
 * A change request at the version the team sent (plan §6.20, R11): what changes, line by line, and what it does to the
 * price and the handover date. The decision-maker approves it with a code bound to exactly this change, or declines it
 * saying why (the team then raises a new one with a fresh assessment). A change the client asked for shows as being
 * with the team until it is assessed.
 */
export function ChangeSheet({ change, caseId, api, format, channels, onDecided }: {
  change: PortalChange; caseId: string; api: PortalApi; format: PortalFormat; channels: Array<"whatsapp" | "email">; onDecided: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"read" | "confirm" | "decline">("read");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const actions: Record<PortalChange["lines"][number]["action"], string> = { add: t("Add"), omit: t("Remove"), replace: t("Replace"), draw: t("From allowance") };
  const money = (value: string | null) => (value === null || !change.currency ? "" : format.money(value, change.currency));
  const signed = (value: string | null) => (value === null ? "" : `${value.startsWith("-") ? "" : "+"}${money(value)}`);
  if (mode === "confirm") return <ConfirmCode api={api} channels={channels} purpose={`change:${caseId}:${change.id}:accept`} confirmLabel={t("Approve change")} onBack={() => setMode("read")}
    onConfirm={async (proof) => { await api.command(id, { action: "change_decision", caseId, changeId: change.id, decision: "accept", version: change.version, ...proof }); onDecided(); }} />;
  const decline = async () => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "change_decision", caseId, changeId: change.id, decision: "decline", version: change.version, note: note.trim() }); onDecided(); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  const days = change.timeImpactDays ?? 0;
  return <div className={styles.sheet}>
    <div className={styles.rowHead}><StateLabel state={change.status} canDecide={change.canDecide} />
      {change.decidedAt ? <span className={styles.muted}>{t("{name} decided on {date}.", { name: change.decidedBy ?? "", date: format.date(change.decidedAt) })}</span> : null}</div>
    {change.description ? <p className={styles.body} dir="auto">{change.description}</p> : null}
    {change.status === "with_team" ? <p className={styles.muted}>{t("Your project team is working out what this changes. You'll decide once they send it.")}</p> : null}
    {change.lines.length ? <ul className={home.lines} aria-label={t("What changes")}>{change.lines.map((line) => <li className={home.line} key={line.id}>
      <span className={styles.itemText}>
        <span className={styles.itemTitle} dir="auto">{actions[line.action]}: {line.title}</span>
        <span className={styles.itemMeta}>{[line.room, line.quantity ? `${format.number(line.quantity)} ${line.unit}`.trim() : "", line.unitPrice ? money(line.unitPrice) : ""].filter(Boolean).join(" · ")}</span>
      </span>
      <bdi className={home.amount} dir="ltr">{signed(line.amount)}</bdi>
    </li>)}</ul> : null}
    {change.priceImpact !== null ? <dl className={home.impact}>
      <dt>{t("Price")}</dt><dd><bdi dir="ltr">{signed(change.priceImpact)}</bdi></dd>
      <dt>{t("Handover")}</dt><dd>{days && change.handoverAfter
        ? t("{before} → {after} ({days} working days)", { before: format.date(change.handoverBefore), after: format.date(change.handoverAfter), days: `${days > 0 ? "+" : ""}${days}` })
        : change.handoverBefore ? t("{date}, unchanged", { date: format.date(change.handoverBefore) }) : t("No change")}</dd>
      {change.designImpact ? <><dt>{t("Design")}</dt><dd dir="auto">{change.designImpact}</dd></> : null}
    </dl> : null}
    {change.status === "declined" && change.declineNote ? <p className={styles.body} dir="auto">{change.declineNote}</p> : null}
    {change.signed ? <a className={styles.textButton} href={api.file("change", change.id)} rel="noreferrer" target="_blank">{t("Signed copy")}</a> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {change.canDecide ? mode === "decline" ? <>
      <TextAreaField label={t("Why are you declining it?")} value={note} onChange={setNote} maxLength={2000} isRequired autoFocus />
      <div className={styles.choices}>
        <Button onPress={() => setMode("read")} isDisabled={busy}>{t("Back")}</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={() => void decline()}>{t("Decline change")}</Button>
      </div>
    </> : <div className={styles.choices}>
      <Button onPress={() => setMode("decline")}>{t("Decline")}</Button>
      <Button variant="primary" onPress={() => setMode("confirm")}>{t("Approve change")}</Button>
    </div> : null}
  </div>;
}
