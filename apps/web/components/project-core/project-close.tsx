"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, ControlledModalDialog, ErrorState, Skeleton, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectApi } from "@/lib/project-core/client";
import type { CloseOut, CloseOutDraft } from "@/lib/project-core/types";
import { quantityText } from "../purchasing/order-labels";
import styles from "./project-core.module.css";

const draftHref = (draft: CloseOutDraft) => (draft.kind === "order" ? `/workspace/purchasing/orders?order=${draft.id}` : `/workspace/purchasing/price-requests?request=${draft.id}`);

/**
 * Cancelling a project: what must be settled first (each opens where it's done), what cancelling does
 * by itself, and why. It can't be sent while anything is left half-way.
 */
export function CancelProjectDialog({ api, projectId, onClose, onSave }: { api: ProjectApi; projectId: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [closeOut, setCloseOut] = useState<CloseOut | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    api.closeOut(projectId).then((value) => { if (live) { setCloseOut(value); setError(""); } })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("Could not load.")); });
    return () => { live = false; };
  }, [api, projectId, t, attempt]);
  const draftLabel = (draft: CloseOutDraft) => (draft.kind === "order" ? draft.number : t("Price request {number}", { number: draft.number }));
  const blocked = Boolean(closeOut?.blockers.length);
  const automatic = closeOut ? closeOut.drafts.length + closeOut.heldStock.length + (closeOut.openWork ? 1 : 0) : 0;

  return <ControlledModalDialog isOpen size="md" title={t("Cancel the project")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="danger" isLoading={busy} isDisabled={!closeOut || blocked || !reason.trim()}
        onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{t("Cancel the project")}</Button></div>}>
    {error ? <ErrorState description={error} onRetry={() => setAttempt((value) => value + 1)} /> : !closeOut ? <Skeleton lines={4} /> : <div className={styles.dialogBody}>
      {blocked ? <section className={styles.closeGroup} aria-label={t("Settle these first")}>
        <h3>{t("Settle these first")}</h3>
        <ul className={styles.closeList}>
          {closeOut.owedOrders.map((order) => <li key={order.id}><Link href={`/workspace/purchasing/orders?order=${order.id}`}>{`${order.number} · ${order.supplierName}`}</Link>
            <small>{t("{count} lines still to come", { count: order.lines })}</small></li>)}
          {closeOut.sharedDrafts.map((draft) => <li key={draft.id}><Link href={draftHref(draft)}>{draftLabel(draft)}</Link><small>{t("Take this project's lines off")}</small></li>)}
          {closeOut.inspections.map((receipt) => <li key={receipt.id}><Link href={`/workspace/purchasing/deliveries?receipt=${receipt.id}`}>{t("Delivery {number}", { number: receipt.number })}</Link>
            <small>{t("{order} · waiting for inspection", { order: receipt.orderNumber })}</small></li>)}
          {closeOut.moves.map((transfer) => <li key={transfer.id}><Link href={`/workspace/inventory/moves?move=${transfer.id}`}>{t("Move {number}", { number: transfer.number })}</Link>
            <small>{t("On its way")}</small></li>)}
          {closeOut.siteStock.map((row) => <li key={`${row.itemName}:${row.locationName}`}><Link href="/workspace/inventory">{row.itemName}</Link>
            <small>{t("{quantity} still at {place}", { quantity: `${quantityText(row.quantity)} ${row.unit}`.trim(), place: row.locationName })}</small></li>)}
        </ul>
      </section> : null}
      {automatic ? <section className={styles.closeGroup} aria-label={t("Cancelling also")}>
        <h3>{t("Cancelling also")}</h3>
        <ul className={styles.closeList}>
          {closeOut.drafts.map((draft) => <li key={draft.id}><span>{draftLabel(draft)}</span><small>{t("Cancelled; it was never sent")}</small></li>)}
          {closeOut.openWork ? <li><span>{t("Open work")}</span><small>{t("{count} cancelled", { count: closeOut.openWork })}</small></li> : null}
          {closeOut.heldStock.map((row) => <li key={`${row.itemId}:${row.locationId}`}><span>{row.itemName}</span>
            <small>{t("{quantity} at {place} becomes free stock", { quantity: `${quantityText(row.quantity)} ${row.unit}`.trim(), place: row.locationName })}</small></li>)}
        </ul>
      </section> : null}
      <TextAreaField label={t("Why it's cancelled")} isRequired isDisabled={blocked} value={reason} onChange={setReason} />
    </div>}
  </ControlledModalDialog>;
}

/** Reopening a completed project, with why: its last stage is current again. */
export function ReopenProjectDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Reopen the project")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{t("Reopen")}</Button></div>}>
    <TextAreaField label={t("Why it's reopened")} isRequired value={reason} onChange={setReason} />
  </ControlledModalDialog>;
}
