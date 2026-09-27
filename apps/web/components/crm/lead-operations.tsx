"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, Badge, Button, DataGrid, InspectorSheet, SelectField, Tabs, type DataGridColumn } from "@/design-system";
import type { CrmAssignmentPolicy, CrmQueueMember, LeadsPageData } from "@/lib/crm/leads";
import { crmRequest, dateText, label, rows, type RecordData } from "@/lib/crm/client";
import { ActionDialog, ResourceState, choice, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";
import assignmentStyles from "./lead-assignment.module.css";
import { useT } from "@/lib/i18n/i18n-provider";

export function LeadRouting({ initialData }: { initialData: LeadsPageData }) {
  const t = useT();
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
    title: policy ? t("Edit auto-assignment") : t("Add auto-assignment"),
    path: policy ? `assignment-policies/${policy.id}` : "assignment-policies",
    method: policy ? "PATCH" : "POST",
    initial: policy ? { version: policy.version, name: policy.name, priority: policy.priority, fallbackQueueId: policy.fallbackQueueId, preserveRelationshipOwner: policy.preserveRelationshipOwner, status: policy.status } : { priority: 10, fallbackQueueId: queue?.id, preserveRelationshipOwner: true },
    fields: [
      { key: "name", label: t("Name"), required: true },
      { key: "priority", label: t("Order (lowest first)"), type: "number", min: 0, max: 100000, required: true },
      { key: "fallbackQueueId", label: t("Default queue"), options: queueOptions, required: true },
      ...(policy ? [{ key: "status", label: t("Status"), options: choice(["active", "archived"]), required: true }] : []),
      { key: "preserveRelationshipOwner", label: t("Keep the existing customer sales owner"), type: "checkbox" },
    ],
  });
  const editMember = (member?: NonNullable<typeof queue>["members"][number]) => {
    if (!queue) return;
    setAction({
    title: member ? t("Edit sales owner") : t("Add sales owner"),
      path: `queues/${queue.id}/members`, method: "PUT",
      initial: member ? { membershipId: member.membershipId, capacity: member.capacity, weight: member.weight, isAvailable: member.isAvailable, skills: member.skills, languages: member.languages, territories: member.territories, ...(member.unavailableUntil ? { unavailableUntil: member.unavailableUntil } : {}) } : { capacity: 25, weight: 1, isAvailable: true },
      fields: [
        ...(!member ? [{ key: "membershipId", label: t("Sales owner"), options: initialData.members.filter((person) => person.status === "active" && !queue.members.some((existing) => existing.membershipId === person.id)).map((person) => ({ id: person.id, label: person.displayName })), required: true }] : []),
        { key: "capacity", label: t("Maximum active enquiries"), type: "number", min: 1, max: 10000, required: true },
        { key: "weight", label: t("Assignment weight"), type: "number", min: 1, max: 100, required: true },
        { key: "isAvailable", label: t("Available for auto-assignment"), type: "checkbox" },
        ...(member?.unavailableUntil ? [{ key: "unavailableUntil", label: t("Unavailable until"), type: "datetime-local" as const }] : []),
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
    { key: "source", label: t("Source"), options: [{ id: "", label: t("Any source") }, ...(initialData.leadOptions?.sources ?? [])] },
    { key: "channel", label: t("Channel"), options: [{ id: "", label: t("Any channel") }, ...Array.from(new Map(Object.values(initialData.leadOptions?.channels ?? {}).flat().map(option => [option.id, option])).values())] },
    { key: "intakeMethod", label: t("Intake method"), options: [{ id: "", label: t("Any intake") }, ...choice(["form", "manual", "automated", "import", "api", "webhook"])] },
    { key: "serviceType", label: t("Enquiry type"), options: [{ id: "", label: t("Any enquiry type") }, ...(initialData.leadOptions?.enquiryTypes ?? [])] },
  ];
  const conditionsFrom = (values: Record<string, unknown>) => Object.fromEntries(conditionFields.filter(field => values[field.key]).map(field => [field.key, values[field.key]]));
  const editRule = (policy: CrmAssignmentPolicy, rule: CrmAssignmentPolicy["rules"][number]) => setAction({
    title: t("Edit routing rule"), path: `assignment-policies/${policy.id}`, method: "PATCH", initial: { name: rule.name, priority: rule.priority, queueId: rule.queueId, ...rule.conditions },
    fields: [...conditionFields, { key: "name", label: t("Rule name"), required: true }, { key: "priority", label: t("Order (lowest first)"), type: "number", min: 0, max: 100000, required: true }, { key: "queueId", label: t("Assign to queue"), options: queueOptions, required: true }],
    transform: (values) => ({ version: policy.version, rules: policy.rules.filter((item) => item.status === "active").map((item) => ({ name: item.id === rule.id ? values.name : item.name, priority: item.id === rule.id ? values.priority : item.priority, queueId: item.id === rule.id ? values.queueId : item.queueId, conditions: item.id === rule.id ? { ...Object.fromEntries(Object.entries(item.conditions).filter(([key]) => !conditionFields.some(field => field.key === key))), ...conditionsFrom(values) } : item.conditions })) }),
  });
  const ownerColumns: DataGridColumn<CrmQueueMember>[] = [
    { accessorKey: "name", header: t("Sales owner"), size: 210, meta: { primary: true }, cell: ({ row }) => <span className={assignmentStyles.personCell}><Avatar name={row.original.name} size="sm" />{row.original.name}</span> },
    { accessorKey: "capacity", header: t("Capacity"), size: 100 },
    { accessorKey: "weight", header: t("Weight"), size: 100 },
    { id: "availability", accessorFn: (member) => member.isAvailable && (!member.unavailableUntil || Date.parse(member.unavailableUntil) <= Date.parse(initialData.referenceTime)) ? t("Available") : t("Unavailable"), header: t("Availability"), size: 180, cell: ({ row }) => <>{row.original.isAvailable && (!row.original.unavailableUntil || Date.parse(row.original.unavailableUntil) <= Date.parse(initialData.referenceTime)) ? t("Available") : t("Unavailable")}{row.original.unavailableUntil ? <small>{t("Away until {date}", { date: dateText(row.original.unavailableUntil) })}</small> : null}</> },
    { id: "action", header: t("Action"), size: 100, enableSorting: false, cell: ({ row }) => <Button aria-label={t("Edit {name}", { name: row.original.name })} size="compact" variant="quiet" onPress={() => editMember(row.original)}>{t("Edit")}</Button> },
  ];
  const policyColumns: DataGridColumn<CrmAssignmentPolicy>[] = [
    { accessorKey: "priority", header: t("Order"), size: 90 },
    { accessorKey: "name", header: t("Name"), size: 210, meta: { primary: true } },
    { id: "queue", accessorFn: (policy) => queues.find((item) => item.id === policy.fallbackQueueId)?.name ?? t("Unavailable queue"), header: t("Default queue"), size: 180 },
    { accessorKey: "status", header: t("Status"), size: 110, cell: ({ row }) => <Badge tone={row.original.status === "active" ? "success" : "neutral"}>{label(row.original.status)}</Badge> },
    { id: "action", header: t("Action"), size: 100, enableSorting: false, cell: ({ row }) => <Button aria-label={t("Edit {name}", { name: row.original.name })} size="compact" variant="quiet" onPress={() => editPolicy(row.original)}>{t("Edit")}</Button> },
  ];
  const ruleColumns: DataGridColumn<(typeof activeRules)[number]>[] = [
    { id: "priority", accessorFn: ({ rule }) => rule.priority, header: t("Order"), size: 90 },
    { id: "name", accessorFn: ({ rule }) => rule.name, header: t("Rule"), size: 210, meta: { primary: true }, cell: ({ row }) => <>{row.original.rule.name}<small>{row.original.policy.name}</small></> },
    { id: "match", accessorFn: ({ rule }) => Object.entries(rule.conditions).map(([key, value]) => `${label(key)}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" · "), header: t("Match"), size: 280 },
    { id: "queue", accessorFn: ({ rule }) => queues.find((item) => item.id === rule.queueId)?.name ?? t("Unavailable queue"), header: t("Queue"), size: 160 },
    { id: "action", header: t("Action"), size: 100, enableSorting: false, cell: ({ row }) => <Button size="compact" variant="quiet" aria-label={t("Edit {name}", { name: row.original.rule.name })} onPress={() => editRule(row.original.policy, row.original.rule)}>{t("Edit")}</Button> },
  ];
  return <section aria-label={t("Auto-assignment configuration")} className={assignmentStyles.page}>
    <Tabs defaultSelectedKey="managers" items={[{ id: "managers", label: t("Sales owners"), panel: <section aria-label={t("Sales owners")}>
      <header className={assignmentStyles.toolbar}>
        <p className={assignmentStyles.hint}>{queue?.takeoverAfterMinutes ? t("Unanswered enquiries move to the next person after {minutes} working minutes.", { minutes: queue.takeoverAfterMinutes }) : null}</p>
        <div className={assignmentStyles.actions}>
          {queues.length ? <div className={assignmentStyles.queue}><SelectField label={t("Queue")} selectedKey={queue?.id ?? null} onSelectionChange={(key) => setQueueId(String(key))} items={queueOptions} /></div> : null}
          <Button size="compact" isDisabled={!queue || addingDefaults} isLoading={addingDefaults} onPress={async () => { if (!queue || addingDefaults) return; setAddingDefaults(true); setFailure(''); setNotice(''); try { const result = await crmRequest<{added:number}>(workspaceId, `queues/${queue.id}/default-managers`, 'POST', {}); await refresh(); setNotice(result.added ? t("{count} default sales owners added.", { count: result.added }) : t("Default sales owners are already included.")); } catch(error) { setFailure((error as Error).message); } finally { setAddingDefaults(false); } }}>{t("Add default sales owners")}</Button>
          <Button size="compact" isDisabled={!queue} onPress={() => queue && setAction({
            title: t("Unanswered lead handoff"), path: `queues/${queue.id}`, method: "PATCH",
            initial: { version: queue.version, takeoverAfterMinutes: queue.takeoverAfterMinutes },
            fields: [{ key: "takeoverAfterMinutes", label: t("Elapsed minutes before another sales owner takes over"), type: "number", min: 1, max: 10080 }],
            transform: (values) => ({ version: values.version, takeoverAfterMinutes: values.takeoverAfterMinutes ?? null }),
            submit: t("Save handoff"),
          })}>{t("Lead handoff")}</Button>
          <Button size="compact" onPress={() => setAction({ title: t("Add queue"), path: "queues", initial: { isFallback: queues.length === 0 }, fields: [{ key: "name", label: t("Name"), required: true }, { key: "code", label: t("Code"), required: true }, { key: "isFallback", label: t("Default queue"), type: "checkbox" }] })}>{t("Add queue")}</Button>
          <Button size="compact" isDisabled={!queue || !initialData.members.some((person) => person.status === "active" && !queue.members.some((existing) => existing.membershipId === person.id))} onPress={() => editMember()}>{t("Add sales owner")}</Button>
        </div>
      </header>
      {notice ? <p role="status">{notice}</p> : null}
      <DataGrid ariaLabel={t("Assignment sales owners")} appearance="flush" columns={ownerColumns} data={queue?.members ?? []} getRowId={(member) => member.membershipId} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} emptyTitle={t("No sales owners in this queue")} emptyDescription={t("Add a sales owner before enabling auto-assignment.")} />
    </section> }, { id: "order", label: t("Routing order"), panel: <section aria-label={t("Routing order")}>
      <header className={assignmentStyles.toolbar} data-actions-only><span /><Button size="compact" isDisabled={!queues.length} onPress={() => editPolicy()}>{t("Add auto-assignment")}</Button></header>
      <DataGrid ariaLabel={t("Auto-assignment routing order")} appearance="flush" columns={policyColumns} data={[...policies].sort((a, b) => a.priority - b.priority)} getRowId={(policy) => policy.id} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} emptyTitle={t("No auto-assignment configured")} emptyDescription={t("Add one to route incoming enquiries.")} />
    </section> }, { id: "rules", label: t("Routing rules"), panel: <section aria-label={t("Routing rules")}>
      <div className={assignmentStyles.toolbar}><span>{t("Match enquiries to a specific queue.")}</span><Button size="compact" isDisabled={!policies.some((policy) => policy.status === "active") || !queues.length} onPress={() => setAction({
        title: t("Add routing rule"), path: (values) => `assignment-policies/${values.policyId}`, method: "PATCH",
        initial: { policyId: policies.find((policy) => policy.status === "active")?.id, priority: 10 },
        fields: [{ key: "policyId", label: t("Auto-assignment"), options: policies.filter((policy) => policy.status === "active").map((policy) => ({ id: policy.id, label: policy.name })), required: true }, { key: "name", label: t("Rule name"), required: true }, { key: "priority", label: t("Order (lowest first)"), type: "number", min: 0, max: 100000, required: true }, ...conditionFields, { key: "queueId", label: t("Assign to queue"), options: queueOptions, required: true }],
        transform: (values) => {
          const policy = policies.find((item) => item.id === values.policyId)!;
          return { version: policy.version, rules: [...policy.rules.filter((rule) => rule.status === "active").map(({ name, priority, queueId, conditions }) => ({ name, priority, queueId, conditions })), { name: values.name, priority: values.priority, queueId: values.queueId, conditions: conditionsFrom(values) }] };
        },
      })}>{t("Add rule")}</Button></div>
      <DataGrid ariaLabel={t("Routing rules")} appearance="flush" columns={ruleColumns} data={activeRules} getRowId={({ rule }) => rule.id} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} emptyTitle={t("No routing rules")} emptyDescription={t("Rules can direct matching enquiries to a specific queue.")} />
    </section> }]} />
    {action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={refresh} /> : null}
  </section>;
}

export function IntakeInbox({ workspaceId, onChanged }: { workspaceId: string; onChanged: () => Promise<void> }) {
  const t = useT();
  const resource = useCrmResource<unknown>(workspaceId, "intake-inbox?limit=100");
  const [selected, setSelected] = useState<RecordData | null>(null);
  const [filter, setFilter] = useState("all");
  const entries = rows(resource.data).filter((entry) => filter === "all" || ["duplicate_candidate", "needs_review", "failed"].includes(String(entry.status)));
  const columns: DataGridColumn<RecordData>[] = [
    { id: "enquiry", accessorFn: (entry) => String(entry.title ?? t("New enquiry")), header: t("Enquiry"), size: 220, meta: { primary: true }, cell: ({ row }) => <>{String(row.original.title ?? t("New enquiry"))}{row.original.failureMessage ? <small>{String(row.original.failureMessage)}</small> : null}</> },
    { id: "source", accessorFn: (entry) => label(entry.source), header: t("Source"), size: 160, cell: ({ row }) => <>{label(row.original.source)}<small>{label(row.original.channel)}</small></> },
    { accessorKey: "status", header: t("Status"), size: 130, cell: ({ row }) => <Badge tone="neutral">{label(row.original.status)}</Badge> },
    { id: "received", accessorFn: (entry) => String(entry.receivedAt ?? ""), header: t("Received"), size: 155, cell: ({ row }) => dateText(row.original.receivedAt) },
    { id: "action", header: t("Action"), size: 125, enableSorting: false, cell: ({ row }) => row.original.leadId ? <Link className={styles.link} href={`/workspace/crm/leads?lead=${row.original.leadId}`}>{t("Open enquiry")}</Link> : <Button size="compact" onPress={() => setSelected(row.original)}>{t("Review")}</Button> },
  ];
  return <div className={styles.workbench}>
    <div className={styles.toolbar}><h3>{t("Intake review")}</h3><div className={styles.actions}><Button size="compact" onPress={() => setFilter(filter === "all" ? "review" : "all")}>{filter === "all" ? t("Show needs review") : t("Show all")}</Button><Button size="compact" onPress={resource.refresh}>{t("Refresh")}</Button></div></div>
    <ResourceState {...resource} retry={resource.refresh} />
    <DataGrid ariaLabel={t("Intake review")} appearance="flush" columns={columns} data={entries} getRowId={(entry) => String(entry.id)} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} isLoading={resource.loading} emptyTitle={t("No intake events in this view")} emptyDescription={t("New enquiries requiring review will appear here.")} />
    {selected ? <InspectorSheet isOpen title={t("Review intake")} size="md" onOpenChange={(open) => { if (!open) setSelected(null); }}><IntakeReview workspaceId={workspaceId} item={selected} onChanged={async () => { resource.refresh(); await onChanged(); }} /></InspectorSheet> : null}
  </div>;
}

function IntakeReview({ workspaceId, item, onChanged }: { workspaceId: string; item: RecordData; onChanged: () => Promise<void> }) {
  const t = useT();
  const resource = useCrmResource<RecordData>(workspaceId, `intake-events/${item.id}`);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const payload = resource.data?.payload as Record<string, unknown> | undefined;
  const candidates = (resource.data?.candidates ?? []) as RecordData[];
  return <div className={styles.workbench}><ResourceState {...resource} retry={resource.refresh} /><h3>{String(payload?.title ?? t("Enquiry"))}</h3><p>{String(payload?.summary ?? item.failureMessage ?? t("Check potential matches before creating another customer."))}</p>{candidates.map((candidate) => <div className={styles.row} key={candidate.id}><div><strong>{String(candidate.partyName)}</strong><small>{label(candidate.status)}</small></div>{candidate.status === "pending" ? <Button size="compact" onPress={() => setAction({ title: t("Resolve possible duplicate"), path: `duplicate-candidates/${candidate.id}/review`, initial: { version: candidate.version }, fields: [{ key: "decision", label: t("Decision"), options: [{ id: "attach", label: t("Use this existing customer") }, { id: "create_new", label: t("Create a separate customer") }, { id: "reject", label: t("Not a match; keep reviewing") }], required: true }, { key: "reason", label: t("Review reason"), required: true }], transform: (v) => ({ ...v, ...(v.decision === "attach" ? { partyId: candidate.partyId } : {}) }) })}>{t("Resolve")}</Button> : null}</div>)}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={async () => { resource.refresh(); await onChanged(); }} /> : null}</div>;
}
