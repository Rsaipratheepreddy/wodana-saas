"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Callout, ControlledModalDialog, DesignSystemProvider, SelectField } from "@/design-system";
import type { PreProjectListItem } from "@/lib/pre-project/types";
import styles from "./start-qualified-lead.module.css";

export function StartQualifiedLead({ workspaceId, lead, onClose, onStarted }: { workspaceId: string; lead: PreProjectListItem; onClose: () => void; onStarted: (id: string) => void }) {
  const id = useId(), inFlight = useRef(false);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [owner, setOwner] = useState(lead.ownerMembershipId ?? "");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/pre-projects/start-options?workspaceId=${workspaceId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Lead managers could not be loaded."); if (!controller.signal.aborted) { setMembers(data.members); setLoading(false); } })
      .catch((error) => { if (!controller.signal.aborted) { setFailure(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [workspaceId, attempt]);
  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    {portalContainer ? <ControlledModalDialog isOpen title="Start planning" description={`${lead.customerName} · ${lead.title}`} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }} footer={<div className={styles.actions}><Button isDisabled={busy} onPress={onClose}>Cancel</Button><Button type="submit" form={id} variant="primary" isDisabled={loading || !members.some((member) => member.id === owner) || !date} isLoading={busy}>Start planning</Button></div>}>
      <form id={id} className={styles.form} onSubmit={async (event) => {
        event.preventDefault(); if (inFlight.current) return; inFlight.current = true; setBusy(true); setFailure("");
        try {
          const response = await fetch(`/api/workspace/pre-projects/from-lead?workspaceId=${workspaceId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: lead.leadId, version: lead.leadVersion, ownerMembershipId: owner, nextActionAt: new Date(date).toISOString() }), signal: AbortSignal.timeout(20_000) });
          const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Planning could not be started.");
          if (!result.id) throw new Error("The planning could not be confirmed. Refresh the table before retrying.");
          onStarted(result.id);
        } catch (error) { setFailure(error instanceof Error ? error.message : "Planning could not be started."); inFlight.current = false; setBusy(false); }
      }}>
        {failure ? <Callout title="Could not start planning" tone="warning">{failure}{!members.length ? <Button size="compact" isDisabled={loading} onPress={() => { setLoading(true); setFailure(""); setAttempt((n) => n + 1); }}>Retry</Button> : null}</Callout> : null}
        {loading ? <p role="status">Loading lead managers…</p> : <>
          {!members.length && !failure ? <p>No active lead managers. Ask an administrator to add a workspace member.</p> : null}
          <SelectField label="Lead manager" isRequired isDisabled={busy} selectedKey={members.some((member) => member.id === owner) ? owner : null} onSelectionChange={(key) => setOwner(String(key ?? ""))} items={members.map((member) => ({ id: member.id, label: member.name }))} />
          <label className={styles.date}><span>Next follow-up (your local time) *</span><input type="datetime-local" required disabled={busy} value={date} onChange={(event) => setDate(event.target.value)} /></label>
        </>}
      </form>
    </ControlledModalDialog> : null}
  </DesignSystemProvider>;
}
