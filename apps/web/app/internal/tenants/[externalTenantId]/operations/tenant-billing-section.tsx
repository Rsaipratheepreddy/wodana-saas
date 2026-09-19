"use client";

import { CreditCard, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge, Button, Callout, ConfirmationDialog, DataGrid, DateTimeInput, Form, MoneyInput,
  NumericInput, SelectField, Skeleton, Surface, TextAreaField, TextInput, type DataGridColumn,
} from "@/design-system";
import type { OperatorPermission } from "@/lib/internal/auth";
import type { EntitlementCatalog, TenantBillingOverview } from "@/lib/internal/types";
import { previewBillingContractChange } from "@/lib/internal/billing-preview";
import styles from "./tenant-operations.module.css";

type Editor = "contract" | "allocation" | "collection" | null;
type Review = { kind: Exclude<Editor, null>; title: string; rows: Array<[string, string, string]> } | null;
type TimelineRow = { id: string; at: string; event: string; state: string; detail: string };

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(data?.message ?? "The request could not be completed.");
  return data as T;
}

function dateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoDate(value: string) { return value ? new Date(value).toISOString() : undefined; }
function money(value: string | number, currency: string) {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value));
}

const timelineColumns: DataGridColumn<TimelineRow>[] = [
  { accessorKey: "at", header: "Date", size: 170, cell: ({ row }) => new Date(row.original.at).toLocaleString() },
  { accessorKey: "event", header: "Event", size: 190, meta: { primary: true } },
  { accessorKey: "state", header: "State", size: 130,
    cell: ({ row }) => <Badge tone={["past due", "collections", "failed", "expired", "suspended"].includes(row.original.state) ? "warning" : "neutral"}>{row.original.state}</Badge> },
  { accessorKey: "detail", header: "Details", size: 520 },
];

export function TenantBillingSection({ externalTenantId, permissions, plans }: {
  externalTenantId: string;
  permissions: OperatorPermission[];
  plans: EntitlementCatalog["plans"];
}) {
  const [data, setData] = useState<TenantBillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [review, setReview] = useState<Review>(null);
  const canManage = permissions.includes("billing.manage");
  const [contract, setContract] = useState({
    planKey: "starter:1", status: "trial_uncontracted", currency: "AED", billingCycle: "monthly",
    recurringAmount: 0, seatLimit: 5, projectLimit: 25, contractReference: "", signedAt: "",
    trialEndsAt: "", termStartsAt: dateTimeLocal(new Date().toISOString()), renewsAt: "", endsAt: "",
    legalEntityReference: "", reason: "Create the account billing contract",
  });
  const [allocation, setAllocation] = useState({
    status: "active", allocatedAmount: 0, seatLimit: 5, projectLimit: 25,
    effectiveFrom: "", effectiveUntil: "", reason: "Allocate account capacity to this organization",
  });
  const [collection, setCollection] = useState({
    status: "current", overdueAmount: 0, currency: "AED", effectiveAt: "", nextReviewAt: "",
    reason: "Confirm the current account collection state",
  });

  const apply = useCallback((value: TenantBillingOverview) => {
    setData(value);
    if ("version" in value.contract) setContract({
      planKey: `${value.contract.planCode}:${value.contract.planVersion}`,
      status: value.contract.status, currency: value.contract.currency, billingCycle: value.contract.billingCycle,
      recurringAmount: Number(value.contract.recurringAmount), seatLimit: value.contract.seatLimit,
      projectLimit: value.contract.projectLimit, contractReference: value.contract.contractReference ?? "",
      signedAt: dateTimeLocal(value.contract.signedAt), trialEndsAt: dateTimeLocal(value.contract.trialEndsAt),
      termStartsAt: dateTimeLocal(value.contract.termStartsAt), renewsAt: dateTimeLocal(value.contract.renewsAt),
      endsAt: dateTimeLocal(value.contract.endsAt), legalEntityReference: value.contract.legalEntityReference ?? "",
      reason: "Version the account contract after commercial review",
    });
    if ("version" in value.organizationAllocation) setAllocation({
      status: value.organizationAllocation.status, allocatedAmount: Number(value.organizationAllocation.allocatedAmount),
      seatLimit: value.organizationAllocation.seatLimit, projectLimit: value.organizationAllocation.projectLimit,
      effectiveFrom: value.organizationAllocation.status === "scheduled" ? dateTimeLocal(value.organizationAllocation.effectiveFrom) : "",
      effectiveUntil: dateTimeLocal(value.organizationAllocation.effectiveUntil),
      reason: "Update the organization allocation after account review",
    });
    if ("version" in value.collection) setCollection({
      status: value.collection.status, overdueAmount: Number(value.collection.overdueAmount),
      currency: value.collection.currency, effectiveAt: "", nextReviewAt: dateTimeLocal(value.collection.nextReviewAt),
      reason: "Update the account collection state after finance review",
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      apply(await responseData<TenantBillingOverview>(await fetch(
        `/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations/billing`, { cache: "no-store" },
      )));
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [apply, externalTenantId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations/billing`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(responseData<TenantBillingOverview>)
      .then(apply)
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apply, externalTenantId]);

  async function mutate(resource: string, method: "PATCH" | "POST", body: unknown, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await responseData(await fetch(`/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations/billing/${resource}`, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      setNotice(success); setEditor(null); setReview(null); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  const configuredContract = data && "version" in data.contract ? data.contract : null;
  const configuredAllocation = data && "version" in data.organizationAllocation ? data.organizationAllocation : null;
  const configuredCollection = data && "version" in data.collection ? data.collection : null;
  const timeline = useMemo<TimelineRow[]>(() => {
    if (!data) return [];
    return [
      ...data.contractHistory.map((item) => ({ id: `contract-${item.id}`, at: item.effectiveFrom,
        event: `Contract v${item.version}`, state: item.status.replaceAll("_", " "),
        detail: `${item.planCode} v${item.planVersion} · ${money(item.recurringAmount, item.currency)} · ${item.seatLimit} seats` })),
      ...data.organizationAllocationHistory.map((item) => ({ id: `allocation-${item.id}`, at: item.effectiveFrom,
        event: `Organization allocation v${item.version}`, state: item.status.replaceAll("_", " "),
        detail: `${money(item.allocatedAmount, configuredContract?.currency ?? "AED")} · ${item.seatLimit} seats · ${item.projectLimit} projects` })),
      ...data.collectionHistory.map((item) => ({ id: `collection-${item.id}`, at: item.effectiveAt,
        event: `Collection v${item.version}`, state: item.status.replaceAll("_", " "),
        detail: `${money(item.overdueAmount, item.currency)} overdue · ${item.reason}` })),
      ...data.documents.map((item) => ({ id: `document-${item.id}`, at: item.issuedAt ?? item.createdAt,
        event: `${item.documentType.replaceAll("_", " ")} ${item.documentNumber ?? item.externalReference}`,
        state: item.status.replaceAll("_", " "),
        detail: `${money(item.totalAmount, item.currency)} · ${money(item.balanceAmount, item.currency)} balance · ${item.provider}` })),
      ...data.usageSnapshots.map((item) => ({ id: `usage-${item.id}`, at: item.capturedAt,
        event: "Usage snapshot", state: item.source.replaceAll("_", " "),
        detail: `${item.totals.members} members · ${item.totals.projects} projects · ${item.totals.knownFileCount} files` })),
    ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  }, [configuredContract?.currency, data]);

  function reviewContract() {
    if (!contract.termStartsAt || contract.reason.trim().length < 10) { setError("Add a term start and a clear change reason."); return; }
    if (contract.status === "contracted" && !contract.signedAt) { setError("A contracted account requires a signed date."); return; }
    const impact = previewBillingContractChange(configuredContract ? {
      status: configuredContract.status,
      currency: configuredContract.currency,
      recurringAmount: Number(configuredContract.recurringAmount),
      seatLimit: configuredContract.seatLimit,
      projectLimit: configuredContract.projectLimit,
      termStartsAt: configuredContract.termStartsAt ?? configuredContract.effectiveFrom,
      renewsAt: configuredContract.renewsAt ?? null,
    } : null, {
      status: contract.status as "trial_uncontracted" | "contracted" | "expired",
      currency: contract.currency,
      recurringAmount: contract.recurringAmount,
      seatLimit: contract.seatLimit,
      projectLimit: contract.projectLimit,
      termStartsAt: isoDate(contract.termStartsAt) ?? new Date().toISOString(),
      renewsAt: contract.renewsAt ? isoDate(contract.renewsAt) ?? null : null,
    }, new Date(data?.observedAt ?? Date.now()));
    setReview({ kind: "contract", title: "Version account contract?", rows: [
      ["Plan", configuredContract ? `${configuredContract.planCode} v${configuredContract.planVersion}` : "Not configured", contract.planKey.replace(":", " v")],
      ["State", configuredContract?.status.replaceAll("_", " ") ?? "Not configured", contract.status.replaceAll("_", " ")],
      ["Recurring", configuredContract ? money(configuredContract.recurringAmount, configuredContract.currency) : "—", money(contract.recurringAmount, contract.currency)],
      ["Capacity", configuredContract ? `${configuredContract.seatLimit} seats · ${configuredContract.projectLimit} projects` : "—", `${contract.seatLimit} seats · ${contract.projectLimit} projects`],
      ["Change type", "Current contract", impact.direction.replaceAll("_", " ")],
      ["Next bill", configuredContract ? money(configuredContract.recurringAmount, configuredContract.currency) : "—", money(impact.nextBillAmount, contract.currency)],
      ["Current-period estimate", "No provider charge created", impact.proratedDelta === null ? "Unavailable without a current billing period" : money(impact.proratedDelta, contract.currency)],
      ["Module access", "Entitlements unchanged", "Entitlements unchanged"],
    ] });
  }

  function reviewAllocation() {
    if (allocation.reason.trim().length < 10) { setError("Add a clear allocation reason."); return; }
    setReview({ kind: "allocation", title: "Apply organization allocation?", rows: [
      ["State", configuredAllocation?.status ?? "Not configured", allocation.status],
      ["Amount", configuredAllocation && configuredContract ? money(configuredAllocation.allocatedAmount, configuredContract.currency) : "—", money(allocation.allocatedAmount, configuredContract?.currency ?? contract.currency)],
      ["Capacity", configuredAllocation ? `${configuredAllocation.seatLimit} seats · ${configuredAllocation.projectLimit} projects` : "—", `${allocation.seatLimit} seats · ${allocation.projectLimit} projects`],
      ["Module access", "Entitlements unchanged", allocation.status === "ended" || allocation.status === "suspended" ? "Requires a separate entitlement or lifecycle action" : "Entitlements unchanged"],
    ] });
  }

  function reviewCollection() {
    if (collection.reason.trim().length < 10) { setError("Add a clear collection reason."); return; }
    setReview({ kind: "collection", title: "Update collection state?", rows: [
      ["State", configuredCollection?.status ?? "Not configured", collection.status],
      ["Overdue", configuredCollection ? money(configuredCollection.overdueAmount, configuredCollection.currency) : "—", money(collection.overdueAmount, collection.currency)],
      ["Review", configuredCollection?.nextReviewAt ? new Date(configuredCollection.nextReviewAt).toLocaleString() : "None", collection.nextReviewAt ? new Date(collection.nextReviewAt).toLocaleString() : "None"],
      ["Module access", "Entitlements unchanged", "Entitlements unchanged"],
    ] });
  }

  async function confirmReview() {
    if (!data || !review) return;
    if (review.kind === "contract") {
      const [planCode, planVersion] = contract.planKey.split(":");
      await mutate("contract", "PATCH", {
        expectedVersion: Math.max(0, ...data.contractHistory.map((item) => item.version)), status: contract.status,
        planCode, planVersion: Number(planVersion), currency: contract.currency, billingCycle: contract.billingCycle,
        recurringAmount: contract.recurringAmount, seatLimit: contract.seatLimit, projectLimit: contract.projectLimit,
        contractReference: contract.contractReference || null,
        signedAt: contract.status === "contracted" ? isoDate(contract.signedAt) : null,
        trialEndsAt: contract.trialEndsAt ? isoDate(contract.trialEndsAt) : null,
        termStartsAt: isoDate(contract.termStartsAt), renewsAt: contract.renewsAt ? isoDate(contract.renewsAt) : null,
        endsAt: contract.endsAt ? isoDate(contract.endsAt) : null,
        legalEntityReference: contract.legalEntityReference || null,
        terms: { source: "operator_review" }, reason: contract.reason,
      }, "Account contract version saved.");
    } else if (review.kind === "allocation") {
      await mutate("allocation", "PATCH", {
        expectedVersion: Math.max(0, ...data.organizationAllocationHistory.map((item) => item.version)),
        status: allocation.status, allocatedAmount: allocation.allocatedAmount, seatLimit: allocation.seatLimit,
        projectLimit: allocation.projectLimit,
        ...(allocation.effectiveFrom ? { effectiveFrom: isoDate(allocation.effectiveFrom) } : {}),
        effectiveUntil: allocation.effectiveUntil ? isoDate(allocation.effectiveUntil) : null,
        reason: allocation.reason,
      }, "Organization billing allocation saved.");
    } else {
      await mutate("collection", "PATCH", {
        expectedVersion: Math.max(0, ...data.collectionHistory.map((item) => item.version)), status: collection.status,
        overdueAmount: collection.overdueAmount, currency: collection.currency,
        ...(collection.effectiveAt ? { effectiveAt: isoDate(collection.effectiveAt) } : {}),
        nextReviewAt: collection.nextReviewAt ? isoDate(collection.nextReviewAt) : null, reason: collection.reason,
      }, "Collection state saved.");
    }
  }

  return <section aria-label="Billing and usage" className={styles.section}>
    <div className={styles.sectionTitle}><div><h2>Billing and usage</h2><p>The account contract is authoritative. Organization subscriptions are allocations and every change creates history.</p></div><CreditCard size={18}/></div>
    {error ? <Callout title="Billing needs attention" tone="danger">{error}</Callout> : null}
    {notice ? <Callout title="Billing updated" tone="success">{notice}</Callout> : null}
    {loading && !data ? <Skeleton lines={5}/> : data ? <>
      <Surface className={styles.billingSummary} aria-label="Account billing summary">
        <div><small>Contract</small><strong>{configuredContract?.status.replaceAll("_", " ") ?? "Not configured"}</strong><span>{configuredContract ? `${configuredContract.planCode} v${configuredContract.planVersion}` : "Create the account contract first"}</span></div>
        <div><small>Recurring</small><strong>{configuredContract ? money(configuredContract.recurringAmount, configuredContract.currency) : "—"}</strong><span>{configuredContract?.billingCycle ?? "No billing cycle"}</span></div>
        <div><small>Next bill</small><strong>{configuredContract?.renewsAt ? new Date(configuredContract.renewsAt).toLocaleDateString() : "Not scheduled"}</strong><span>{configuredContract?.renewsAt ? "Contract renewal" : "No date claimed"}</span></div>
        <div><small>Collection</small><strong>{configuredCollection?.status.replaceAll("_", " ") ?? "Not configured"}</strong><span>{configuredCollection ? `${money(configuredCollection.overdueAmount, configuredCollection.currency)} overdue` : "No collection policy recorded"}</span></div>
      </Surface>
      <Callout title="Tax treatment is unverified" tone="neutral">Legal-entity references are recorded, but Wodana does not claim regional tax compliance until a validated region pack and evidence are attached.</Callout>
      <div className={styles.billingActions}>
        {canManage ? <><Button size="compact" variant={editor === "contract" ? "primary" : "secondary"} onPress={() => setEditor(editor === "contract" ? null : "contract")}>Account contract</Button><Button size="compact" variant={editor === "allocation" ? "primary" : "secondary"} isDisabled={!configuredContract} onPress={() => setEditor(editor === "allocation" ? null : "allocation")}>Organization allocation</Button><Button size="compact" variant={editor === "collection" ? "primary" : "secondary"} onPress={() => setEditor(editor === "collection" ? null : "collection")}>Collection state</Button><Button size="compact" isLoading={busy} onPress={() => void mutate("usage-snapshots", "POST", { periodStart: new Date(Date.now() - 30 * 86_400_000).toISOString(), periodEnd: new Date().toISOString(), source: "computed" }, "Current usage snapshot recorded.")}><RefreshCw size={14}/>Capture usage</Button></> : <Badge tone="neutral">Read only</Badge>}
      </div>
      {editor === "contract" ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); reviewContract(); }}>
        <div className={styles.formGrid}>
          <SelectField label="Plan version" items={plans.map((plan) => ({ id: `${plan.code}:${plan.version}`, label: `${plan.configuration.label ?? plan.code} · v${plan.version}` }))} selectedKey={contract.planKey} onSelectionChange={(key) => key && setContract({ ...contract, planKey: String(key) })}/>
          <SelectField label="Contract state" items={[{ id: "trial_uncontracted", label: "Trial · uncontracted" }, { id: "contracted", label: "Contracted" }, { id: "expired", label: "Expired" }]} selectedKey={contract.status} onSelectionChange={(key) => key && setContract({ ...contract, status: String(key) })}/>
          <SelectField label="Billing cycle" items={[{ id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly" }, { id: "custom", label: "Custom" }]} selectedKey={contract.billingCycle} onSelectionChange={(key) => key && setContract({ ...contract, billingCycle: String(key) })}/>
          <TextInput label="Currency" value={contract.currency} onChange={(value) => setContract({ ...contract, currency: value.toUpperCase() })} maxLength={3} isRequired/>
          <MoneyInput label="Recurring amount" currency={contract.currency} minValue={0} value={contract.recurringAmount} onChange={(value) => setContract({ ...contract, recurringAmount: value })}/>
          <TextInput label="Contract reference" value={contract.contractReference} onChange={(value) => setContract({ ...contract, contractReference: value })}/>
          <NumericInput label="Account seats" minValue={1} value={contract.seatLimit} onChange={(value) => setContract({ ...contract, seatLimit: value })}/>
          <NumericInput label="Account projects" minValue={1} value={contract.projectLimit} onChange={(value) => setContract({ ...contract, projectLimit: value })}/>
          <TextInput label="Legal entity reference" value={contract.legalEntityReference} onChange={(value) => setContract({ ...contract, legalEntityReference: value })}/>
          <DateTimeInput label="Term starts" value={contract.termStartsAt} onChange={(value) => setContract({ ...contract, termStartsAt: value })}/>
          <DateTimeInput label="Signed at" value={contract.signedAt} onChange={(value) => setContract({ ...contract, signedAt: value })} isDisabled={contract.status !== "contracted"}/>
          <DateTimeInput label="Renews at" value={contract.renewsAt} onChange={(value) => setContract({ ...contract, renewsAt: value })}/>
          <DateTimeInput label="Trial ends" value={contract.trialEndsAt} onChange={(value) => setContract({ ...contract, trialEndsAt: value })}/>
          <DateTimeInput label="Term ends" value={contract.endsAt} onChange={(value) => setContract({ ...contract, endsAt: value })}/>
        </div>
        <TextAreaField label="Reason" value={contract.reason} onChange={(value) => setContract({ ...contract, reason: value })} maxLength={500} isRequired/>
        <Button type="submit" variant="primary">Review contract</Button>
      </Form> : null}
      {editor === "allocation" ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); reviewAllocation(); }}>
        <div className={styles.formGrid}>
          <SelectField label="Allocation state" items={[{ id: "active", label: "Active" }, { id: "scheduled", label: "Scheduled" }, { id: "suspended", label: "Suspended" }, { id: "ended", label: "Ended" }]} selectedKey={allocation.status} onSelectionChange={(key) => key && setAllocation({ ...allocation, status: String(key) })}/>
          <MoneyInput label="Allocated amount" currency={configuredContract?.currency ?? contract.currency} minValue={0} value={allocation.allocatedAmount} onChange={(value) => setAllocation({ ...allocation, allocatedAmount: value })}/>
          <NumericInput label="Seats" minValue={1} value={allocation.seatLimit} onChange={(value) => setAllocation({ ...allocation, seatLimit: value })}/>
          <NumericInput label="Projects" minValue={1} value={allocation.projectLimit} onChange={(value) => setAllocation({ ...allocation, projectLimit: value })}/>
          <DateTimeInput label="Starts" value={allocation.effectiveFrom} onChange={(value) => setAllocation({ ...allocation, effectiveFrom: value })}/>
          <DateTimeInput label="Ends" value={allocation.effectiveUntil} onChange={(value) => setAllocation({ ...allocation, effectiveUntil: value })}/>
        </div>
        <TextAreaField label="Reason" value={allocation.reason} onChange={(value) => setAllocation({ ...allocation, reason: value })} maxLength={500} isRequired/>
        <Button type="submit" variant="primary">Review allocation</Button>
      </Form> : null}
      {editor === "collection" ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); reviewCollection(); }}>
        <div className={styles.formGrid}>
          <SelectField label="Collection state" items={["current", "grace", "past_due", "collections", "suspended", "closed"].map((id) => ({ id, label: id.replaceAll("_", " ") }))} selectedKey={collection.status} onSelectionChange={(key) => key && setCollection({ ...collection, status: String(key) })}/>
          <MoneyInput label="Overdue amount" currency={collection.currency} minValue={0} value={collection.overdueAmount} onChange={(value) => setCollection({ ...collection, overdueAmount: value })}/>
          <DateTimeInput label="Next review" value={collection.nextReviewAt} onChange={(value) => setCollection({ ...collection, nextReviewAt: value })}/>
        </div>
        <TextAreaField label="Reason" value={collection.reason} onChange={(value) => setCollection({ ...collection, reason: value })} maxLength={500} isRequired/>
        <Button type="submit" variant="primary">Review collection state</Button>
      </Form> : null}
      <DataGrid ariaLabel="Account billing timeline" columns={timelineColumns} data={timeline} emptyTitle="No billing history" emptyDescription="Version the account contract to begin the billing timeline." getRowId={(row) => row.id} pageSize={10} rowNumbers={false} selectable={false}/>
    </> : null}
    <ConfirmationDialog isOpen={Boolean(review)} onOpenChange={(open) => { if (!open && !busy) setReview(null); }}
      title={review?.title ?? "Review billing change"}
      body={<div className={styles.reviewBody}><div className={styles.reviewDiff}>{review?.rows.map(([label, before, after]) => <div key={label}><strong>{label}</strong><span>{before}</span><span aria-hidden="true">→</span><span>{after}</span></div>)}</div><Callout title="Audited version" tone="neutral">This creates immutable billing history. It does not send a provider invoice, charge a card, or claim tax validation.</Callout></div>}
      confirmLabel="Confirm change" confirmVariant="primary" isConfirming={busy} onConfirm={() => void confirmReview()}/>
  </section>;
}
