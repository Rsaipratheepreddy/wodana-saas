"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import type { HrmsBootstrap, HrmsPerson, LeaveBalance } from "@wodana/contracts";
import {
  Badge, Button, DataGrid, DateField, EmptyState, ErrorState, InlineNotice, InspectorSheet, NoResultsState, NumericInput, SelectField, Skeleton, Switch, TextInput, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi, PersonInput } from "@/lib/hrms/api";
import { useHrmsFormat } from "./hrms-format";
import styles from "./hrms.module.css";

const tracked = (person: HrmsPerson) => person.enabled !== false;

/** Everyone's HR record: title, team, who they report to, their calendar and whether attendance is tracked for them. */
export function PeopleTab({ api, boot, openId, onOpen }: { api: HrmsApi; boot: HrmsBootstrap; openId: string | null; onOpen: (id: string | null) => void }) {
  const t = useT();
  const format = useHrmsFormat();
  const [people, setPeople] = useState<HrmsPerson[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setPeople(await api.people()); setError(""); } catch (cause) { setError(format.failure(cause, t("People didn't load."))); }
  }, [api, format, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const calendarName = useCallback((id: string | null) => boot.calendars.find((calendar) => calendar.id === (id ?? boot.settings?.defaultCalendarId))?.name ?? "", [boot]);
  const nameOf = useCallback((id: string | null) => (id ? people?.find((person) => person.membershipId === id)?.name ?? "" : ""), [people]);
  const columns = useMemo<DataGridColumn<HrmsPerson>[]>(() => [
    { id: "name", header: t("Name"), accessorFn: (row) => row.name, size: 240, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}><span>{row.name}</span><small>{row.email}</small></span> } },
    { id: "designation", header: t("Designation"), accessorFn: (row) => row.designation, size: 180, meta: { mobileHidden: true } },
    { id: "department", header: t("Department"), accessorFn: (row) => row.department, size: 160, meta: { mobileHidden: true } },
    { id: "manager", header: t("Reports to"), accessorFn: (row) => nameOf(row.managerId), size: 180, meta: { mobileHidden: true } },
    { id: "calendar", header: t("Calendar"), accessorFn: (row) => calendarName(row.calendarId), size: 160, meta: { mobileHidden: true } },
    { id: "tracked", header: t("Attendance"), accessorFn: (row) => tracked(row), size: 130,
      meta: { renderCell: (row) => <Badge tone={tracked(row) ? "success" : "neutral"}>{tracked(row) ? t("Tracked") : t("Not tracked")}</Badge> } },
  ], [t, nameOf, calendarName]);
  if (error && !people) return <ErrorState description={error} onRetry={() => void load()} />;
  const needle = search.trim().toLocaleLowerCase();
  const rows = (people ?? []).filter((person) => !needle || [person.name, person.email, person.employeeCode, person.designation, person.department].some((value) => value?.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const open = openId ? people?.find((person) => person.membershipId === openId) ?? null : null;
  return <>
    <DataGrid<HrmsPerson> appearance="flush" ariaLabel={t("People")} columns={columns} data={rows} getRowId={(row) => row.membershipId} isLoading={!people}
      onRowAction={(row) => onOpen(row.membershipId)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search people")} rowNumbers={false} selectable={false} wrapText
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No one yet")} />} />
    {open && people ? <PersonSheet key={open.membershipId} api={api} boot={boot} person={open} people={people} onClose={() => onOpen(null)} onSaved={() => void load()} /> : null}
  </>;
}

type Draft = Omit<PersonInput, "version">;

/** One person's HR record, and their leave for the year with the allowance of each limited kind. */
function PersonSheet({ api, boot, person, people, onClose, onSaved }: {
  api: HrmsApi; boot: HrmsBootstrap; person: HrmsPerson; people: HrmsPerson[]; onClose: () => void; onSaved: () => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const today = format.today(boot.workspace.timezone);
  const year = Number(today.slice(0, 4));
  const initial: Draft = {
    enabled: tracked(person), employeeCode: person.employeeCode, designation: person.designation, department: person.department, managerId: person.managerId,
    calendarId: person.calendarId ?? boot.settings?.defaultCalendarId ?? boot.calendars[0]?.id ?? "", remoteAllowed: person.remoteAllowed ?? false,
    activeFrom: person.activeFrom ?? today, activeTo: person.activeTo,
  };
  const [draft, setDraft] = useState(initial);
  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [allowances, setAllowances] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadBalances = useCallback(async () => {
    try { setBalances((await api.balances("team", year)).filter((row) => row.membershipId === person.membershipId)); } catch { setBalances([]); }
  }, [api, year, person.membershipId]);
  useEffect(() => { if (person.enabled !== false) queueMicrotask(() => void loadBalances()); }, [loadBalances, person.enabled]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const changedAllowances = (balances ?? []).filter((row) => row.limited && allowances[row.leaveTypeId] !== undefined && allowances[row.leaveTypeId] !== row.allowance);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  const dirty = changed || changedAllowances.length > 0;
  const backwards = Boolean(draft.activeTo && draft.activeTo < draft.activeFrom);
  const halfSteps = changedAllowances.every((row) => Number.isFinite(allowances[row.leaveTypeId]) && Number.isInteger(allowances[row.leaveTypeId] * 2) && allowances[row.leaveTypeId] >= 0);
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (changed) await api.savePerson(person.membershipId, { version: person.version, ...draft, employeeCode: draft.employeeCode.trim(), designation: draft.designation.trim(),
        department: draft.department.trim() });
      for (const row of changedAllowances)
        await api.saveAllowance({ membershipId: person.membershipId, leaveTypeId: row.leaveTypeId, year, days: allowances[row.leaveTypeId], version: row.version });
      onSaved();
      onClose();
    } catch (cause) {
      setError(format.failure(cause, t("Could not save.")));
      setBusy(false);
      void loadBalances();
    }
  };
  return <InspectorSheet isOpen size="md" title={person.name} description={person.email} isDirty={dirty && !busy} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={!dirty || backwards || !draft.calendarId || !draft.activeFrom || !halfSteps} onPress={() => void save()}>{t("Save")}</Button></div>}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <div className={styles.switches}>
        <Switch isSelected={draft.enabled} onChange={(value) => set("enabled", value)}>{t("Track attendance")}</Switch>
        <Switch isSelected={draft.remoteAllowed} onChange={(value) => set("remoteAllowed", value)}>{t("Remote allowed")}</Switch>
      </div>
      <div className={styles.pair}>
        <TextInput label={t("Employee code")} value={draft.employeeCode} onChange={(value) => set("employeeCode", value)} maxLength={40} />
        <TextInput label={t("Designation")} value={draft.designation} onChange={(value) => set("designation", value)} maxLength={120} />
      </div>
      <div className={styles.pair}>
        <TextInput label={t("Department")} value={draft.department} onChange={(value) => set("department", value)} maxLength={120} />
        <SelectField label={t("Reports to")} selectedKey={draft.managerId ?? "none"} onSelectionChange={(key) => set("managerId", key && key !== "none" ? String(key) : null)}
          items={[{ id: "none", label: t("No one") }, ...people.filter((item) => item.membershipId !== person.membershipId).map((item) => ({ id: item.membershipId, label: item.name }))]} />
      </div>
      <SelectField label={t("Calendar")} isRequired selectedKey={draft.calendarId || null} placeholder={t("Choose")} onSelectionChange={(key) => set("calendarId", key ? String(key) : "")}
        items={boot.calendars.map((calendar) => ({ id: calendar.id, label: calendar.name }))} />
      <div className={styles.pair}>
        <DateField label={t("Start date")} isRequired value={draft.activeFrom ? parseDate(draft.activeFrom) : null} onChange={(value) => set("activeFrom", value ? value.toString() : "")} />
        <DateField label={t("Last day")} value={draft.activeTo ? parseDate(draft.activeTo) : null} onChange={(value) => set("activeTo", value ? value.toString() : null)}
          isInvalid={backwards} errorMessage={backwards ? t("The last day can't be before the first.") : undefined} />
      </div>
      {person.enabled !== false ? <section className={styles.part} aria-label={t("Leave in {year}", { year: format.year(year) })}>
        <h3 className={styles.subhead}>{t("Leave in {year}", { year: format.year(year) })}</h3>
        {!balances ? <Skeleton lines={2} /> : !balances.length ? <p className={styles.muted}>{t("No kinds of leave are set up yet.")}</p>
          : <ul className={styles.list}>{balances.map((row) => <li key={row.leaveTypeId}>
            <span className={styles.grow}><span>{row.leaveTypeName}</span>
              <small>{[t("{count} used", { count: format.number(row.used) }), row.pending ? t("{count} pending", { count: format.number(row.pending) }) : "",
                row.limited && row.available !== null ? t("{count} left", { count: format.number(row.available) }) : ""].filter(Boolean).join(" · ")}</small></span>
            {row.limited ? <NumericInput aria-label={t("{type} days a year", { type: row.leaveTypeName })} label={null} suffix={format.unit("day")} minValue={0} maxValue={366} step={0.5}
              value={allowances[row.leaveTypeId] ?? row.allowance ?? 0} onChange={(value) => setAllowances((current) => ({ ...current, [row.leaveTypeId]: value }))} />
              : <span className={styles.muted}>{t("Unlimited")}</span>}
          </li>)}</ul>}
      </section> : null}
    </div>
  </InspectorSheet>;
}
