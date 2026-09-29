"use client";

import { useState } from "react";
import { FormDialog, RadioSet, SearchInput } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import type { CrmLeadListItem, CrmWorkspaceMember } from "@/lib/crm/leads";
import styles from "./lead-assignment.module.css";
import { useT } from "@/lib/i18n/i18n-provider";

/** Assign or reassign an enquiry: auto-assignment or one sales owner, found by name or email. */
export function LeadAssignmentDialog({ lead, members, workspaceId, onClose, onSaved }: {
  lead: CrmLeadListItem;
  members: CrmWorkspaceMember[];
  workspaceId: string;
  onClose: () => void;
  onSaved: (result: RecordData) => void | Promise<void>;
}) {
  const t = useT();
  const [selected, setSelected] = useState(lead.ownerMembershipId ?? "auto");
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState("");
  const people = members.filter((member) => member.status === "active" && `${member.displayName} ${member.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const title = lead.ownerMembershipId ? t("Reassign enquiry") : t("Assign enquiry");
  const save = async () => {
    if (saved) return;
    const result = await crmRequest(workspaceId,
      selected === "auto" ? `leads/${lead.id}/auto-assign?version=${lead.version}` : `leads/${lead.id}/assign`,
      "POST", selected === "auto" ? {} : { version: lead.version, ownerMembershipId: selected, ...(lead.queueId ? { queueId: lead.queueId } : {}), reason: "Sales owner selected in enquiry assignment" });
    setSaved(true);
    try { await onSaved(result); onClose(); }
    catch { setFailure(t("Assignment saved. Refresh the page to see the updated sales owner.")); }
  };
  const items = [
    { id: "auto", label: t("Auto-assign") },
    ...people.map((member) => ({ id: member.id, label: member.displayName, description: lead.ownerMembershipId === member.id ? `${member.email} · ${t("Current")}` : member.email })),
  ];
  return <FormDialog cancelLabel={saved ? t("Close") : undefined} description={lead.partyName} error={failure || undefined} errorTitle={t("Refresh needed")} fieldMarkers="none" hideSubmit={saved}
    isSubmitDisabled={selected === lead.ownerMembershipId} onClose={onClose} onSubmit={save} submitLabel={lead.ownerMembershipId ? t("Reassign") : t("Assign")} title={title}>
    <SearchInput label={t("Search sales owners")} placeholder={t("Search sales owners…")} value={search} onChange={setSearch} />
    <div className={styles.managerList}>
      <RadioSet isDisabled={saved} items={items} label={t("Sales owner")} onChange={setSelected} value={selected} />
      {!people.length ? <p className={styles.noManagers}>{t("No matching sales owners.")}</p> : null}
    </div>
  </FormDialog>;
}
