"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import type { HrmsEmployee, LeaveBalance, LeaveRequest, LeaveType } from "@wodana/contracts";
import {
  Button, ControlledModalDialog, DataGrid, DateField, EmptyState, ErrorState, InlineNotice, InspectorSheet, NoResultsState, SegmentedControl, SelectField, Skeleton, TextAreaField,
  type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi } from "@/lib/hrms/api";
import { Facts, PeriodStepper } from "./hrms-controls";
import { useHrmsFormat, type HrmsFormat } from "./hrms-format";
import { LeaveStatus, useHrmsLabels } from "./hrms-labels";
import styles from "./hrms.module.css";

const MIN_REASON = 3;
const inYear = (request: LeaveRequest, year: number) => Number(request.startDate.slice(0, 4)) <= year && Number(request.endDate.slice(0, 4)) >= year;

/** What's left of a kind of leave: "Annual leave · 12 of 30 left", or for unlimited kinds, what's been used. */
export function balanceLine(balance: LeaveBalance, format: HrmsFormat, t: ReturnType<typeof useT>) {
  return balance.limited && balance.allowance !== null
    ? t("{type} · {left} of {total} left", { type: balance.leaveTypeName, left: format.number(balance.available ?? 0), total: format.number(balance.allowance) })
    : t("{type} · {used} used", { type: balance.leaveTypeName, used: format.number(balance.used) });
}

/** My leave for a year: what's left of each kind, and my requests; a request opens with its decision, and can be cancelled. */
export function LeaveTab({ api, employee, requesting, onRequestDone, openId, onOpen }: {
  api: HrmsApi; employee: HrmsEmployee; requesting: boolean; onRequestDone: () => void; openId: string | null; onOpen: (id: string | null) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const thisYear = Number(format.today(employee.calendar.timezone).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [types, setTypes] = useState<LeaveType[] | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null);
  const [balances, setBalances] = useState<{ year: number; rows: LeaveBalance[] } | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const loadRequests = useCallback(async () => {
    try {
      const [nextTypes, nextRequests] = await Promise.all([api.leaveTypes(), api.leaveRequests("self")]);
      setTypes(nextTypes); setRequests(nextRequests); setError("");
    } catch (cause) { setError(format.failure(cause, t("Your leave didn't load."))); }
  }, [api, format, t]);
  const loadBalances = useCallback(async () => {
    try { setBalances({ year, rows: await api.balances("self", year) }); } catch (cause) { setError(format.failure(cause, t("Your leave didn't load."))); }
  }, [api, year, format, t]);
  useEffect(() => { queueMicrotask(() => void loadRequests()); }, [loadRequests]);
  useEffect(() => { queueMicrotask(() => void loadBalances()); }, [loadBalances]);
  const reload = () => { void loadRequests(); void loadBalances(); };
  const open = openId ? requests?.find((request) => request.id === openId) ?? null : null;
  const [shown, setShown] = useState<string | null>(null);
  // A link to a request in another year shows that year.
  if (open && open.id !== shown) {
    setShown(open.id);
    if (!inYear(open, year)) setYear(Number(open.startDate.slice(0, 4)));
  }
  const needle = search.trim().toLocaleLowerCase();
  const rows = (requests ?? []).filter((request) => inYear(request, year) && (!needle || `${request.leaveTypeName} ${request.reason}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const columns = useMemo<DataGridColumn<LeaveRequest>[]>(() => [
    { id: "type", header: t("Type"), accessorFn: (row) => row.leaveTypeName, size: 200, meta: { primary: true } },
    { id: "dates", header: t("Dates"), accessorFn: (row) => row.startDate, size: 200, meta: { renderCell: (row) => [format.range(row.startDate, row.endDate), row.dayPart !== "full" ? labels.part(row.dayPart) : ""].filter(Boolean).join(" · ") } },
    { id: "days", header: t("Days"), accessorFn: (row) => row.days, size: 90, meta: { renderCell: (row) => <span className={styles.number}>{format.number(row.days)}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 170, meta: { renderCell: (row) => <LeaveStatus status={row.status} /> } },
  ], [t, format, labels]);
  if (error && !requests) return <ErrorState description={error} onRetry={reload} />;
  const yearBalances = balances?.year === year ? balances.rows : null;
  return <>
    {yearBalances ? yearBalances.length ? <ul className={styles.balances} aria-label={t("Balances")}>{yearBalances.map((balance) => <li key={balance.leaveTypeId}>{balanceLine(balance, format, t)}</li>)}</ul> : null
      : <Skeleton lines={1} />}
    <DataGrid<LeaveRequest> ariaLabel={t("My leave")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!requests} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search leave")} rowNumbers={false} selectable={false} wrapText
      toolbarLeading={<PeriodStepper label={format.year(year)} previousLabel={t("Previous year")} nextLabel={t("Next year")}
        canNext={year <= thisYear} onPrevious={() => setYear(year - 1)} onNext={() => setYear(year + 1)} />}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No leave this year")} />} />
    {open ? <LeaveRequestSheet api={api} request={open} onClose={() => onOpen(null)} onChanged={reload} /> : null}
    {requesting && types ? <RequestLeaveDialog api={api} types={types} balances={yearBalances ?? []} onClose={onRequestDone} onSaved={() => { onRequestDone(); reload(); }} /> : null}
  </>;
}

/** Ask for leave: its kind, the days, half a day when it's one day and the kind allows it, and why. */
function RequestLeaveDialog({ api, types, balances, onClose, onSaved }: {
  api: HrmsApi; types: LeaveType[]; balances: LeaveBalance[]; onClose: () => void; onSaved: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const active = types.filter((type) => type.active);
  const [actionId] = useState(() => crypto.randomUUID());
  const [typeId, setTypeId] = useState<string | null>(active.length === 1 ? active[0].id : null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [part, setPart] = useState<LeaveRequest["dayPart"]>("full");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const type = active.find((item) => item.id === typeId) ?? null;
  const end = to ?? from;
  const halfDay = Boolean(type?.allowHalfDay && from && end === from);
  const backwards = Boolean(from && end && end < from);
  const ready = Boolean(type && from && end && !backwards && reason.trim().length >= MIN_REASON);
  const save = async () => {
    if (!type || !from || !end) return;
    setBusy(true); setError("");
    try {
      await api.requestLeave({ actionId, leaveTypeId: type.id, startDate: from, endDate: end, dayPart: halfDay ? part : "full", reason: reason.trim() });
      onSaved();
    } catch (cause) { setError(format.failure(cause, t("Could not send."))); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="md" title={t("Request leave")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={() => void save()}>{t("Send request")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {!active.length ? <InlineNotice tone="info" message={t("No kinds of leave are set up yet.")} /> : null}
      <SelectField label={t("Type")} isRequired placeholder={t("Choose")} selectedKey={typeId} onSelectionChange={(key) => setTypeId(key ? String(key) : null)}
        items={active.map((item) => { const balance = balances.find((row) => row.leaveTypeId === item.id); return { id: item.id, label: item.name, description: balance ? balanceLine(balance, format, t) : undefined }; })} />
      <div className={styles.pair}>
        <DateField label={t("From")} isRequired value={from ? parseDate(from) : null} onChange={(value) => {
          const next = value ? value.toString() : null;
          setFrom(next);
          if (next && (!to || to < next)) setTo(next);
        }} />
        <DateField label={t("To")} isRequired value={end ? parseDate(end) : null} onChange={(value) => setTo(value ? value.toString() : null)}
          isInvalid={backwards} errorMessage={backwards ? t("The last day can't be before the first.") : undefined} />
      </div>
      {halfDay ? <SegmentedControl label={t("Part of day")} value={part} onChange={(value) => setPart(value as LeaveRequest["dayPart"])}
        options={(["full", "first_half", "second_half"] as const).map((id) => ({ id, label: labels.part(id) }))} /> : null}
      <TextAreaField label={t("Reason")} isRequired value={reason} onChange={setReason} />
    </div>
  </ControlledModalDialog>;
}

/** One of my requests: when, how long, why and what was decided; while it stands, it can be cancelled with a reason. */
function LeaveRequestSheet({ api, request, onClose, onChanged }: { api: HrmsApi; request: LeaveRequest; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const labels = useHrmsLabels();
  const [cancelling, setCancelling] = useState(false);
  const cancellable = request.status === "pending" || request.status === "approved";
  return <InspectorSheet isOpen size="md" title={`${request.leaveTypeName} · ${format.range(request.startDate, request.endDate)}`} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={cancellable ? <div className="wd-dialog-actions"><span className={styles.spacer} /><Button onPress={() => setCancelling(true)}>{t("Cancel request")}</Button></div> : null}>
    <div className={styles.sheet}>
      <Facts items={[
        [t("Status"), <LeaveStatus key="status" status={request.status} />],
        [t("Type"), request.leaveTypeName],
        [t("Dates"), format.range(request.startDate, request.endDate)],
        [t("Days"), [format.days(request.days), request.dayPart !== "full" ? labels.part(request.dayPart) : ""].filter(Boolean).join(" · ")],
        [t("Reason"), request.reason],
        [t("Asked on"), format.moment(request.createdAt)],
        request.decisionReason ? [t("Decision"), request.decisionReason] : null,
        request.cancellationReason ? [t("Why cancelled"), request.cancellationReason] : null,
      ]} />
    </div>
    {cancelling ? <CancelLeaveDialog api={api} request={request} onClose={() => setCancelling(false)} onCancelled={() => { setCancelling(false); onChanged(); }} /> : null}
  </InspectorSheet>;
}

function CancelLeaveDialog({ api, request, onClose, onCancelled }: { api: HrmsApi; request: LeaveRequest; onClose: () => void; onCancelled: () => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Cancel request")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="danger" isLoading={busy} isDisabled={reason.trim().length < MIN_REASON} onPress={async () => {
        setBusy(true); setError("");
        try { await api.cancelLeave(request.id, reason.trim()); onCancelled(); } catch (cause) { setError(format.failure(cause, t("Could not save."))); setBusy(false); }
      }}>{t("Cancel request")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <TextAreaField label={t("Why cancel")} isRequired value={reason} onChange={setReason} />
    </div>
  </ControlledModalDialog>;
}
