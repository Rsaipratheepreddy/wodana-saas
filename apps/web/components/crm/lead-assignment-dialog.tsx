"use client";

import { useId, useRef, useState } from "react";
import { UserRoundPlus } from "lucide-react";
import { Avatar, Button, Callout, ControlledModalDialog, SearchInput } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import type { CrmLeadListItem, CrmWorkspaceMember } from "@/lib/crm/leads";
import styles from "./lead-assignment.module.css";
import { useT } from "@/lib/i18n/i18n-provider";

export function LeadAssignmentDialog({ lead, members, workspaceId, onClose, onSaved }: {
  lead: CrmLeadListItem;
  members: CrmWorkspaceMember[];
  workspaceId: string;
  onClose: () => void;
  onSaved: (result: RecordData) => void | Promise<void>;
}) {
  const t = useT();
  const id = useId();
  const [selected, setSelected] = useState(lead.ownerMembershipId ?? "auto");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState("");
  const inFlight = useRef(false);
  const people = members.filter((member) => member.status === "active" && `${member.displayName} ${member.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const title = lead.ownerMembershipId ? t("Reassign enquiry") : t("Assign enquiry");
  const save = async () => {
    if (inFlight.current || saved) return;
    inFlight.current = true; setBusy(true); setFailure("");
    try {
      const result = await crmRequest(workspaceId,
        selected === "auto" ? `leads/${lead.id}/auto-assign?version=${lead.version}` : `leads/${lead.id}/assign`,
        "POST", selected === "auto" ? {} : { version: lead.version, ownerMembershipId: selected, ...(lead.queueId ? { queueId: lead.queueId } : {}), reason: "Sales owner selected in enquiry assignment" });
      setSaved(true);
      try { await onSaved(result); onClose(); }
      catch { setFailure(t("Assignment saved. Refresh the page to see the updated sales owner.")); }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("The enquiry could not be assigned."));
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <ControlledModalDialog isOpen title={title} description={lead.partyName} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }} footer={<div className={styles.dialogActions}>
    <Button isDisabled={busy} onPress={onClose}>{saved ? t("Close") : t("Cancel")}</Button>
    {!saved ? <Button form={id} type="submit" variant="primary" isLoading={busy} isDisabled={selected === lead.ownerMembershipId}>{lead.ownerMembershipId ? t("Reassign") : t("Assign")}</Button> : null}
  </div>}>
    <form id={id} className={styles.assignmentForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {failure ? <Callout title={saved ? t("Refresh needed") : t("Assignment failed")} tone={saved ? "warning" : "danger"}>{failure}</Callout> : null}
      <SearchInput label={t("Search sales owners")} placeholder={t("Search sales owners…")} value={search} onChange={setSearch} />
      <fieldset className={styles.managerChoices} disabled={busy || saved}>
        <legend className={styles.srOnly}>{t("Sales owner")}</legend>
        <label className={styles.managerOption}>
          <input type="radio" name={id} value="auto" checked={selected === "auto"} onChange={() => setSelected("auto")} />
          <span className={styles.autoAvatar}><UserRoundPlus size={17} aria-hidden="true" /></span><span>{t("Auto-assign")}</span>
        </label>
        <div className={styles.managerList}>
          {people.map((member) => <label className={styles.managerOption} key={member.id}>
            <input type="radio" name={id} value={member.id} checked={selected === member.id} onChange={() => setSelected(member.id)} />
            <Avatar name={member.displayName} size="sm" />
            <span className={styles.person}><strong>{member.displayName}</strong><small>{member.email}</small></span>
            {lead.ownerMembershipId === member.id ? <span className={styles.currentManager}>{t("Current")}</span> : null}
          </label>)}
          {!people.length ? <p className={styles.noManagers}>{t("No matching sales owners.")}</p> : null}
        </div>
      </fieldset>
    </form>
  </ControlledModalDialog>;
}
