"use client";

import { useId, useRef, useState } from "react";
import { UserRoundPlus } from "lucide-react";
import { Avatar, Button, Callout, ControlledModalDialog, SearchInput } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import type { CrmLeadListItem, CrmWorkspaceMember } from "@/lib/crm/leads";
import styles from "./lead-assignment.module.css";

export function LeadAssignmentDialog({ lead, members, workspaceId, onClose, onSaved }: {
  lead: CrmLeadListItem;
  members: CrmWorkspaceMember[];
  workspaceId: string;
  onClose: () => void;
  onSaved: (result: RecordData) => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState(lead.ownerMembershipId ?? "auto");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState("");
  const inFlight = useRef(false);
  const people = members.filter((member) => member.status === "active" && `${member.displayName} ${member.email}`.toLowerCase().includes(search.trim().toLowerCase()));
  const title = lead.ownerMembershipId ? "Reassign lead" : "Assign lead";
  const save = async () => {
    if (inFlight.current || saved) return;
    inFlight.current = true; setBusy(true); setFailure("");
    try {
      const result = await crmRequest(workspaceId,
        selected === "auto" ? `leads/${lead.id}/auto-assign?version=${lead.version}` : `leads/${lead.id}/assign`,
        "POST", selected === "auto" ? {} : { version: lead.version, ownerMembershipId: selected, ...(lead.queueId ? { queueId: lead.queueId } : {}), reason: "Lead manager reassigned from the leads table" });
      setSaved(true);
      try { onSaved(result); onClose(); }
      catch { setFailure("Assignment saved. Refresh the page to see the updated lead manager."); }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The lead could not be assigned.");
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <ControlledModalDialog isOpen title={title} description={lead.partyName} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }} footer={<div className={styles.dialogActions}>
    <Button isDisabled={busy} onPress={onClose}>{saved ? "Close" : "Cancel"}</Button>
    {!saved ? <Button form={id} type="submit" variant="primary" isLoading={busy} isDisabled={selected === lead.ownerMembershipId}>{lead.ownerMembershipId ? "Reassign" : "Assign"}</Button> : null}
  </div>}>
    <form id={id} className={styles.assignmentForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {failure ? <Callout title={saved ? "Refresh needed" : "Assignment failed"} tone={saved ? "warning" : "danger"}>{failure}</Callout> : null}
      <SearchInput label="Search lead managers" placeholder="Search lead managers…" value={search} onChange={setSearch} />
      <fieldset className={styles.managerChoices} disabled={busy || saved}>
        <legend className={styles.srOnly}>Lead manager</legend>
        <label className={styles.managerOption}>
          <input type="radio" name={id} value="auto" checked={selected === "auto"} onChange={() => setSelected("auto")} />
          <span className={styles.autoAvatar}><UserRoundPlus size={17} aria-hidden="true" /></span><span>Auto-assign</span>
        </label>
        <div className={styles.managerList}>
          {people.map((member) => <label className={styles.managerOption} key={member.id}>
            <input type="radio" name={id} value={member.id} checked={selected === member.id} onChange={() => setSelected(member.id)} />
            <Avatar name={member.displayName} size="sm" />
            <span className={styles.person}><strong>{member.displayName}</strong><small>{member.email}</small></span>
            {lead.ownerMembershipId === member.id ? <span className={styles.currentManager}>Current</span> : null}
          </label>)}
          {!people.length ? <p className={styles.noManagers}>No matching lead managers.</p> : null}
        </div>
      </fieldset>
    </form>
  </ControlledModalDialog>;
}
