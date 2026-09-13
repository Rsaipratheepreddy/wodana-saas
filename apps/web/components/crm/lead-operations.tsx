"use client";
import { useEffect, useState } from "react";
import { Avatar, Badge, Button, InspectorSheet, SelectField, Tabs } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import { crmRequest, dateText, label, rows, type RecordData } from "@/lib/crm/client";
import { ActionDialog, ResourceState, choice, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";
import assignmentStyles from "./lead-assignment.module.css";

export function LeadRouting({ initialData }: { initialData: LeadsPageData }) {
  const { workspaceId } = initialData;
  const [queues, setQueues] = useState(initialData.queues);
  const [policies, setPolicies] = useState(initialData.assignmentPolicies);
  const [queueId, setQueueId] = useState(initialData.queues.find((queue) => queue.isFallback)?.id ?? initialData.queues[0]?.id ?? "");
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [addingDefaults, setAddingDefaults] = useState(false);
  const [notice, setNotice] = useState("");
  const queue = queues.find((item) => item.id === queueId) ?? queues[0];
  const queueOptions = queues.map((item) => ({ id: item.id, label: item.name }));
  const refresh = async () => {
    const [nextQueues, nextPolicies] = await Promise.all([
      crmRequest<typeof queues>(workspaceId, "queues"),
      crmRequest<typeof policies>(workspaceId, "assignment-policies"),
    ]);
    setQueues(nextQueues);
    setPolicies(nextPolicies);
  };
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      crmRequest<typeof queues>(workspaceId, "queues", "GET", undefined, controller.signal),
      crmRequest<typeof policies>(workspaceId, "assignment-policies", "GET", undefined, controller.signal),
    ]).then(([nextQueues, nextPolicies]) => {
      if (!controller.signal.aborted) { setQueues(nextQueues); setPolicies(nextPolicies); setLoading(false); }
    }).catch((error: Error) => {
      if (!controller.signal.aborted) { setFailure(error.message); setLoading(false); }
    });
    return () => controller.abort();
  }, [workspaceId]);
  const editPolicy = (policy?: typeof policies[number]) => setAction({
    title: policy ? "Edit auto-assignment" : "Add auto-assignment",
    path: policy ? `assignment-policies/${policy.id}` : "assignment-policies",
    method: policy ? "PATCH" : "POST",
    initial: policy ? { version: policy.version, name: policy.name, priority: policy.priority, fallbackQueueId: policy.fallbackQueueId, preserveRelationshipOwner: policy.preserveRelationshipOwner, status: policy.status } : { priority: 10, fallbackQueueId: queue?.id, preserveRelationshipOwner: true },
    fields: [
      { key: "name", label: "Name", required: true },
      { key: "priority", label: "Order (lowest first)", type: "number", min: 0, max: 100000, required: true },
      { key: "fallbackQueueId", label: "Default queue", options: queueOptions, required: true },
      ...(policy ? [{ key: "status", label: "Status", options: choice(["active", "archived"]), required: true }] : []),
      { key: "preserveRelationshipOwner", label: "Keep the existing customer lead manager", type: "checkbox" },
    ],
  });
  const editMember = (member?: NonNullable<typeof queue>["members"][number]) => {
    if (!queue) return;
    setAction({
      title: member ? "Edit lead manager" : "Add lead manager",
      path: `queues/${queue.id}/members`, method: "PUT",
      initial: member ? { membershipId: member.membershipId, capacity: member.capacity, weight: member.weight, isAvailable: member.isAvailable, skills: member.skills, languages: member.languages, territories: member.territories, ...(member.unavailableUntil ? { unavailableUntil: member.unavailableUntil } : {}) } : { capacity: 25, weight: 1, isAvailable: true },
      fields: [
        ...(!member ? [{ key: "membershipId", label: "Lead manager", options: initialData.members.filter((person) => person.status === "active" && !queue.members.some((existing) => existing.membershipId === person.id)).map((person) => ({ id: person.id, label: person.displayName })), required: true }] : []),
        { key: "capacity", label: "Maximum active leads", type: "number", min: 1, max: 10000, required: true },
        { key: "weight", label: "Assignment weight", type: "number", min: 1, max: 100, required: true },
        { key: "isAvailable", label: "Available for auto-assignment", type: "checkbox" },
        ...(member?.unavailableUntil ? [{ key: "unavailableUntil", label: "Unavailable until", type: "datetime-local" as const }] : []),
      ],
    });
  };
  const activeRules = policies.flatMap((policy) => policy.rules.filter((rule) => rule.status === "active").map((rule) => ({ policy, rule })))
    .sort((a, b) => a.policy.priority - b.policy.priority || a.rule.priority - b.rule.priority);

  if (loading || failure) return <ResourceState loading={loading} failure={failure} retry={() => {
    setLoading(true); setFailure("");
    void refresh().catch((error: Error) => setFailure(error.message)).finally(() => setLoading(false));
  }} />;
  const conditionFields: FieldSpec[] = [
    { key: "source", label: "Source", options: [{ id: "", label: "Any source" }, ...(initialData.leadOptions?.sources ?? [])] },
    { key: "channel", label: "Channel", options: [{ id: "", label: "Any channel" }, ...Array.from(new Map(Object.values(initialData.leadOptions?.channels ?? {}).flat().map(option => [option.id, option])).values())] },
    { key: "intakeMethod", label: "Intake method", options: [{ id: "", label: "Any intake" }, ...choice(["form", "manual", "automated", "import", "api", "webhook"])] },
    { key: "serviceType", label: "Enquiry type", options: [{ id: "", label: "Any enquiry type" }, ...(initialData.leadOptions?.enquiryTypes ?? [])] },
  ];
  const conditionsFrom = (values: Record<string, unknown>) => Object.fromEntries(conditionFields.filter(field => values[field.key]).map(field => [field.key, values[field.key]]));
  return <section aria-label="Auto-assignment configuration" className={assignmentStyles.page}>
    <Tabs defaultSelectedKey="managers" items={[{ id: "managers", label: "Lead managers", panel: <section aria-label="Lead managers">
      <header className={assignmentStyles.toolbar}>
        <h2>Lead managers</h2>
        <div className={assignmentStyles.actions}>
          {queues.length ? <div className={assignmentStyles.queue}><SelectField label="Queue" selectedKey={queue?.id ?? null} onSelectionChange={(key) => setQueueId(String(key))} items={queueOptions} /></div> : null}
          <Button size="compact" isDisabled={!queue || addingDefaults} isLoading={addingDefaults} onPress={async () => { if (!queue || addingDefaults) return; setAddingDefaults(true); setFailure(''); setNotice(''); try { const result = await crmRequest<{added:number}>(workspaceId, `queues/${queue.id}/default-managers`, 'POST', {}); await refresh(); setNotice(result.added ? `${result.added} default lead managers added.` : 'Default lead managers are already included.'); } catch(error) { setFailure((error as Error).message); } finally { setAddingDefaults(false); } }}>Add default managers</Button>
          <Button size="compact" onPress={() => setAction({ title: "Add queue", path: "queues", initial: { isFallback: queues.length === 0 }, fields: [{ key: "name", label: "Name", required: true }, { key: "code", label: "Code", required: true }, { key: "isFallback", label: "Default queue", type: "checkbox" }] })}>Add queue</Button>
          <Button size="compact" isDisabled={!queue || !initialData.members.some((person) => person.status === "active" && !queue.members.some((existing) => existing.membershipId === person.id))} onPress={() => editMember()}>Add lead manager</Button>
        </div>
      </header>
      {notice ? <p role="status">{notice}</p> : null}
      <div className={assignmentStyles.tableScroll} role="region" aria-label="Lead managers table" tabIndex={0}><table data-record-table="" className={assignmentStyles.table} aria-label="Assignment lead managers">
        <thead><tr><th scope="col">Lead manager</th><th scope="col">Capacity</th><th scope="col">Weight</th><th scope="col">Availability</th><th scope="col">Action</th></tr></thead>
        <tbody>{queue?.members.map((member) => <tr key={member.membershipId}>
          <td><span className={assignmentStyles.personCell}><Avatar name={member.name} size="sm" />{member.name}</span></td><td>{member.capacity}</td><td>{member.weight}</td>
          <td>{member.isAvailable && (!member.unavailableUntil || Date.parse(member.unavailableUntil) <= Date.parse(initialData.referenceTime)) ? "Available" : "Unavailable"}{member.unavailableUntil ? <small>Away until {dateText(member.unavailableUntil)}</small> : null}</td>
          <td><Button aria-label={`Edit ${member.name}`} size="compact" variant="quiet" onPress={() => editMember(member)}>Edit</Button></td>
        </tr>)}{!queue?.members.length ? <tr><td colSpan={5}>No lead managers in this queue.</td></tr> : null}</tbody>
      </table></div>
    </section> }, { id: "order", label: "Routing order", panel: <section aria-label="Routing order">
      <header className={assignmentStyles.toolbar}><h2>Routing order</h2><Button size="compact" isDisabled={!queues.length} onPress={() => editPolicy()}>Add auto-assignment</Button></header>
      <div className={assignmentStyles.tableScroll} role="region" aria-label="Routing order table" tabIndex={0}><table data-record-table="" className={assignmentStyles.table} aria-label="Auto-assignment routing order">
        <thead><tr><th scope="col">Order</th><th scope="col">Name</th><th scope="col">Default queue</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
        <tbody>{[...policies].sort((a, b) => a.priority - b.priority).map((policy) => <tr key={policy.id}>
          <td>{policy.priority}</td><td>{policy.name}</td><td>{queues.find((item) => item.id === policy.fallbackQueueId)?.name ?? "Unavailable queue"}</td><td><Badge tone={policy.status === "active" ? "success" : "neutral"}>{label(policy.status)}</Badge></td>
          <td><Button aria-label={`Edit ${policy.name}`} size="compact" variant="quiet" onPress={() => editPolicy(policy)}>Edit</Button></td>
        </tr>)}{!policies.length ? <tr><td colSpan={5}>No auto-assignment configured.</td></tr> : null}</tbody>
      </table></div>
    </section> }, { id: "rules", label: "Routing rules", panel: <section aria-label="Routing rules">
      <div className={assignmentStyles.toolbar}><span>Match leads to a specific queue.</span><Button size="compact" isDisabled={!policies.some((policy) => policy.status === "active") || !queues.length} onPress={() => setAction({
        title: "Add routing rule", path: (values) => `assignment-policies/${values.policyId}`, method: "PATCH",
        initial: { policyId: policies.find((policy) => policy.status === "active")?.id, priority: 10 },
        fields: [{ key: "policyId", label: "Auto-assignment", options: policies.filter((policy) => policy.status === "active").map((policy) => ({ id: policy.id, label: policy.name })), required: true }, { key: "name", label: "Rule name", required: true }, { key: "priority", label: "Order (lowest first)", type: "number", min: 0, max: 100000, required: true }, ...conditionFields, { key: "queueId", label: "Assign to queue", options: queueOptions, required: true }],
        transform: (values) => {
          const policy = policies.find((item) => item.id === values.policyId)!;
          return { version: policy.version, rules: [...policy.rules.filter((rule) => rule.status === "active").map(({ name, priority, queueId, conditions }) => ({ name, priority, queueId, conditions })), { name: values.name, priority: values.priority, queueId: values.queueId, conditions: conditionsFrom(values) }] };
        },
      })}>Add rule</Button></div>
      <div className={assignmentStyles.tableScroll} role="region" aria-label="Routing rules table" tabIndex={0}><table data-record-table="" className={assignmentStyles.table} aria-label="Routing rules">
        <thead><tr><th scope="col">Order</th><th scope="col">Rule</th><th scope="col">Match</th><th scope="col">Queue</th><th scope="col">Action</th></tr></thead>
        <tbody>{activeRules.map(({ policy, rule }) => <tr key={rule.id}><td>{rule.priority}</td><td>{rule.name}<small>{policy.name}</small></td><td>{Object.entries(rule.conditions).map(([key, value]) => `${label(key)}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" · ")}</td><td>{queues.find((item) => item.id === rule.queueId)?.name ?? "Unavailable queue"}</td><td><Button size="compact" variant="quiet" aria-label={`Edit ${rule.name}`} onPress={() => setAction({
          title: "Edit routing rule", path: `assignment-policies/${policy.id}`, method: "PATCH", initial: { name: rule.name, priority: rule.priority, queueId: rule.queueId, ...rule.conditions },
          fields: [...conditionFields, { key: "name", label: "Rule name", required: true }, { key: "priority", label: "Order (lowest first)", type: "number", min: 0, max: 100000, required: true }, { key: "queueId", label: "Assign to queue", options: queueOptions, required: true }],
          transform: (values) => ({ version: policy.version, rules: policy.rules.filter((item) => item.status === "active").map((item) => ({ name: item.id === rule.id ? values.name : item.name, priority: item.id === rule.id ? values.priority : item.priority, queueId: item.id === rule.id ? values.queueId : item.queueId, conditions: item.id === rule.id ? { ...Object.fromEntries(Object.entries(item.conditions).filter(([key]) => !conditionFields.some(field => field.key === key))), ...conditionsFrom(values) } : item.conditions })) }),
        })}>Edit</Button></td></tr>)}{!activeRules.length ? <tr><td colSpan={5}>No routing rules.</td></tr> : null}</tbody>
      </table></div>
    </section> }]} />
    {action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={refresh} /> : null}
  </section>;
}

export function IntakeInbox({ workspaceId, onChanged }: { workspaceId: string; onChanged: () => Promise<void> }) {
  const resource = useCrmResource<unknown>(workspaceId, "intake-inbox?limit=100");
  const [selected, setSelected] = useState<RecordData | null>(null);
  const [filter, setFilter] = useState("all");
  const entries = rows(resource.data).filter((entry) => filter === "all" || ["duplicate_candidate", "needs_review", "failed"].includes(String(entry.status)));
  return <div className={styles.workbench}><div className={styles.toolbar}><h3>Intake review</h3><div className={styles.actions}><Button size="compact" onPress={() => setFilter(filter === "all" ? "review" : "all")}>{filter === "all" ? "Show needs review" : "Show all"}</Button><Button size="compact" onPress={resource.refresh}>Refresh</Button></div></div><ResourceState {...resource} retry={resource.refresh} /><div className={styles.tableWrap}><table data-record-table="" className={styles.table}><thead><tr><th>Enquiry</th><th>Source</th><th>Status</th><th>Received</th><th>Action</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{String(entry.title ?? "New enquiry")}{entry.failureMessage ? <small>{String(entry.failureMessage)}</small> : null}</td><td>{label(entry.source)}<small>{label(entry.channel)}</small></td><td><Badge tone="neutral">{label(entry.status)}</Badge></td><td>{dateText(entry.receivedAt)}</td><td>{entry.leadId ? <a className={styles.link} href={`/workspace/crm/leads?lead=${entry.leadId}`}>Open lead</a> : <Button size="compact" onPress={() => setSelected(entry)}>Review</Button>}</td></tr>)}</tbody></table>{!resource.loading && !entries.length ? <p className={styles.empty}>No intake events in this view.</p> : null}</div>{selected ? <InspectorSheet isOpen title="Review intake" size="md" onOpenChange={(open) => { if (!open) setSelected(null); }}><IntakeReview workspaceId={workspaceId} item={selected} onChanged={async () => { resource.refresh(); await onChanged(); }} /></InspectorSheet> : null}</div>;
}

function IntakeReview({ workspaceId, item, onChanged }: { workspaceId: string; item: RecordData; onChanged: () => Promise<void> }) {
  const resource = useCrmResource<RecordData>(workspaceId, `intake-events/${item.id}`);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const payload = resource.data?.payload as Record<string, unknown> | undefined;
  const candidates = (resource.data?.candidates ?? []) as RecordData[];
  return <div className={styles.workbench}><ResourceState {...resource} retry={resource.refresh} /><h3>{String(payload?.title ?? "Enquiry")}</h3><p>{String(payload?.summary ?? item.failureMessage ?? "Check potential matches before creating another customer.")}</p>{candidates.map((candidate) => <div className={styles.row} key={candidate.id}><div><strong>{String(candidate.partyName)}</strong><small>{label(candidate.status)}</small></div>{candidate.status === "pending" ? <Button size="compact" onPress={() => setAction({ title: "Resolve possible duplicate", path: `duplicate-candidates/${candidate.id}/review`, initial: { version: candidate.version }, fields: [{ key: "decision", label: "Decision", options: [{ id: "attach", label: "Use this existing customer" }, { id: "create_new", label: "Create a separate customer" }, { id: "reject", label: "Not a match; keep reviewing" }], required: true }, { key: "reason", label: "Review reason", required: true }], transform: (v) => ({ ...v, ...(v.decision === "attach" ? { partyId: candidate.partyId } : {}) }) })}>Resolve</Button> : null}</div>)}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={async () => { resource.refresh(); await onChanged(); }} /> : null}</div>;
}
