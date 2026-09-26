"use client";

import { ArrowLeft, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppShell, Badge, Button, Callout, ConfirmationDialog, Container, DataGrid, DateTimeInput,
  DesignSystemProvider, Form, MultiSelectField, NumericInput, PageHeader, SelectField, Skeleton, Surface, Switch,
  TextAreaField, TextInput, type DataGridColumn,
} from "@/design-system";
import type { EntitlementCatalog, TenantLifecycleOverview, TenantLifecycleState, TenantModuleCode, TenantOperationsOverview } from "@/lib/internal/types";
import type { OperatorPermission } from "@/lib/internal/auth";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import { TenantBillingSection } from "./tenant-billing-section";
import styles from "./tenant-operations.module.css";

const MODULES = [
  { id: "workspace", label: "Workspace" },
  { id: "crm", label: "CRM" },
  { id: "pre-project", label: "Planning" },
  { id: "projects", label: "Projects" },
  { id: "hrms", label: "HRMS" },
];

type EntitlementDraft = {
  planCode: string;
  planVersion: number;
  status: string;
  modules: Set<string>;
  seatLimit: number;
  projectLimit: number;
  effectiveFrom: string;
  effectiveUntil: string;
  reason: string;
};
type PolicyDraft = { storageQuotaGb: number; retentionDays: number; legalHold: boolean; scanRequirement: string; exportBeforeErasure: boolean };
type ModuleRow = {
  id: TenantModuleCode;
  label: string;
  sold: boolean;
  enabled: boolean;
  allocationState: string;
  platformState: string;
  exceptionCount: number;
};

const compatibilityPermissions: OperatorPermission[] = [
  "tenants.read", "billing.manage", "lifecycle.manage", "entitlements.manage", "support.request", "support.approve", "data.manage",
];

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new Error(data?.message ?? "The request could not be completed.");
  return data as T;
}

function bytes(value: number) {
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const operationColumns: DataGridColumn<TenantOperationsOverview["operations"][number]>[] = [
  { accessorKey: "operationType", header: "Operation", size: 120, meta: { primary: true }, cell: ({ row }) => row.original.operationType.replaceAll("_", " ") },
  { accessorKey: "phase", header: "Phase", size: 110, cell: ({ row }) => row.original.phase.replaceAll("_", " ") },
  { accessorKey: "status", header: "Status", size: 120, cell: ({ row }) => <Badge tone={row.original.status === "blocked" || row.original.status === "failed" ? "warning" : row.original.status === "succeeded" ? "success" : "neutral"}>{row.original.status}</Badge> },
  { accessorKey: "reason", header: "Reason", size: 280 },
  { id: "blockers", accessorFn: (row) => row.plan.blockers?.join(" · ") ?? "", header: "Result", size: 320, cell: ({ row }) => row.original.plan.blockers?.length ? row.original.plan.blockers.join(" · ") : row.original.plan.note ?? "Ready for reviewed execution" },
];

const moduleColumns: DataGridColumn<ModuleRow>[] = [
  { accessorKey: "label", header: "Module", size: 180, meta: { primary: true } },
  { id: "sold", accessorFn: (row) => row.sold ? "Included" : "Not included", header: "Account contract", size: 160,
    cell: ({ row }) => <Badge tone={row.original.sold ? "success" : "neutral"}>{row.original.sold ? "Included" : "Not included"}</Badge> },
  { accessorKey: "allocationState", header: "Organization", size: 160,
    cell: ({ row }) => <Badge tone={row.original.enabled ? "success" : row.original.sold ? "warning" : "neutral"}>{row.original.allocationState}</Badge> },
  { accessorKey: "platformState", header: "Platform", size: 190,
    cell: ({ row }) => <span>{row.original.platformState}{row.original.exceptionCount ? <small>{row.original.exceptionCount} feature exception{row.original.exceptionCount === 1 ? "" : "s"}</small> : null}</span> },
];

const capabilityColumns: DataGridColumn<EntitlementCatalog["capabilityFlags"][number]>[] = [
  { accessorKey: "code", header: "Capability", size: 220, meta: { primary: true } },
  { accessorKey: "module", header: "Module", size: 130 },
  { accessorKey: "releaseState", header: "Availability", size: 150,
    cell: ({ row }) => <Badge tone={row.original.releaseState === "available" ? "success" : row.original.releaseState === "unavailable" ? "warning" : "neutral"}>{row.original.releaseState.replaceAll("_", " ")}</Badge> },
  { accessorKey: "reason", header: "Reason", size: 360 },
];

const entitlementHistoryColumns: DataGridColumn<TenantOperationsOverview["entitlementHistory"][number]>[] = [
  { id: "plan", accessorFn: (row) => `${row.planCode} v${row.planVersion}`, header: "Plan", size: 130, meta: { primary: true } },
  { id: "modules", accessorFn: (row) => row.modules.join(", "), header: "Allocation", size: 250 },
  { accessorKey: "status", header: "State", size: 120, cell: ({ row }) => <Badge tone={row.original.status === "active" ? "success" : "warning"}>{row.original.status}</Badge> },
  { id: "effective", accessorFn: (row) => row.effectiveFrom, header: "Effective", size: 190,
    cell: ({ row }) => <span>{new Date(row.original.effectiveFrom).toLocaleString()}<small>{row.original.effectiveUntil ? `Until ${new Date(row.original.effectiveUntil).toLocaleString()}` : "No scheduled end"}</small></span> },
  { accessorKey: "reason", header: "Reason", size: 320 },
];

const lifecycleHistoryColumns: DataGridColumn<TenantLifecycleOverview["history"][number]>[] = [
  { accessorKey: "version", header: "Version", size: 90, meta: { primary: true } },
  { accessorKey: "state", header: "State", size: 130, cell: ({ row }) => <Badge tone={row.original.state === "active" ? "success" : row.original.state === "suspended" || row.original.state === "archived" ? "warning" : "neutral"}>{row.original.state}</Badge> },
  { accessorKey: "reason", header: "Reason", size: 300 },
  { accessorKey: "noticeDeliveryState", header: "Notice", size: 160, cell: ({ row }) => row.original.noticeDeliveryState.replaceAll("_", " ") },
  { accessorKey: "createdAt", header: "Decided", size: 170, cell: ({ row }) => new Date(row.original.createdAt).toLocaleString() },
];

function dateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoDate(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

export function TenantOperationsPage({ externalTenantId, permissions = compatibilityPermissions }: { externalTenantId: string; permissions?: OperatorPermission[] }) {
  const router = useRouter();
  const { theme } = useWorkspaceTheme();
  const [data, setData] = useState<TenantOperationsOverview | null>(null);
  const [lifecycle, setLifecycle] = useState<TenantLifecycleOverview | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(true);
  const [lifecycleError, setLifecycleError] = useState("");
  const [lifecycleDraft, setLifecycleDraft] = useState<{ to: TenantLifecycleState | ""; reason: string; graceEndsAt: string }>({ to: "", reason: "", graceEndsAt: "" });
  const [lifecycleDecisionKey, setLifecycleDecisionKey] = useState("");
  const [showLifecycleReview, setShowLifecycleReview] = useState(false);
  const [catalog, setCatalog] = useState<EntitlementCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showEntitlementReview, setShowEntitlementReview] = useState(false);
  const [entitlement, setEntitlement] = useState<EntitlementDraft>({
    planCode: "starter", planVersion: 1, status: "active", modules: new Set(["workspace", "crm"]),
    seatLimit: 0, projectLimit: 0, effectiveFrom: "", effectiveUntil: "",
    reason: "Initial tenant module allocation",
  });
  const [policy, setPolicy] = useState<PolicyDraft>({ storageQuotaGb: 5, retentionDays: 365, legalHold: false, scanRequirement: "required", exportBeforeErasure: true });
  const [support, setSupport] = useState({ accessLevel: "read_only", durationMinutes: 60, reason: "" });
  const [operation, setOperation] = useState({ operationType: "export", targetExternalTenantId: "", reason: "" });
  const can = (permission: OperatorPermission) => permissions.includes(permission);

  const loadLifecycle = useCallback(async () => {
    setLifecycleLoading(true); setLifecycleError("");
    try {
      const value = await responseData<TenantLifecycleOverview>(await fetch(`/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations/lifecycle`, { cache: "no-store" }));
      if (!Array.isArray(value.nextStates) || !Array.isArray(value.history)) throw new Error("Lifecycle details were invalid.");
      setLifecycle(value);
      setLifecycleDraft((draft) => value.nextStates.includes(draft.to as TenantLifecycleState)
        ? draft : { to: value.nextStates[0] ?? "", reason: "", graceEndsAt: "" });
    } catch (reason) { setLifecycleError((reason as Error).message); }
    finally { setLifecycleLoading(false); }
  }, [externalTenantId]);

  const applyOverview = useCallback((value: TenantOperationsOverview) => {
    setData(value);
    if (value.entitlements.status !== "not_configured") {
      const allocation = value.entitlementHistory?.find((item) => item.version === value.entitlements.version);
      setEntitlement({
        planCode: value.entitlements.planCode ?? "starter", planVersion: value.entitlements.planVersion ?? 1,
        status: value.entitlements.status, modules: new Set(value.entitlements.modules ?? ["workspace"]),
        seatLimit: Number(allocation?.limits.seatLimit ?? 0), projectLimit: Number(allocation?.limits.projectLimit ?? 0),
        effectiveFrom: value.entitlements.status === "scheduled" ? dateTimeLocal(value.entitlements.effectiveAt) : "",
        effectiveUntil: dateTimeLocal(value.entitlements.effectiveUntil),
        reason: value.entitlements.reason ?? "Update tenant module allocation",
      });
    }
    if (value.dataPolicy.status !== "not_configured") setPolicy({
      storageQuotaGb: Number(value.dataPolicy.storageQuotaBytes ?? 0) / 1024 / 1024 / 1024,
      retentionDays: value.dataPolicy.retentionDays ?? 365, legalHold: Boolean(value.dataPolicy.legalHold),
      scanRequirement: value.dataPolicy.scanRequirement ?? "required",
      exportBeforeErasure: value.dataPolicy.exportBeforeErasure !== false,
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [value, availableCatalog] = await Promise.all([
        responseData<TenantOperationsOverview>(await fetch(`/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations`, { cache: "no-store" })),
        responseData<EntitlementCatalog>(await fetch("/api/internal/entitlements/catalog", { cache: "no-store" })),
      ]);
      applyOverview(value);
      setCatalog(availableCatalog);
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [applyOverview, externalTenantId]);

  useEffect(() => {
    void loadLifecycle();
    let active = true;
    void Promise.all([
      fetch(`/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations`, { cache: "no-store" })
        .then((response) => responseData<TenantOperationsOverview>(response)),
      fetch("/api/internal/entitlements/catalog", { cache: "no-store" })
        .then((response) => responseData<EntitlementCatalog>(response)),
    ])
      .then(([value, availableCatalog]) => { if (active) { applyOverview(value); setCatalog(availableCatalog); } })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applyOverview, externalTenantId, loadLifecycle]);

  const latestSupport = data?.supportSessions[0] ?? null;
  const pendingOperation = data?.operations.find((item) => item.status === "planned") ?? null;
  const rollbackCandidate = data?.operations.find((item) =>
    item.operationType === "clone" && item.phase === "apply" && item.status === "succeeded" && !item.rollbackOf,
  ) ?? null;
  const latestExport = data?.operations.find((item) =>
    item.operationType === "export" && item.status === "succeeded" && item.result?.exportId,
  ) ?? null;
  const usageLabel = useMemo(() => data ? `${bytes(data.usage.knownFileBytes)} across ${data.usage.knownFileCount} known files` : "", [data]);
  const selectedPlan = useMemo(() => catalog?.plans.find((plan) =>
    plan.code === entitlement.planCode && plan.version === entitlement.planVersion) ?? null, [catalog, entitlement.planCode, entitlement.planVersion]);
  const selectableModules = useMemo(() => {
    const configured = selectedPlan?.configuration.modules;
    return configured?.length ? MODULES.filter((module) => module.id === "workspace" || configured.includes(module.id as TenantModuleCode)) : MODULES;
  }, [selectedPlan]);
  const moduleRows = useMemo<ModuleRow[]>(() => {
    if (!data) return [];
    const sold = new Set(data.entitlements.soldModules ?? data.entitlements.modules ?? []);
    const enabled = new Set(data.entitlements.status === "active" ? data.entitlements.modules ?? [] : ["workspace"]);
    return MODULES.map((module) => {
      const exceptions = catalog?.capabilityFlags.filter((flag) => flag.module === module.id && flag.releaseState !== "available") ?? [];
      const unavailable = exceptions.filter((flag) => flag.releaseState === "unavailable").length;
      const preview = exceptions.filter((flag) => flag.releaseState === "internal_preview").length;
      const included = sold.has(module.id as TenantModuleCode);
      const allocated = enabled.has(module.id);
      return {
        id: module.id as TenantModuleCode,
        label: module.label,
        sold: included,
        enabled: allocated,
        allocationState: allocated ? "Enabled" : included ? "Not allocated" : "Not included",
        platformState: unavailable ? `${unavailable} unavailable` : preview ? `${preview} internal preview` : "Available",
        exceptionCount: exceptions.length,
      };
    });
  }, [catalog, data]);
  const currentModules = data?.entitlements.modules ?? [];
  const nextModules = [...entitlement.modules] as TenantModuleCode[];
  const addedModules = nextModules.filter((module) => !currentModules.includes(module));
  const removedModules = currentModules.filter((module) => !nextModules.includes(module));

  async function mutate(path: string, method: "PATCH" | "POST", body: unknown, success: string, key?: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await responseData(await fetch(`/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations/${path}`, {
        method, headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body),
      }));
      setNotice(success); await load(); return true;
    } catch (reason) { setError((reason as Error).message); return false; }
    finally { setBusy(false); }
  }

  function reviewLifecycle() {
    setError(""); setNotice("");
    if (!lifecycle || !lifecycleDraft.to || !lifecycle.nextStates.includes(lifecycleDraft.to)) return;
    if (lifecycleDraft.reason.trim().length < 10) { setError("Explain the lifecycle decision in at least 10 characters."); return; }
    if (lifecycleDraft.to === "grace" && (!lifecycleDraft.graceEndsAt || new Date(lifecycleDraft.graceEndsAt).getTime() <= Date.now())) {
      setError("Choose a future grace end date."); return;
    }
    setLifecycleDecisionKey((key) => key || crypto.randomUUID());
    setShowLifecycleReview(true);
  }

  async function saveLifecycle() {
    if (!lifecycle || !lifecycleDraft.to || !lifecycleDecisionKey) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await responseData(await fetch(`/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations/lifecycle/transitions`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": lifecycleDecisionKey },
        body: JSON.stringify({
          expectedVersion: lifecycle.version,
          to: lifecycleDraft.to,
          reason: lifecycleDraft.reason.trim(),
          ...(lifecycleDraft.to === "grace" ? { graceEndsAt: isoDate(lifecycleDraft.graceEndsAt) } : {}),
        }),
      }));
      setLifecycleDecisionKey(""); setShowLifecycleReview(false);
      setNotice("Lifecycle decision recorded.");
      await Promise.all([loadLifecycle(), load()]);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function saveEntitlement() {
    if (!data) return;
    const limits = {
      ...(entitlement.seatLimit > 0 ? { seatLimit: entitlement.seatLimit } : {}),
      ...(entitlement.projectLimit > 0 ? { projectLimit: entitlement.projectLimit } : {}),
    };
    const saved = await mutate("entitlements", "PATCH", {
      expectedVersion: Math.max(data.entitlements.version ?? 0, ...data.entitlementHistory.map((item) => item.version), 0),
      planCode: entitlement.planCode,
      planVersion: entitlement.planVersion,
      status: entitlement.status,
      modules: [...entitlement.modules],
      limits,
      ...(entitlement.effectiveFrom ? { effectiveFrom: isoDate(entitlement.effectiveFrom) } : {}),
      ...(entitlement.effectiveUntil ? { effectiveUntil: isoDate(entitlement.effectiveUntil) } : {}),
      reason: entitlement.reason,
    }, "Module allocation updated.");
    if (saved) setShowEntitlementReview(false);
  }

  function reviewEntitlement() {
    setError("");
    if (entitlement.status === "scheduled" && !entitlement.effectiveFrom) {
      setError("Choose when the scheduled allocation starts.");
      return;
    }
    if (entitlement.effectiveUntil && entitlement.effectiveFrom
      && new Date(entitlement.effectiveUntil) <= new Date(entitlement.effectiveFrom)) {
      setError("The allocation end must be after its start.");
      return;
    }
    setShowEntitlementReview(true);
  }

  return <DesignSystemProvider theme={theme === "dark" ? "dark" : "light"} locale="en-AE" currency="AED" timeZone="Asia/Dubai">
    <AppShell title="Wodana Control" topActions={<Button size="compact" onPress={() => router.push("/internal")}><ArrowLeft size={14}/>Tenants</Button>}>
      <Container as="main" className={styles.page} size="full">
        <PageHeader eyebrow="Wodana Control" title={data?.organization.name ?? "Tenant operations"} description="Commercial access, support, data governance and safe operation plans." actions={<Button aria-label="Refresh tenant operations" isDisabled={loading} onPress={() => void load()} size="compact"><RefreshCw size={14}/>Refresh</Button>} />
        {error ? <Callout title="Tenant operations unavailable" tone="danger">{error}</Callout> : null}
        {notice ? <Callout title="Saved" tone="success"><CheckCircle2 size={14}/>{notice}</Callout> : null}
        {loading && !data ? <Skeleton lines={8}/> : data ? <div className={styles.sections}>
          <Surface className={styles.summary} aria-label="Tenant operation summary">
            <div><small>Entitlements</small><strong>{data.entitlements.status.replaceAll("_", " ")}</strong><span>{data.entitlements.modules?.join(" · ") ?? "No module allocation configured"}</span></div>
            <div><small>Storage</small><strong>{usageLabel}</strong><span>{data.usage.storagePercent == null ? "No quota configured" : `${data.usage.storagePercent}% of quota`}</span></div>
            <div><small>Adoption · 30 days</small><strong>{data.adoption.activeActors} active people</strong><span>{data.adoption.eventCount} audited events</span></div>
            <div><small>Support access</small><strong>{latestSupport?.status ?? "none"}</strong><span>{latestSupport ? `${latestSupport.accessLevel.replaceAll("_", " ")} · expires ${new Date(latestSupport.expiresAt).toLocaleString()}` : "No open support session"}</span></div>
          </Surface>

          <section className={styles.section} aria-label="Organization lifecycle">
            <div className={styles.sectionTitle}><div><h2>Lifecycle</h2><p>Organization access is separate from billing collection.</p></div>{lifecycle ? <Badge tone={lifecycle.state === "active" ? "success" : lifecycle.state === "suspended" || lifecycle.state === "archived" ? "warning" : "neutral"}>{lifecycle.state}</Badge> : null}</div>
            {lifecycleLoading && !lifecycle ? <Skeleton lines={3}/> : lifecycleError ? <Callout title="Lifecycle unavailable" tone="warning" actions={<Button size="compact" onPress={() => void loadLifecycle()}>Retry</Button>}>{lifecycleError}</Callout> : lifecycle ? <>
              <div className={styles.entitlementFacts}>
                <div><small>Access</small><strong>{lifecycle.workspaceStatus}</strong></div>
                <div><small>Owner setup</small><strong>{lifecycle.readiness.onboardingStatus?.replaceAll("_", " ") ?? "Not started"}</strong></div>
                <div><small>Notice</small><strong>{lifecycle.noticeDeliveryState.replaceAll("_", " ")}</strong></div>
              </div>
              {lifecycle.graceExpired ? <Callout title="Grace period expired" tone="warning">The deadline has passed. Review access; automatic suspension is not configured.</Callout> : null}
              {can("lifecycle.manage") && lifecycle.nextStates.length ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); reviewLifecycle(); }}>
                <div className={styles.formGrid}>
                  <SelectField label="Move to" items={lifecycle.nextStates.map((state) => ({ id: state, label: state[0].toUpperCase() + state.slice(1) }))} selectedKey={lifecycleDraft.to} onSelectionChange={(key) => { setLifecycleDraft({ to: key as TenantLifecycleState, reason: "", graceEndsAt: "" }); setLifecycleDecisionKey(""); }}/>
                  {lifecycleDraft.to === "grace" ? <DateTimeInput label="Grace ends" value={lifecycleDraft.graceEndsAt} onChange={(value) => { setLifecycleDraft({ ...lifecycleDraft, graceEndsAt: value }); setLifecycleDecisionKey(""); }}/>: null}
                </div>
                <TextAreaField label="Reason" value={lifecycleDraft.reason} onChange={(value) => { setLifecycleDraft({ ...lifecycleDraft, reason: value }); setLifecycleDecisionKey(""); }} maxLength={500} isRequired/>
                <Button type="submit" variant="primary" isLoading={busy}>Review lifecycle change</Button>
              </Form> : null}
              {lifecycle.noticeDeliveryState === "not_configured" ? <Callout title="Notice not connected" tone="neutral">This decision is audited, but customer notice has not been sent automatically.</Callout> : null}
              <DataGrid ariaLabel="Lifecycle decision history" columns={lifecycleHistoryColumns} data={lifecycle.history} emptyTitle="No lifecycle decisions" emptyDescription="The first reviewed decision will appear here." getRowId={(row) => row.id} pageSize={5} rowNumbers={false} selectable={false}/>
            </> : null}
          </section>

          <TenantBillingSection externalTenantId={externalTenantId} permissions={permissions} plans={catalog?.plans ?? []}/>

          <section className={styles.section}>
            <div className={styles.sectionTitle}><div><h2>Plan and modules</h2><p>Account contract, organization allocation and platform availability are separate.</p></div><Badge tone={data.entitlements.status === "active" ? "success" : "warning"}>{data.entitlements.status.replaceAll("_", " ")}</Badge></div>
            <DataGrid ariaLabel="Tenant module access" columns={moduleColumns} data={moduleRows} emptyTitle="No module catalogue" emptyDescription="Publish a plan before allocating modules." getRowId={(row) => row.id} pageSize={5} rowNumbers={false} selectable={false}/>
            <div className={styles.entitlementFacts}>
              <div><small>Sold limits</small><strong>{String(data.entitlements.soldLimits?.seatLimit ?? "—")} seats · {String(data.entitlements.soldLimits?.projectLimit ?? "—")} projects</strong></div>
              <div><small>Source</small><strong>{data.entitlements.customOverride ? "Explicit override" : data.entitlements.source === "legacy" ? "Legacy allocation" : "Versioned plan"}</strong></div>
              <div><small>Effective</small><strong>{data.entitlements.effectiveAt ? new Date(data.entitlements.effectiveAt).toLocaleString() : "Not configured"}</strong></div>
            </div>
            {data.entitlements.customOverride ? <Callout title="Plan override recorded" tone="warning">This plan version predates module metadata. The sold modules are stored as an explicit, reasoned override—not inferred from the plan name.</Callout> : null}
            {can("entitlements.manage") ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); reviewEntitlement(); }}>
              <div className={styles.formGrid}>
                <SelectField label="Plan version" items={(catalog?.plans ?? []).map((plan) => ({ id: `${plan.code}:${plan.version}`, label: `${plan.configuration.label ?? plan.code} · v${plan.version}` }))} selectedKey={`${entitlement.planCode}:${entitlement.planVersion}`} onSelectionChange={(key) => {
                  if (!key) return;
                  const plan = catalog?.plans.find((item) => `${item.code}:${item.version}` === String(key));
                  if (!plan) return;
                  const sold = plan.configuration.modules;
                  const modules = sold?.length ? new Set(["workspace", ...[...entitlement.modules].filter((module) => sold.includes(module as TenantModuleCode))]) : entitlement.modules;
                  setEntitlement({ ...entitlement, planCode: plan.code, planVersion: plan.version, modules });
                }}/>
                <SelectField label="Allocation state" items={[{ id: "active", label: "Active" }, { id: "scheduled", label: "Scheduled" }, { id: "suspended", label: "Suspended" }]} selectedKey={entitlement.status} onSelectionChange={(key) => key && setEntitlement({ ...entitlement, status: String(key) })}/>
                <DateTimeInput label={entitlement.status === "scheduled" ? "Starts · required" : "Starts · blank means now"} value={entitlement.effectiveFrom} onChange={(value) => setEntitlement({ ...entitlement, effectiveFrom: value })}/>
              </div>
              <MultiSelectField label="Organization allocation" items={selectableModules} selectedKeys={entitlement.modules} onSelectionChange={(keys) => setEntitlement({ ...entitlement, modules: new Set(["workspace", ...[...keys].map(String)]) })}/>
              <div className={styles.formGrid}>
                <NumericInput label="Seat limit" description="0 inherits the account limit" minValue={0} value={entitlement.seatLimit} onChange={(value) => setEntitlement({ ...entitlement, seatLimit: value })}/>
                <NumericInput label="Project limit" description="0 inherits the account limit" minValue={0} value={entitlement.projectLimit} onChange={(value) => setEntitlement({ ...entitlement, projectLimit: value })}/>
                <DateTimeInput label="Ends · optional" value={entitlement.effectiveUntil} onChange={(value) => setEntitlement({ ...entitlement, effectiveUntil: value })}/>
              </div>
              <TextAreaField label="Reason" value={entitlement.reason} onChange={(value) => setEntitlement({ ...entitlement, reason: value })} maxLength={500} isRequired/>
              <Button type="submit" variant="primary" isLoading={busy}>Review allocation</Button>
            </Form> : <Callout title="Read-only module allocation" tone="neutral">Your operator role can inspect the active allocation but cannot change tenant entitlements.</Callout>}
            <DataGrid ariaLabel="Entitlement allocation history" columns={entitlementHistoryColumns} data={data.entitlementHistory} emptyTitle="No allocation history" emptyDescription="The first reviewed allocation will appear here." getRowId={(row) => String(row.version)} pageSize={5} rowNumbers={false} selectable={false}/>
            <div className={styles.sectionTitle}><div><h3>Platform exceptions</h3><p>Unfinished capability flags do not change what the customer bought.</p></div></div>
            <DataGrid ariaLabel="Platform capability exceptions" columns={capabilityColumns} data={catalog?.capabilityFlags ?? []} emptyTitle="No capability exceptions" emptyDescription="No unavailable or internal-preview feature is recorded." getRowId={(row) => row.code} pageSize={5} rowNumbers={false} selectable={false}/>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}><div><h2>Data governance</h2><p>Managed uploads and known legacy assets are metered. New uploads reserve quota before storage and pass the baseline safety scan.</p></div><Badge tone={data.dataPolicy.scannerStatus === "degraded" || data.dataPolicy.scannerStatus === "not_configured" ? "warning" : "neutral"}>{data.dataPolicy.scannerStatus.replaceAll("_", " ")} scan</Badge></div>
            {can("data.manage") ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void mutate("data-policy", "PATCH", {
              expectedVersion: data.dataPolicy.version ?? 0, storageQuotaBytes: Math.round(policy.storageQuotaGb * 1024 * 1024 * 1024),
              retentionDays: policy.retentionDays, legalHold: policy.legalHold, scanRequirement: policy.scanRequirement,
              exportBeforeErasure: policy.exportBeforeErasure,
            }, "Data policy updated."); }}>
              <div className={styles.formGrid}><NumericInput label="Storage quota" suffix="GB" minValue={0.001} value={policy.storageQuotaGb} onChange={(value) => setPolicy({ ...policy, storageQuotaGb: value })}/><NumericInput label="Retention" suffix="days" minValue={1} maxValue={3650} value={policy.retentionDays} onChange={(value) => setPolicy({ ...policy, retentionDays: value })}/><SelectField label="Safety scan" items={[{ id: "required", label: "Required" }, { id: "optional", label: "Optional" }]} selectedKey={policy.scanRequirement} onSelectionChange={(key) => key && setPolicy({ ...policy, scanRequirement: String(key) })}/></div>
              <div className={styles.switches}><Switch isSelected={policy.exportBeforeErasure} onChange={(value) => setPolicy({ ...policy, exportBeforeErasure: value })}>Require verified export before erasure</Switch><Switch isSelected={policy.legalHold} onChange={(value) => setPolicy({ ...policy, legalHold: value })}>Legal hold</Switch></div>
              <Button type="submit" variant="primary" isLoading={busy}>Save data policy</Button>
            </Form> : <Callout title="Read-only data policy" tone="neutral">Your operator role can inspect storage and retention controls but cannot change or execute them.</Callout>}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}><div><h2>Support access</h2><p>Time-boxed, visibly audited and read-only by default. A second operator must approve access.</p></div><ShieldCheck size={18}/></div>
            {latestSupport ? <div className={styles.support}><div><strong>{latestSupport.status.replaceAll("_", " ")}</strong><span>{latestSupport.reason}</span>{latestSupport.status === "requested" && (!latestSupport.canApprove || !can("support.approve")) ? <span>Awaiting an authorized second operator.</span> : null}</div>{can("support.approve") && latestSupport.status === "requested" && latestSupport.canApprove ? <Button size="compact" isLoading={busy} onPress={() => void mutate(`support-sessions/${latestSupport.id}/decision`, "POST", { expectedVersion: latestSupport.version, decision: "approve", reason: "Second-operator approval after reviewing the support request" }, "Support access approved.")}>Approve</Button> : can("support.approve") && latestSupport.status === "active" && latestSupport.canRevoke ? <Button size="compact" variant="danger" isLoading={busy} onPress={() => void mutate(`support-sessions/${latestSupport.id}/decision`, "POST", { expectedVersion: latestSupport.version, decision: "revoke", reason: "Support work is complete; revoke remaining access" }, "Support access revoked.")}>Revoke</Button> : null}</div> : null}
            {can("support.request") && (!latestSupport || !["requested", "active"].includes(latestSupport.status)) ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void mutate("support-sessions", "POST", support, "Support access requested for second-operator review."); }}><div className={styles.formGrid}><SelectField label="Access" items={[{ id: "read_only", label: "Read only" }, { id: "limited_write", label: "Limited write" }]} selectedKey={support.accessLevel} onSelectionChange={(key) => key && setSupport({ ...support, accessLevel: String(key) })}/><NumericInput label="Duration" suffix="minutes" minValue={15} maxValue={480} value={support.durationMinutes} onChange={(value) => setSupport({ ...support, durationMinutes: value })}/></div><TextAreaField label="Reason" placeholder="Explain the customer issue and exact data needed." value={support.reason} onChange={(value) => setSupport({ ...support, reason: value })} maxLength={500} isRequired/><Button type="submit" variant="primary" isLoading={busy}>Request access</Button></Form> : !can("support.request") && !latestSupport ? <Callout title="No support-session permission" tone="neutral">Your role can review support status but cannot request or approve customer-data access.</Callout> : null}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitle}><div><h2>Safe operations</h2><p>Every operation starts with a dry run. Configuration clones require a second operator; export and erasure stay blocked until their dedicated worker is available.</p></div><Badge tone="neutral">Reviewed changes</Badge></div>
            {can("data.manage") ? <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void mutate("plans", "POST", {
              operationType: operation.operationType,
              ...(operation.operationType === "clone" ? { targetExternalTenantId: operation.targetExternalTenantId } : {}),
              reason: operation.reason,
            }, "Dry-run completed.", crypto.randomUUID()); }}>
              <div className={styles.formGrid}><SelectField label="Operation" items={[{ id: "clone", label: "Configuration clone" }, { id: "export", label: "Tenant export" }, { id: "erasure", label: "Privacy erasure" }]} selectedKey={operation.operationType} onSelectionChange={(key) => key && setOperation({ ...operation, operationType: String(key) })}/>{operation.operationType === "clone" ? <TextInput label="Target tenant ID" value={operation.targetExternalTenantId} onChange={(value) => setOperation({ ...operation, targetExternalTenantId: value })} isRequired/> : null}</div>
              <TextAreaField label="Reason" value={operation.reason} onChange={(value) => setOperation({ ...operation, reason: value })} maxLength={500} isRequired/>
              <Button type="submit" variant="primary" isLoading={busy}>Run dry check</Button>
            </Form> : <Callout title="Operation planning is read-only" tone="neutral">Your role can inspect the audit history but cannot plan, approve, cancel or download tenant data operations.</Callout>}
            {pendingOperation ? <Surface className={styles.operationReview} aria-label="Pending tenant operation">
              <div><strong>{pendingOperation.operationType.replaceAll("_", " ")} ready for review</strong><span>{pendingOperation.reason}</span><span>{pendingOperation.canApprove ? "Dry run passed. Review and approve as the second operator." : pendingOperation.operationType === "clone" || pendingOperation.operationType === "export" ? "Awaiting a second operator." : "Execution is unavailable until the retention-safe erasure worker is connected."}</span></div>
              <div className={styles.operationActions}>
                {can("data.manage") && pendingOperation.canApprove ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void mutate(`${pendingOperation.id}/decision`, "POST", { expectedVersion: pendingOperation.version, decision: "approve", reason: "Second-operator approval after reviewing the dry run and operation scope" }, pendingOperation.operationType === "export" ? "Verified tenant export created." : "Configuration clone applied.")}>{pendingOperation.operationType === "export" ? "Approve export" : "Approve and apply"}</Button> : null}
                {can("data.manage") ? <Button size="compact" variant="danger" isLoading={busy} onPress={() => void mutate(`${pendingOperation.id}/decision`, "POST", { expectedVersion: pendingOperation.version, decision: "cancel", reason: "Operation cancelled after reviewing the dry run" }, "Operation cancelled.")}>Cancel plan</Button> : null}
              </div>
            </Surface> : null}
            {can("data.manage") && rollbackCandidate && !pendingOperation ? <div className={styles.rollback}>
              <div><strong>Last configuration clone</strong><span>{rollbackCandidate.targetExternalTenantId ?? "Target tenant"} can be restored to its pre-clone configuration.</span></div>
              <Button size="compact" isLoading={busy} onPress={() => void mutate("plans", "POST", {
                operationType: "clone", rollbackOf: rollbackCandidate.id,
                targetExternalTenantId: rollbackCandidate.targetExternalTenantId,
                reason: "Restore the target configuration captured before the selected clone",
              }, "Rollback dry-run completed.", crypto.randomUUID())}>Check rollback</Button>
            </div> : null}
            {can("data.manage") && latestExport?.result?.exportId ? <div className={styles.rollback}>
              <div><strong>Verified export</strong><span>{latestExport.result.recordCount ?? 0} records · {latestExport.result.fileCount ?? 0} referenced files · expires in {latestExport.result.expiresInDays ?? 7} days</span></div>
              <Button size="compact" onPress={() => router.push(`/api/internal/tenants/${encodeURIComponent(externalTenantId)}/operations/exports/${latestExport.result!.exportId}`)}>Download export</Button>
            </div> : null}
            <DataGrid ariaLabel="Tenant operation history" columns={operationColumns} data={data.operations} emptyTitle="No operation plans" emptyDescription="Run a dry check before any tenant operation." getRowId={(row) => row.id} pageSize={10} rowNumbers={false} selectable={false}/>
          </section>
        </div> : null}
        <ConfirmationDialog
          isOpen={showLifecycleReview}
          onOpenChange={(open) => { if (!busy) setShowLifecycleReview(open); }}
          title="Record lifecycle decision?"
          body={<div className={styles.reviewBody}>
            <div className={styles.reviewDiff}><div><strong>Organization</strong><span>{lifecycle?.state ?? "—"}</span><span aria-hidden="true">→</span><span>{lifecycleDraft.to}</span></div></div>
            {lifecycleDraft.to === "grace" ? <p>Grace ends {new Date(lifecycleDraft.graceEndsAt).toLocaleString()}.</p> : null}
            <p>Reason: {lifecycleDraft.reason.trim()}</p>
            {lifecycleDraft.to === "suspended" || lifecycleDraft.to === "archived" ? <Callout title="Customer access will stop" tone="warning">Review the affected organization before confirming.</Callout> : null}
            <Callout title="Notice not connected" tone="neutral">This decision will be audited. Customer notice is not sent automatically yet.</Callout>
          </div>}
          confirmLabel="Record decision"
          confirmVariant="primary"
          isConfirming={busy}
          onConfirm={() => void saveLifecycle()}
        />
        <ConfirmationDialog
          isOpen={showEntitlementReview}
          onOpenChange={(open) => { if (!busy) setShowEntitlementReview(open); }}
          title="Apply module allocation?"
          body={<div className={styles.reviewBody}>
            <div className={styles.reviewDiff}>
              <div><strong>Plan</strong><span>{data?.entitlements.planCode ? `${data.entitlements.planCode} · v${data.entitlements.planVersion}` : "Not configured"}</span><span aria-hidden="true">→</span><span>{entitlement.planCode} · v{entitlement.planVersion}</span></div>
              <div><strong>State</strong><span>{data?.entitlements.status.replaceAll("_", " ") ?? "Not configured"}</span><span aria-hidden="true">→</span><span>{entitlement.status.replaceAll("_", " ")}</span></div>
              <div><strong>Modules added</strong><span>—</span><span aria-hidden="true">→</span><span>{addedModules.length ? addedModules.join(" · ") : "None"}</span></div>
              <div><strong>Modules removed</strong><span>—</span><span aria-hidden="true">→</span><span>{removedModules.length ? removedModules.join(" · ") : "None"}</span></div>
              <div><strong>Effective</strong><span>{data?.entitlements.effectiveAt ? new Date(data.entitlements.effectiveAt).toLocaleString() : "Now"}</span><span aria-hidden="true">→</span><span>{entitlement.effectiveFrom ? new Date(entitlement.effectiveFrom).toLocaleString() : "Now"}</span></div>
              <div><strong>Limits</strong><span>{String(data?.entitlements.limits?.seatLimit ?? "Account")} seats · {String(data?.entitlements.limits?.projectLimit ?? "Account")} projects</span><span aria-hidden="true">→</span><span>{entitlement.seatLimit || "Account"} seats · {entitlement.projectLimit || "Account"} projects</span></div>
            </div>
            {removedModules.length || entitlement.status === "suspended" ? <Callout title="Access will be removed" tone="warning">Affected web and mobile entry points disappear, and direct API calls are denied. Existing records stay intact.</Callout> : null}
            {!selectedPlan?.configuration.modules ? <Callout title="Explicit commercial override" tone="warning">This plan version has no module catalogue. The selected modules will be stored as the sold override with your reason.</Callout> : null}
          </div>}
          confirmLabel="Apply allocation"
          confirmVariant="primary"
          isConfirming={busy}
          onConfirm={() => void saveEntitlement()}
        />
      </Container>
    </AppShell>
  </DesignSystemProvider>;
}
