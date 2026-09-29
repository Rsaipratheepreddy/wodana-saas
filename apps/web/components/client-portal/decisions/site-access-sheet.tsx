"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, DateField, InlineNotice, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalSiteAccess } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "../portal.module.css";

/**
 * A delivery to the client's site (D-29): what's coming on which day, then "Confirm" (someone lets the team in) or
 * "Ask to move" with why and a day that suits.
 */
export function SiteAccessSheet({ delivery, caseId, api, format, today, onDone }: {
  delivery: PortalSiteAccess; caseId: string; api: PortalApi; format: PortalFormat; today: string; onDone: (decision: "confirm" | "move") => void;
}) {
  const t = useT();
  const [moving, setMoving] = useState(delivery.status === "move_asked");
  const [reason, setReason] = useState(delivery.clientReason ?? "");
  const [preferred, setPreferred] = useState(delivery.clientDate ?? "");
  const [busy, setBusy] = useState<"confirm" | "move" | null>(null);
  const [error, setError] = useState("");
  // One command id per decision, so a retry after a dropped connection isn't taken twice.
  const [ids] = useState(() => ({ confirm: commandId(), move: commandId() }));
  const send = async (decision: "confirm" | "move") => {
    setBusy(decision); setError("");
    try {
      await api.command(ids[decision], { action: "site_access", caseId, requestId: delivery.id, decision, version: delivery.version,
        ...(decision === "move" ? { reason: reason.trim(), preferredDate: preferred || null } : {}) });
      onDone(decision);
    } catch (cause) { setError((cause as Error).message); setBusy(null); }
  };
  return <div className={styles.sheet}>
    <p className={styles.body} dir="auto">{delivery.items}</p>
    {delivery.movedFrom ? <p className={styles.muted} dir="auto">{t("Moved from {date}: {reason}", { date: format.date(delivery.movedFrom), reason: delivery.moveReason ?? "" })}
      {delivery.chargeable ? ` · ${t("The new delivery is charged.")}` : ""}</p> : null}
    {delivery.status === "confirmed" ? <p className={styles.muted}>{t("You confirmed someone will let the team in.")}</p> : null}
    {delivery.status === "move_asked" ? <p className={styles.muted}>{t("You asked to move it. Your project team will come back with a new day.")}</p> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {moving ? <>
      <TextAreaField label={t("Why doesn't the day work?")} isRequired value={reason} onChange={setReason} maxLength={500} />
      <DateField label={t("A day that suits you (optional)")} minValue={parseDate(today)} value={preferred ? parseDate(preferred) : null}
        onChange={(value) => setPreferred(value ? value.toString() : "")} />
      <div className={styles.choices}>
        <Button onPress={() => setMoving(false)} isDisabled={Boolean(busy)}>{t("Back")}</Button>
        <Button variant="primary" isLoading={busy === "move"} isDisabled={Boolean(busy) || !reason.trim()} onPress={() => void send("move")}>{t("Send")}</Button>
      </div>
    </> : <div className={styles.choices}>
      <Button onPress={() => setMoving(true)} isDisabled={Boolean(busy)}>{t("Ask to move")}</Button>
      {delivery.status !== "confirmed" ? <Button variant="primary" isLoading={busy === "confirm"} isDisabled={Boolean(busy)} onPress={() => void send("confirm")}>{t("Confirm")}</Button> : null}
    </div>}
  </div>;
}
