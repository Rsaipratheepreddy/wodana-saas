"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HrmsBootstrap, HrmsPerson, LeaveBalance } from "@wodana/contracts";
import {
  Badge, DataGrid, EditableField, EditableFieldList, EmptyState, ErrorState, InlineNotice, InspectorSheet, NoResultsState, Skeleton, Switch, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { HrmsApi, PersonInput } from "@/lib/hrms/api";
import { HrmsError } from "@/lib/hrms/client";
import { PersonDocuments } from "./documents-tab";
import { useHrmsFormat } from "./hrms-format";
import styles from "./hrms.module.css";

const tracked = (person: HrmsPerson) => person.enabled !== false;

/** Everyone's HR record: title, team, who they report to, their calendar and whether attendance is tracked for them. */
export function PeopleTab({ api, boot, openId, onOpen, onOpenDocument }: {
  api: HrmsApi; boot: HrmsBootstrap; openId: string | null; onOpen: (id: string | null) => void; onOpenDocument?: (id: string) => void;
}) {
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
    <DataGrid<HrmsPerson> gridKey="hrms.people" ariaLabel={t("People")} columns={columns} data={rows} getRowId={(row) => row.membershipId} isLoading={!people}
      onRowAction={(row) => onOpen(row.membershipId)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search people")} rowNumbers={false} selectable={false} wrapText
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No one yet")} />} />
    {open && people ? <PersonSheet key={open.membershipId} api={api} boot={boot} person={open} people={people} onClose={() => onOpen(null)} onSaved={() => void load()}
      onOpenDocument={onOpenDocument} /> : null}
  </>;
}

type Draft = Omit<PersonInput, "version">;

/**
 * One person's HR record, and their leave for the year with the allowance of each limited kind. Every value
 * edits in place and saves on its own, with the record's version (a switch applies at once).
 */
function PersonSheet({ api, boot, person, people, onClose, onSaved, onOpenDocument }: {
  api: HrmsApi; boot: HrmsBootstrap; person: HrmsPerson; people: HrmsPerson[]; onClose: () => void; onSaved: () => void; onOpenDocument?: (id: string) => void;
}) {
  const t = useT();
  const format = useHrmsFormat();
  const today = format.today(boot.workspace.timezone);
  const year = Number(today.slice(0, 4));
  const [record, setRecord] = useState<Draft & { version: number }>(() => ({
    enabled: tracked(person), employeeCode: person.employeeCode, designation: person.designation, department: person.department, managerId: person.managerId,
    calendarId: person.calendarId ?? boot.settings?.defaultCalendarId ?? boot.calendars[0]?.id ?? "", remoteAllowed: person.remoteAllowed ?? false,
    activeFrom: person.activeFrom ?? today, activeTo: person.activeTo, version: person.version,
  }));
  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [error, setError] = useState("");
  const loadBalances = useCallback(async () => {
    try { setBalances((await api.balances("team", year)).filter((row) => row.membershipId === person.membershipId)); } catch { setBalances([]); }
  }, [api, year, person.membershipId]);
  useEffect(() => { if (person.enabled !== false) queueMicrotask(() => void loadBalances()); }, [loadBalances, person.enabled]);
  /** Saves the record with one change and its version; the reason goes back to the field (a clash reloads the list). */
  const save = async (patch: Partial<Draft>) => {
    const next = { ...record, ...patch };
    try {
      const { version, ...input } = next;
      const result = await api.savePerson(person.membershipId, { version, ...input, employeeCode: input.employeeCode.trim(), designation: input.designation.trim(), department: input.department.trim() }) as { version?: number } | undefined;
      setRecord({ ...next, version: result?.version ?? version + 1 });
      setError("");
      onSaved();
    } catch (cause) {
      if (cause instanceof HrmsError && cause.status === 409) onSaved();
      throw cause;
    }
  };
  const toggle = (key: "enabled" | "remoteAllowed") => (value: boolean) => { void save({ [key]: value }).catch((cause) => setError(format.failure(cause, t("Could not save.")))); };
  const people_ = [{ id: "", label: t("No one") }, ...people.filter((item) => item.membershipId !== person.membershipId).map((item) => ({ id: item.membershipId, label: item.name }))];
  return <InspectorSheet isOpen size="md" title={person.name} description={person.email} onOpenChange={(value) => { if (!value) onClose(); }}>
    <div className={styles.sheet}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <div className={styles.switches}>
        <Switch isSelected={record.enabled} onChange={toggle("enabled")}>{t("Track attendance")}</Switch>
        <Switch isSelected={record.remoteAllowed} onChange={toggle("remoteAllowed")}>{t("Remote allowed")}</Switch>
      </div>
      <EditableFieldList>
        <EditableField label={t("Employee code")} maxLength={40} onReload={onSaved} onSave={(employeeCode) => save({ employeeCode })} value={record.employeeCode} />
        <EditableField label={t("Designation")} maxLength={120} onReload={onSaved} onSave={(designation) => save({ designation })} value={record.designation} />
        <EditableField label={t("Department")} maxLength={120} onReload={onSaved} onSave={(department) => save({ department })} value={record.department} />
        <EditableField display={people_.find((item) => item.id === (record.managerId ?? ""))?.label} items={people_} kind="select" label={t("Reports to")} onReload={onSaved}
          onSave={(managerId) => save({ managerId: managerId || null })} value={record.managerId ?? ""} />
        <EditableField isRequired items={boot.calendars.map((calendar) => ({ id: calendar.id, label: calendar.name }))} kind="select" label={t("Calendar")} onReload={onSaved}
          onSave={(calendarId) => save({ calendarId })} value={record.calendarId} />
        <EditableField display={record.activeFrom ? format.day(record.activeFrom) : undefined} isRequired kind="date" label={t("Start date")} onReload={onSaved} onSave={(activeFrom) => save({ activeFrom })}
          validate={(from) => from && record.activeTo && record.activeTo < from ? t("The last day can't be before the first.") : null} value={record.activeFrom} />
        <EditableField display={record.activeTo ? format.day(record.activeTo) : undefined} kind="date" label={t("Last day")} onReload={onSaved} onSave={(activeTo) => save({ activeTo: activeTo || null })}
          placeholder={t("Not set")} validate={(to) => to && to < record.activeFrom ? t("The last day can't be before the first.") : null} value={record.activeTo ?? ""} />
      </EditableFieldList>
      {person.enabled !== false ? <section className={styles.part} aria-label={t("Leave in {year}", { year: format.year(year) })}>
        <h3 className={styles.subhead}>{t("Leave in {year}", { year: format.year(year) })}</h3>
        {!balances ? <Skeleton lines={2} /> : !balances.length ? <p className={styles.muted}>{t("No kinds of leave are set up yet.")}</p>
          : <ul className={styles.list}>{balances.map((row) => <li key={row.leaveTypeId}>
            <span className={styles.grow}><span>{row.leaveTypeName}</span>
              <small>{[t("{count} used", { count: format.number(row.used) }), row.pending ? t("{count} pending", { count: format.number(row.pending) }) : "",
                row.limited && row.available !== null ? t("{count} left", { count: format.number(row.available) }) : ""].filter(Boolean).join(" · ")}</small></span>
            {row.limited ? <EditableFieldList><EditableField display={`${format.number(row.allowance ?? 0)} ${format.unit("day")}`} label={t("{type} days a year", { type: row.leaveTypeName })} onReload={() => void loadBalances()}
              onSave={async (days) => { await api.saveAllowance({ membershipId: person.membershipId, leaveTypeId: row.leaveTypeId, year, days: Number(days), version: row.version }); await loadBalances(); }}
              validate={(days) => /^\d+(\.[05])?$/.test(days) && Number(days) <= 366 ? null : t("Enter whole or half days, up to 366.")} value={String(row.allowance ?? 0)} /></EditableFieldList>
              : <span className={styles.muted}>{t("Unlimited")}</span>}
          </li>)}</ul>}
      </section> : null}
      {onOpenDocument ? <PersonDocuments api={api} membershipId={person.membershipId} onOpen={onOpenDocument} /> : null}
    </div>
  </InspectorSheet>;
}
