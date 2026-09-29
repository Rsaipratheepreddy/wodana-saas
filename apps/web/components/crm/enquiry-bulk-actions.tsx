"use client";

import { useState } from "react";
import { Button, ControlledModalDialog, InlineNotice, SelectField, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { salesOwnerChoices, type CrmLeadListItem, type LeadsPageData } from "@/lib/crm/leads";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import { CrmDateTimeField } from "./crm-date-time-field";
import styles from "./leads-page.module.css";

export type BulkMode = "assign" | "status" | "follow_up" | "close";
const STATUSES: Array<[string, MessageKey]> = [["attempting_contact", tKey("Contacting")], ["connected", tKey("Connected")], ["nurturing", tKey("Nurturing")]];
const OPEN = (lead: CrmLeadListItem) => !lead.isConverted && !["qualified", "disqualified", "duplicate"].includes(lead.status);

/** One enquiry's command for a bulk action: the same endpoint (and permission and version check) as doing it on one. */
export function bulkRequest(mode: BulkMode, lead: CrmLeadListItem, value: { owner?: string; status?: string; title?: string; dueAt?: string; reason?: string }):
  [path: string, body: Record<string, unknown>] {
  if (mode === "assign") return [`leads/${lead.id}/assign`, { version: lead.version, ownerMembershipId: value.owner, reason: "Reassigned in bulk" }];
  if (mode === "status") return [`leads/${lead.id}/status`, { version: lead.version, status: value.status, ...(lead.nextActionAt ? { nextActionAt: lead.nextActionAt } : {}) }];
  if (mode === "close") return [`leads/${lead.id}/status`, { version: lead.version, status: "disqualified", reason: value.reason }];
  return ["activities", { leadId: lead.id, type: "task", title: value.title, dueAt: value.dueAt, priority: "normal", customerVisible: false, isNextAction: OPEN(lead),
    ...(lead.ownerMembershipId ? { ownerMembershipId: lead.ownerMembershipId } : {}) }];
}

/** The bulk bar's buttons (S-17): each opens one short form, applied to every selected enquiry. */
export function EnquiryBulkActions({ rows, onPick }: { rows: CrmLeadListItem[]; onPick: (mode: BulkMode, rows: CrmLeadListItem[]) => void }) {
  const t = useT();
  return <span className={styles.bulkActions}>
    <Button size="compact" onPress={() => onPick("assign", rows)}>{t("Assign to…")}</Button>
    <Button size="compact" onPress={() => onPick("status", rows)}>{t("Change status")}</Button>
    <Button size="compact" onPress={() => onPick("follow_up", rows)}>{t("Add follow-up")}</Button>
    <Button size="compact" variant="danger" onPress={() => onPick("close", rows)}>{t("Close")}</Button>
  </span>;
}

/**
 * Applies one action to many enquiries, one at a time through each enquiry's own command, so every permission and
 * version check still holds per item; the ones refused say why and the rest are done.
 */
export function EnquiryBulkDialog({ mode, rows, initialData, onClose, onDone }: {
  mode: BulkMode; rows: CrmLeadListItem[]; initialData: LeadsPageData; onClose: () => void; onDone: (summary: string) => Promise<void>;
}) {
  const t = useT();
  const { timeZone } = useDesignSystem();
  const owners = salesOwnerChoices(initialData);
  const [owner, setOwner] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([]);
  const targets = mode === "follow_up" ? rows : rows.filter(OPEN);
  const ready = mode === "assign" ? Boolean(owner) : mode === "status" ? Boolean(status) : mode === "close" ? Boolean(reason.trim()) : Boolean(title.trim() && due);
  const heading: Record<BulkMode, MessageKey> = { assign: tKey("Assign {count} enquiries"), status: tKey("Change the status of {count} enquiries"), follow_up: tKey("Add a follow-up to {count} enquiries"), close: tKey("Close {count} enquiries") };

  const apply = async () => {
    setBusy(true); setFailures([]);
    const [date, time = ""] = due.split("T");
    const dueAt = mode === "follow_up" && date && time ? zonedToUtc(date, time.slice(0, 5), timeZone) ?? undefined : undefined;
    const failed: Array<{ name: string; message: string }> = [];
    let done = 0;
    for (const lead of targets) {
      const [path, body] = bulkRequest(mode, lead, { owner: owner ?? undefined, status: status ?? undefined, title: title.trim(), dueAt, reason: reason.trim() });
      try { await crmRequest(initialData.workspaceId, path, "POST", body); done += 1; }
      catch (error) { failed.push({ name: lead.partyName, message: error instanceof Error ? translateKnown(t, error.message) : t("Could not save.") }); }
    }
    setBusy(false);
    if (failed.length) { setFailures(failed); if (done) await onDone(t("{done} done · {failed} not changed", { done, failed: failed.length })); return; }
    await onDone(t("{count} enquiries updated.", { count: done }));
    onClose();
  };

  return <ControlledModalDialog isOpen size="md" title={t(heading[mode], { count: targets.length })} onOpenChange={(open) => { if (!open && !busy) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{failures.length ? t("Close") : t("Cancel")}</Button>
      {failures.length ? null : <Button variant={mode === "close" ? "danger" : "primary"} isLoading={busy} isDisabled={!ready || !targets.length} onPress={() => void apply()}>{t("Apply to {count}", { count: targets.length })}</Button>}</div>}>
    <div className={styles.bulkForm}>
      {targets.length < rows.length ? <InlineNotice tone="info" message={t("{count} already closed or converted are left as they are.", { count: rows.length - targets.length })} /> : null}
      {mode === "assign" ? <SelectField label={t("Owner")} isRequired placeholder={t("Choose someone")} selectedKey={owner} onSelectionChange={(key) => setOwner(key ? String(key) : null)}
        items={owners.map((member) => ({ id: member.id, label: member.displayName }))} /> : null}
      {mode === "status" ? <SelectField label={t("Status")} isRequired placeholder={t("Choose a status")} selectedKey={status} onSelectionChange={(key) => setStatus(key ? String(key) : null)}
        items={STATUSES.map(([id, label]) => ({ id, label: t(label) }))} /> : null}
      {mode === "follow_up" ? <>
        <TextInput label={t("Follow-up")} isRequired value={title} onChange={setTitle} maxLength={240} placeholder={t("Call back")} />
        <CrmDateTimeField label={t("Due")} isRequired value={due} onChange={setDue} />
      </> : null}
      {mode === "close" ? <TextAreaField label={t("Why they're closed")} isRequired value={reason} onChange={setReason} maxLength={160} /> : null}
      {failures.length ? <InlineNotice tone="error" message={<ul className={styles.bulkFailures}>{failures.map((item, index) => <li key={index}><strong>{item.name}</strong> · {item.message}</li>)}</ul>} /> : null}
    </div>
  </ControlledModalDialog>;
}
