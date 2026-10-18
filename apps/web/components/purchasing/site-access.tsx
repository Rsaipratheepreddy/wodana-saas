"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Badge, Button, Checkbox, ControlledModalDialog, DateField, InlineNotice, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { SiteAccess } from "@/lib/purchasing/types";
import type { SiteApi } from "@/lib/site/client";
import { useProjectFormat } from "../project-core/format";
import styles from "./site-access.module.css";

/** Whether the client confirmed site access for the delivery day (D-29), as a written state with its tone. */
export function SiteAccessBadge({ access }: { access: SiteAccess }) {
  const t = useT();
  if (access.status === "confirmed") return <Badge tone="success">{t("Access confirmed")}</Badge>;
  if (access.status === "move_asked") return <Badge tone="danger">{t("Client asked to move")}</Badge>;
  return <Badge tone="warning">{t("Access to confirm")}</Badge>;
}

/**
 * A delivery's site access for the project manager or a buyer: what the client said, then either record that the client
 * confirmed (by phone) or move the delivery to a new day with why, and whether the new delivery is charged.
 */
export function SiteAccessDialog({ access, orderNumber, api, today, onClose, onChanged }: {
  access: SiteAccess; orderNumber: string; api: SiteApi; today: string; onClose: () => void; onChanged: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [date, setDate] = useState(access.clientDate ?? "");
  const [reason, setReason] = useState(access.clientReason ?? "");
  const [chargeable, setChargeable] = useState(false);
  const [busy, setBusy] = useState<"confirm" | "reschedule" | null>(null);
  const [error, setError] = useState("");
  const run = async (action: "confirm" | "reschedule") => {
    setBusy(action); setError("");
    try {
      await api.arrangeAccess(access.id, action === "confirm" ? { action, version: access.version } : { action, version: access.version, date, reason: reason.trim(), chargeable });
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(null); }
  };
  const canMove = Boolean(date) && date >= today && date !== access.date && Boolean(reason.trim());
  return <ControlledModalDialog isOpen size="md" title={t("Site access for {date}", { date: format.day(access.date) })} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      {access.status !== "confirmed" ? <Button isLoading={busy === "confirm"} isDisabled={Boolean(busy)} onPress={() => void run("confirm")}>{t("Client confirmed")}</Button> : null}
      <Button variant="primary" isLoading={busy === "reschedule"} isDisabled={Boolean(busy) || !canMove} onPress={() => void run("reschedule")}>{t("Move delivery")}</Button></div>}>
    <div className={styles.body}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <div className={styles.facts}>
        <span><SiteAccessBadge access={access} /></span>
        <span dir="auto">{`${orderNumber} · ${access.items}`}</span>
        {access.status === "move_asked" && access.clientReason ? <span dir="auto">{t("Why: {reason}", { reason: access.clientReason })}</span> : null}
        {access.status === "move_asked" && access.clientDate ? <span>{t("Suits them: {date}", { date: format.day(access.clientDate) })}</span> : null}
        {access.answeredBy && access.status !== "waiting" ? <span>{t("By {name}", { name: access.answeredBy })}</span> : null}
        {access.movedFrom ? <span dir="auto">{t("Moved from {date}: {reason}", { date: format.day(access.movedFrom), reason: access.moveReason ?? "" })}{access.chargeable ? ` · ${t("Charged")}` : ""}</span> : null}
      </div>
      <DateField label={t("New day")} minValue={parseDate(today)} value={date ? parseDate(date) : null} onChange={(value) => setDate(value ? value.toString() : "")} />
      <TextAreaField label={t("Why it moves")} value={reason} onChange={setReason} maxLength={500} />
      <Checkbox isSelected={chargeable} onChange={setChargeable}>{t("The new delivery is charged")}</Checkbox>
    </div>
  </ControlledModalDialog>;
}
