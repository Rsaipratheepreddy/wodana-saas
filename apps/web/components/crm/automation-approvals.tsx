"use client";
import { useState } from "react";
import { Button } from "@/design-system";
import { dateText, rows } from "@/lib/crm/client";
import { ActionDialog, FactList, ResourceState, useCrmResource, type ActionSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";

export function AutomationApprovals({ workspaceId }: { workspaceId: string }) {
  const resource = useCrmResource<unknown>(workspaceId, "automation-approvals");
  const [action, setAction] = useState<ActionSpec | null>(null);
  return <div className={styles.workbench}><div className={styles.toolbar}><div><h3>Approvals</h3><p>Review proposed work before an automation can proceed.</p></div><Button size="compact" onPress={resource.refresh}>Refresh approvals</Button></div><ResourceState {...resource} retry={resource.refresh} />
    {rows(resource.data).map((approval) => <section className={styles.section} key={approval.id}><h3>{String(approval.workflowName)}</h3><FactList facts={[["Step", String(approval.stepKey)], ["Expires", approval.expiresAt ? dateText(approval.expiresAt) : "No expiry"]]} /><pre className={styles.message}>{JSON.stringify(approval.proposedAction, null, 2)}</pre><Button size="compact" onPress={() => setAction({ title: "Review approval", description: "Your decision is recorded in the audit history.", path: `automation-approvals/${approval.id}/decision`, initial: { version: approval.version }, fields: [{ key: "decision", label: "Decision", options: [{ id: "approved", label: "Approve the proposed action" }, { id: "rejected", label: "Reject the proposed action" }], required: true }, { key: "reason", label: "Reason", required: true }], submit: "Record decision" })}>Review decision</Button></section>)}
    {!resource.loading && !resource.failure && !rows(resource.data).length ? <p>No pending approvals.</p> : null}
    {action ? <ActionDialog action={action} workspaceId={workspaceId} onClose={() => setAction(null)} onSaved={resource.refresh} /> : null}
  </div>;
}
