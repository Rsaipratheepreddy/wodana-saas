"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { today, getLocalTimeZone, type CalendarDate } from "@internationalized/date";
import {
  Badge, Button, DataGrid, DateField, EmptyState, ErrorState, FormDialog, InlineNotice, MoneyField, NumericInput, PercentageInput, SelectField, SettingsPage, SettingsSection, Skeleton, Switch, TextInput,
  isNoAccessError, NoAccessState, useDesignSystem, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import {
  amountText, APPROVER_KINDS, KIND_TITLE, PERMISSION_APPROVERS, policiesApi, stepsLine,
  type Delegation, type DelegationsView, type PoliciesView, type PolicyInput, type PolicyStepDraft, type PolicyView,
} from "@/lib/approvals/policies";
import styles from "./approval-policies.module.css";

type Editing = { kind: string; policy: PolicyView | null };

/**
 * Settings → Approvals (E3): per kind of decision, the policies that apply (amounts from, approvers in order, the
 * Owner above an amount, escalation), and who covers approvals for whom while away.
 */
export function ApprovalPoliciesPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const api = useMemo(() => policiesApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<PoliciesView | null>(null);
  const [cover, setCover] = useState<DelegationsView | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try { const [policies, delegations] = await Promise.all([api.list(), api.delegations()]); setData(policies); setCover(delegations); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Approvals didn't load")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !data) return isNoAccessError(error) ? <NoAccessState area={t("Approvals")} /> : <ErrorState title={t("Approvals didn't load")} description={error} onRetry={() => void load()} />;
  if (!data || !cover) return <Skeleton lines={8} shape="form" />;

  const permissionName = (code: string) => t(PERMISSION_APPROVERS.find((item) => item.code === code)?.label ?? tKey("Approver"));
  const roleName = (code: string) => data.roles.find((role) => role.code === code)?.name ?? code;
  const columns: DataGridColumn<PolicyView>[] = [
    { id: "policy", header: t("Policy"), size: 220, accessorFn: (row) => row.name, meta: { primary: true, renderCell: (row) => <span className={styles.name}>
      <span>{row.name}</span>{row.status === "archived" ? <Badge tone="neutral">{t("Archived")}</Badge> : null}
    </span> } },
    { id: "covers", header: t("Covers"), size: 180, accessorFn: (row) => row.minAmount ?? "", meta: { renderCell: (row) => row.minAmount !== null
      ? t("From {amount}", { amount: amountText(row.minAmount, row.currency, locale) }) : row.currency ? t("All amounts in {currency}", { currency: row.currency }) : t("All amounts") } },
    { id: "approvers", header: t("Approvers in order"), size: 320, accessorFn: (row) => row.steps.length, meta: { renderCell: (row) => <span className={styles.steps}>
      {stepsLine(row, { permission: permissionName, role: roleName, owner: row.ownerAboveAmount !== null ? t("Owner from {amount}", { amount: amountText(row.ownerAboveAmount, row.currency, locale) }) : t("Owner") })
        .map((name, index) => <span key={`${name}-${index}`} className={styles.step}>{name}</span>)}
    </span> } },
    { id: "escalates", header: t("Escalates"), size: 140, accessorFn: (row) => row.escalateAfterHours ?? 0,
      meta: { renderCell: (row) => row.escalateAfterHours ? t("After {hours} hours", { hours: row.escalateAfterHours }) : t("Never") } },
    { id: "waiting", header: t("Waiting"), size: 100, accessorFn: (row) => row.pending, meta: { align: "end" } },
  ];
  const coverColumns: DataGridColumn<Delegation>[] = [
    { id: "away", header: t("Away"), size: 200, accessorFn: (row) => row.userName, meta: { primary: true } },
    { id: "cover", header: t("Covered by"), size: 200, accessorFn: (row) => row.delegateName },
    { id: "until", header: t("Until"), size: 160, accessorFn: (row) => row.endsAt,
      meta: { renderCell: (row) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(row.endsAt)) } },
    { id: "state", header: t("Status"), size: 120, accessorFn: (row) => Number(row.active), meta: { renderCell: (row) => row.active ? <Badge tone="success">{t("Covering now")}</Badge> : <Badge tone="info">{t("Planned")}</Badge> } },
    { id: "end", header: t("End"), size: 100, enableSorting: false, accessorFn: () => "", meta: { renderCell: (row) => cover.canManage || [row.userId].includes(cover.viewerId)
      ? <Button size="compact" variant="quiet" onPress={() => void api.endDelegation(row.id, row.version).then((next) => { setCover(next); setNotice(t("Cover ended.")); }).catch((cause) => setError(cause instanceof Error ? cause.message : t("Could not save.")))}>
        <X aria-hidden="true" size={13} />{t("End")}</Button> : null } },
  ];
  return <SettingsPage title={t("Approvals")} width="wide">
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {data.kinds.map((kind) => {
      const rows = data.policies.filter((policy) => policy.kind === kind);
      return <SettingsSection key={kind} id={`policy-${kind}`} title={t(KIND_TITLE[kind] ?? tKey("Approvals"))}
        actions={data.canManage ? <Button size="compact" onPress={() => setEditing({ kind, policy: null })}><Plus aria-hidden="true" size={14} />{t("Add policy")}</Button> : null}>
        <DataGrid ariaLabel={t(KIND_TITLE[kind] ?? tKey("Approvals"))} wrapText columns={columns} data={rows} getRowId={(row) => row.id} selectable={false} rowNumbers={false} showToolbar={false}
          onRowAction={data.canManage ? (row) => setEditing({ kind, policy: row }) : undefined} pageSize={20} />
      </SettingsSection>;
    })}
    <SettingsSection id="away-cover" title={t("Away cover")} actions={<Button size="compact" onPress={() => setAdding(true)}><Plus aria-hidden="true" size={14} />{t("Add cover")}</Button>}>
      {cover.delegations.length
        ? <DataGrid ariaLabel={t("Away cover")} columns={coverColumns} data={cover.delegations} getRowId={(row) => row.id} selectable={false} rowNumbers={false} showToolbar={false} pageSize={20} />
        : <EmptyState illustration="done" title={t("Nobody is away")} description={t("Add cover so approvals don't wait while someone is away.")}
          action={<Button size="compact" onPress={() => setAdding(true)}>{t("Add cover")}</Button>} />}
    </SettingsSection>
    {editing ? <PolicyDialog editing={editing} data={data} onClose={() => setEditing(null)} onSave={async (input, archive) => {
      const next = editing.policy
        ? archive ? await api.setStatus(editing.policy.id, editing.policy.version, editing.policy.status === "archived" ? "active" : "archived") : await api.update(editing.policy.id, editing.policy.version, input)
        : await api.create(editing.kind, input);
      setData(next); setEditing(null); setNotice(t("Policy saved."));
    }} /> : null}
    {adding ? <CoverDialog data={data} canManage={cover.canManage} viewerId={cover.viewerId} onClose={() => setAdding(false)} onSave={async (input) => {
      setCover(await api.delegate(input)); setAdding(false); setNotice(t("Cover added."));
    }} /> : null}
  </SettingsPage>;
}

const emptyStep = (): PolicyStepDraft => ({ approverKind: "permission", permissionCode: "commercial.deal.approve" });

/** One policy, single column: name, amounts, approvers in order, escalation, separation of duties. */
function PolicyDialog({ editing, data, onClose, onSave }: { editing: Editing; data: PoliciesView; onClose: () => void; onSave: (input: PolicyInput, archive?: boolean) => Promise<void> }) {
  const t = useT();
  const { currency: regionCurrency } = useDesignSystem();
  const policy = editing.policy;
  const [form, setForm] = useState<PolicyInput>(() => policy ? {
    name: policy.name, currency: policy.currency, minAmount: policy.minAmount, ownerAboveAmount: policy.ownerAboveAmount, escalateAfterHours: policy.escalateAfterHours,
    waiverAllowed: policy.waiverAllowed, resetTolerancePercent: policy.resetTolerancePercent,
    steps: policy.steps.map((step) => ({ approverKind: step.approverKind, permissionCode: step.permissionCode, roleCode: step.roleCode, userId: step.userId, label: step.label })),
  } : { name: "", currency: regionCurrency, minAmount: null, ownerAboveAmount: null, escalateAfterHours: null, waiverAllowed: false, resetTolerancePercent: "0",
    steps: [{ approverKind: "permission", permissionCode: "commercial.finance.verify" }, emptyStep()] });
  const initial = useMemo(() => JSON.stringify(form), []); // eslint-disable-line react-hooks/exhaustive-deps
  const currency = form.currency ?? regionCurrency;
  const setStep = (index: number, next: Partial<PolicyStepDraft>) => setForm({ ...form, steps: form.steps.map((step, i) => (i === index ? { ...step, ...next } : step)) });
  const currencies = [...new Set([regionCurrency, policy?.currency].filter((value): value is string => Boolean(value)))];
  return <FormDialog size="md" title={policy ? policy.name : t("New policy")} description={t(KIND_TITLE[editing.kind] ?? tKey("Approvals"))} submitLabel={t("Save")}
    isDirty={JSON.stringify(form) !== initial} onClose={onClose} onSubmit={() => onSave(form)}
    secondaryAction={policy && !policy.isDefault ? <Button variant="quiet" onPress={() => void onSave(form, true)}>{policy.status === "archived" ? t("Restore") : t("Archive")}</Button> : undefined}>
    <TextInput isRequired autoFocus label={t("Name")} value={form.name} onChange={(name) => setForm({ ...form, name })} maxLength={120} />
    <SelectField label={t("Currency")} selectedKey={form.currency ?? "any"} onSelectionChange={(key) => setForm({ ...form, currency: key === "any" ? null : String(key) })}
      items={[{ id: "any", label: t("Any currency") }, ...currencies.map((code) => ({ id: code, label: code }))]} />
    {form.currency ? <>
      <MoneyField label={t("Applies from")} currency={currency} value={form.minAmount ?? ""} onChange={(value) => setForm({ ...form, minAmount: value || null })} />
      <MoneyField label={t("Owner approves from")} currency={currency} value={form.ownerAboveAmount ?? ""} onChange={(value) => setForm({ ...form, ownerAboveAmount: value || null })} />
    </> : null}
    <fieldset className={styles.approvers}>
      <legend>{t("Approvers in order")}</legend>
      {form.steps.map((step, index) => <div key={index} className={styles.approver}>
        <span className={styles.position}>{index + 1}</span>
        <SelectField aria-label={t("Approves by")} label={null} selectedKey={step.approverKind}
          onSelectionChange={(key) => setStep(index, key === "permission" ? { approverKind: "permission", permissionCode: "commercial.deal.approve", roleCode: null, userId: null }
            : key === "role" ? { approverKind: "role", roleCode: data.roles[0]?.code ?? "owner", permissionCode: null, userId: null }
            : { approverKind: "person", userId: data.people[0]?.userId ?? null, permissionCode: null, roleCode: null })}
          items={APPROVER_KINDS.map((item) => ({ id: item.id, label: t(item.label) }))} />
        {step.approverKind === "permission" ? <SelectField aria-label={t("Approver")} label={null} selectedKey={step.permissionCode ?? null}
          onSelectionChange={(key) => setStep(index, { permissionCode: String(key) })} items={PERMISSION_APPROVERS.map((item) => ({ id: item.code, label: t(item.label) }))} />
          : step.approverKind === "role" ? <SelectField aria-label={t("Role")} label={null} selectedKey={step.roleCode ?? null}
            onSelectionChange={(key) => setStep(index, { roleCode: String(key) })} items={data.roles.map((role) => ({ id: role.code, label: role.name }))} />
          : <SelectField aria-label={t("Person")} label={null} selectedKey={step.userId ?? null}
            onSelectionChange={(key) => setStep(index, { userId: String(key) })} items={data.people.map((person) => ({ id: person.userId, label: person.name }))} />}
        {form.steps.length > 1 ? <Button size="compact" variant="quiet" aria-label={t("Remove approver {number}", { number: index + 1 })}
          onPress={() => setForm({ ...form, steps: form.steps.filter((_, i) => i !== index) })}><X aria-hidden="true" size={14} /></Button> : null}
      </div>)}
      {form.steps.length < 6 ? <div><Button size="compact" variant="quiet" onPress={() => setForm({ ...form, steps: [...form.steps, emptyStep()] })}><Plus aria-hidden="true" size={14} />{t("Add approver")}</Button></div> : null}
    </fieldset>
    <NumericInput label={t("Escalate after")} suffix={t("hours")} minValue={0} maxValue={999} formatOptions={{ maximumFractionDigits: 0 }}
      value={form.escalateAfterHours ? form.escalateAfterHours : Number.NaN} onChange={(hours) => setForm({ ...form, escalateAfterHours: Number.isFinite(hours) ? hours : null })} />
    <PercentageInput label={t("Change allowed without new approval")} formatOptions={{ maximumFractionDigits: 4 }}
      value={Number(form.resetTolerancePercent || "0")} onChange={(next) => setForm({ ...form, resetTolerancePercent: Number.isFinite(next) ? String(next) : "0" })} />
    <Switch isSelected={form.waiverAllowed} onChange={(waiverAllowed) => setForm({ ...form, waiverAllowed })}>{t("Requester may approve with a recorded reason")}</Switch>
  </FormDialog>;
}

/** Someone covers another person's approvals until a date; people set their own, an administrator anyone's. */
function CoverDialog({ data, canManage, viewerId, onClose, onSave }: {
  data: PoliciesView; canManage: boolean; viewerId: string; onClose: () => void; onSave: (input: { userId?: string; delegateUserId: string; endsAt: string }) => Promise<void>;
}) {
  const t = useT();
  const [away, setAway] = useState(viewerId);
  const [delegate, setDelegate] = useState<string | null>(null);
  const [until, setUntil] = useState<CalendarDate | null>(today(getLocalTimeZone()).add({ days: 7 }));
  const people = data.people.map((person) => ({ id: person.userId, label: person.name }));
  return <FormDialog size="md" title={t("Add cover")} submitLabel={t("Save")} isDirty={Boolean(delegate)} isSubmitDisabled={!delegate || !until} onClose={onClose}
    onSubmit={() => onSave({ userId: away, delegateUserId: delegate!, endsAt: until!.add({ days: 1 }).toDate(getLocalTimeZone()).toISOString() })}>
    {canManage ? <SelectField label={t("Away")} selectedKey={away} onSelectionChange={(key) => setAway(String(key))} items={people} /> : null}
    <SelectField isRequired label={t("Covered by")} selectedKey={delegate} onSelectionChange={(key) => setDelegate(String(key))} items={people.filter((person) => person.id !== away)} />
    <DateField isRequired label={t("Until")} minValue={today(getLocalTimeZone())} value={until} onChange={(value) => setUntil(value as CalendarDate | null)} />
  </FormDialog>;
}

