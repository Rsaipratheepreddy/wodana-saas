"use client";

import { ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { dateText, label } from "@/lib/crm/client";
import { ResourceState, useCrmResource } from "./crm-workbench";
import styles from "./crm-workbench.module.css";

type Change = { field: string; from: string | null; to: string | null };
type HistoryEvent = { id: string; action: string; at: string; by: string | null; changes: Change[] };

const FIELD_LABELS: Record<string, string> = {
  status: "Stage", ownerMembershipId: "Owner", queueId: "Sales team", nextActionAt: "Next follow-up", serviceType: "Enquiry type",
  source: "Source", channel: "Channel", title: "Title", summary: "Description", priority: "Priority", disqualificationReason: "Reason",
  displayName: "Name", primaryEmail: "Email", primaryMobile: "Mobile", primaryPhone: "Phone",
};

/** PLM-094: every change to this enquiry, its lead and its client — read-only. */
export function ChangeHistory({ workspaceId, leadId, members }: { workspaceId: string; leadId: string; members: Array<{ id: string; displayName: string }> }) {
  const t = useT();
  const resource = useCrmResource<HistoryEvent[]>(workspaceId, `leads/${leadId}/history`);
  const fieldLabel = (field: string) => FIELD_LABELS[field] ?? label(field.split(".").pop() ?? field);
  const value = (field: string, raw: string | null) => {
    if (raw === null) return t("Empty");
    if (field === "ownerMembershipId") return members.find((member) => member.id === raw)?.displayName ?? t("A team member");
    if (field.endsWith("At") && !Number.isNaN(Date.parse(raw))) return dateText(raw);
    return /^[a-z0-9_]+$/.test(raw) ? label(raw) : raw;
  };
  if (!resource.data) return <ResourceState {...resource} retry={resource.refresh} />;
  if (!resource.data.length) return <p className={styles.empty}>{t("No changes yet.")}</p>;
  return <ol aria-label={t("Change history")} className={styles.changeHistory}>
    {resource.data.map((event) => <li key={event.id}>
      <header><strong>{event.by ?? t("Someone")}</strong><small>{dateText(event.at)}</small></header>
      <dl>{event.changes.map((change) => <div key={change.field}>
        <dt>{fieldLabel(change.field)}</dt>
        <dd><span data-old>{value(change.field, change.from)}</span><ArrowRight aria-hidden="true" data-directional="true" size={12} /><span>{value(change.field, change.to)}</span></dd>
      </div>)}</dl>
    </li>)}
  </ol>;
}
