"use client";
import { useMemo, useState } from "react";
import type {
  HrmsBootstrap,
  HrmsPerson,
  LeaveBalance,
  LeaveType,
  WorkCalendar,
} from "@wodana/contracts";
import {
  Button,
  Checkbox,
  DataTable,
  SelectField,
  TextArea,
  TextField,
} from "./controls";
import { hrmsRequest, localDay } from "@/lib/hrms/client";
import { Empty, Modal, Notice, useHrms } from "./shared";
import Link from "next/link";
import {
  CalendarDays,
  UsersRound,
  MapPin,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import styles from "./hrms.module.css";
type Props = {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
};
export function PeoplePanel({ workspaceId, boot, revision, onSaved }: Props) {
  const {
      data: people,
      error,
      loading,
    } = useHrms<HrmsPerson[]>(workspaceId, "people", revision),
    [selected, setSelected] = useState<HrmsPerson | null>(null),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all");
  const summary = useMemo(() => {
      const rows = people ?? [];
      return {
        enabled: rows.filter((person) => person.enabled).length,
        departments: new Set(
          rows.map((person) => person.department).filter(Boolean),
        ).size,
        managers: new Set(
          rows.map((person) => person.managerId).filter(Boolean),
        ).size,
      };
    }, [people]),
    filtered = useMemo(() => {
      const needle = query.trim().toLocaleLowerCase();
      return (people ?? []).filter((person) => {
        const matchesStatus =
          status === "all" ||
          (status === "enabled" ? person.enabled : !person.enabled);
        const matchesQuery =
          !needle ||
          [
            person.name,
            person.employeeCode,
            person.designation,
            person.department,
          ].some((value) => value.toLocaleLowerCase().includes(needle));
        return matchesStatus && matchesQuery;
      });
    }, [people, query, status]);
  return (
    <>
      <div className={styles.toolbar}>
        <div>
          <h2>People</h2>
          <p>
            Enable attendance for workspace members and set their reporting
            manager.
          </p>
        </div>
        <span className={styles.status}>
          {people?.filter((p) => p.enabled).length ?? 0} enabled
        </span>
      </div>
      {!boot.settings ? (
        <Notice>
          <strong>Attendance setup is incomplete.</strong> Create a work
          calendar and save the policy before enabling employees. {" "}
          <Link href="/workspace/hrms/settings">Open Calendar & policy →</Link>
        </Notice>
      ) : null}
      {error ? <Notice error>{error}</Notice> : null}
      {loading ? <Notice>Loading people…</Notice> : null}
      {people?.length ? (
        <div className={styles.metricGrid} aria-label="People summary">
          <div className={styles.metricCard}>
            <span>Workspace members</span>
            <strong>{people.length}</strong>
            <small>Available for HRMS setup</small>
          </div>
          <div className={styles.metricCard}>
            <span>Attendance enabled</span>
            <strong>{summary.enabled}</strong>
            <small>{people.length - summary.enabled} not enabled</small>
          </div>
          <div className={styles.metricCard}>
            <span>Departments</span>
            <strong>{summary.departments}</strong>
            <small>Across active profiles</small>
          </div>
          <div className={styles.metricCard}>
            <span>Reporting lines</span>
            <strong>{summary.managers}</strong>
            <small>Distinct people managers</small>
          </div>
        </div>
      ) : null}
      {people?.length ? (
        <>
          <div className={styles.tableTools}>
            <TextField
              id="people-search"
              label="Search people"
              type="search"
              placeholder="Name, code, role or department"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <SelectField
              id="people-status"
              label="Attendance status"
              value={status}
              onChange={setStatus}
            >
              <option value="all">All profiles</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Not enabled</option>
            </SelectField>
            <span className={styles.filterCount}>
              {filtered.length} of {people.length}
            </span>
          </div>
          {filtered.length ? (
            <DataTable
              caption="Employee attendance profiles"
              rows={filtered}
              getRowKey={(p) => p.membershipId}
              columns={[
                {
                  key: "name",
                  header: "Employee",
                  render: (p) => (
                    <>
                      <strong>{p.name}</strong>
                      <small className={styles.block}>
                        {p.employeeCode || "No employee code"}
                      </small>
                    </>
                  ),
                },
                {
                  key: "role",
                  header: "Role / department",
                  render: (p) => (
                    <>
                      {p.designation || "—"}
                      <small className={styles.block}>{p.department}</small>
                    </>
                  ),
                },
                {
                  key: "manager",
                  header: "Reports to",
                  render: (p) =>
                    people.find((m) => m.membershipId === p.managerId)?.name ??
                    "Default approver",
                },
                {
                  key: "calendar",
                  header: "Calendar",
                  render: (p) =>
                    boot.calendars.find((c) => c.id === p.calendarId)?.name ??
                    "—",
                },
                {
                  key: "status",
                  header: "Attendance",
                  render: (p) => (
                    <span className={styles.status}>
                      {p.enabled ? "Enabled" : "Not enabled"}
                    </span>
                  ),
                },
                {
                  key: "action",
                  header: "",
                  render: (p) => (
                    <Button
                      variant="secondary"
                      disabled={!boot.settings || p.status !== "active"}
                      onClick={() => setSelected(p)}
                    >
                      {p.version ? "Edit profile" : "Enable attendance"}
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            <Empty title="No matching people">
              Clear the search or choose a different attendance status.
            </Empty>
          )}
        </>
      ) : null}
      {selected ? (
        <PersonForm
          person={selected}
          people={people ?? []}
          workspaceId={workspaceId}
          boot={boot}
          onClose={() => setSelected(null)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}
function PersonForm({
  person,
  people,
  workspaceId,
  boot,
  onClose,
  onSaved,
}: {
  person: HrmsPerson;
  people: HrmsPerson[];
  workspaceId: string;
  boot: HrmsBootstrap;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
      version: person.version,
      enabled: person.enabled ?? true,
      employeeCode: person.employeeCode,
      designation: person.designation,
      department: person.department,
      managerId: person.managerId ?? "",
      calendarId: person.calendarId ?? boot.settings!.defaultCalendarId,
      remoteAllowed: person.remoteAllowed ?? false,
      activeFrom: person.activeFrom ?? localDay(boot.workspace.timezone),
      activeTo: person.activeTo ?? "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function update(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  return (
    <Modal title={person.name} onClose={onClose}>
      <form
        className={styles.formGrid}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await hrmsRequest(
              workspaceId,
              `people/${person.membershipId}`,
              "PUT",
              {
                ...form,
                managerId: form.managerId || null,
                activeTo: form.activeTo || null,
              },
            );
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Checkbox checked={form.enabled} onChange={(e) => update("enabled", e)}>
          Attendance enabled
        </Checkbox>
        <div className={styles.twoColumns}>
          <TextField
            id="person-code"
            label="Employee code"
            optional
            maxLength={40}
            value={form.employeeCode}
            onChange={(e) => update("employeeCode", e.target.value)}
          />
          <TextField
            id="person-role"
            label="Designation"
            optional
            maxLength={120}
            value={form.designation}
            onChange={(e) => update("designation", e.target.value)}
          />
        </div>
        <TextField
          id="person-department"
          label="Department"
          optional
          maxLength={120}
          value={form.department}
          onChange={(e) => update("department", e.target.value)}
        />
        <SelectField
          id="person-manager"
          label="Reporting manager"
          value={form.managerId}
          onChange={(e) => update("managerId", e)}
          hint="The manager also needs HRMS team permission in workspace roles."
        >
          <option value="">Default approver</option>
          {people
            .filter(
              (p) =>
                p.status === "active" && p.membershipId !== person.membershipId,
            )
            .map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
        </SelectField>
        <SelectField
          id="person-calendar"
          label="Work calendar"
          value={form.calendarId}
          onChange={(e) => update("calendarId", e)}
        >
          {boot.calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.timezone}
            </option>
          ))}
        </SelectField>
        <div className={styles.twoColumns}>
          <TextField
            id="person-start"
            label="Attendance starts"
            type="date"
            required
            value={form.activeFrom}
            onChange={(e) => update("activeFrom", e.target.value)}
          />
          <TextField
            id="person-end"
            label="Last working day"
            optional
            type="date"
            min={form.activeFrom}
            value={form.activeTo}
            onChange={(e) => update("activeTo", e.target.value)}
          />
        </div>
        <Checkbox
          checked={form.remoteAllowed}
          onChange={(e) => update("remoteAllowed", e)}
        >
          Allow remote check-in
        </Checkbox>
        {error ? <Notice error>{error}</Notice> : null}
        <Button type="submit" loading={busy}>
          Save employee
        </Button>
      </form>
    </Modal>
  );
}
export function CalendarPanel({ workspaceId, boot, revision, onSaved }: Props) {
  const people = useHrms<HrmsPerson[]>(workspaceId, "people", revision),
    [creating, setCreating] = useState(false);
  return (
    <div className={styles.settingsLayout}>
      <section className={styles.settingsMain}>
        <div className={styles.sectionHeading}>
          <div>
            <h3>Work calendars</h3>
            <p>Manage working days, office hours and holidays for your team.</p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={14} aria-hidden="true" /> Create calendar
          </Button>
        </div>
        {boot.calendars.length ? (
          <ul className={styles.rows}>
            {boot.calendars.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{c.name}</strong>
                  <p>
                    {c.timezone} ·{" "}
                    {c.workingDays
                      .map(
                        (d) =>
                          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d],
                      )
                      .join(", ")}
                  </p>
                  <small>
                    {c.dayStart.slice(0, 5)} – {c.dayEnd.slice(0, 5)} ·{" "}
                    {c.holidays.length} holidays
                  </small>
                </div>
                {c.id === boot.settings?.defaultCalendarId ? (
                  <span className={styles.status}>Default</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.calendarEmpty}>
            <span className={styles.setupIcon}>
              <CalendarDays size={24} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <h3>Set up your work calendar</h3>
            <p>
              Choose your working week, daily hours and holidays.
              <br />
              Assign the calendar to employees to get started.
            </p>
          </div>
        )}
        {boot.calendars.length ? (
          <PolicyForm
            key={boot.settings?.version ?? 0}
            workspaceId={workspaceId}
            boot={boot}
            people={people.data ?? []}
            onSaved={onSaved}
          />
        ) : null}
      </section>
      <aside className={styles.setupGuide} aria-label="Attendance setup">
        <div className={styles.setupGuideHeading}>
          <h3>Attendance setup</h3>
          <p>A few steps to get your team ready.</p>
        </div>
        <div className={styles.setupStep}>
          <span className={styles.setupStepIcon}>
            <CalendarDays size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>Work calendar</strong>
            <small>
              {boot.settings?.defaultCalendarId
                ? "Default calendar is ready"
                : "Set working hours and holidays"}
            </small>
          </div>
          <span className={styles.setupState}>
            {boot.settings?.defaultCalendarId ? "Ready" : "Start here"}
          </span>
        </div>
        <Link className={styles.setupStep} href="/workspace/hrms/people">
          <span className={styles.setupStepIcon}>
            <UsersRound size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>Employee profiles</strong>
            <small>
              {people.data?.filter((p) => p.enabled).length
                ? `${people.data.filter((p) => p.enabled).length} ${people.data.filter((p) => p.enabled).length === 1 ? "employee" : "employees"} enabled`
                : "Enable your workspace members"}
            </small>
          </div>
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
        <Link className={styles.setupStep} href="/workspace/hrms/workplaces">
          <span className={styles.setupStepIcon}>
            <MapPin size={17} aria-hidden="true" />
          </span>
          <div>
            <strong>Offices & project sites</strong>
            <small>Add locations and assign your team</small>
          </div>
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
        <p className={styles.setupFootnote}>
          Attendance captures a photo and location only at check-in or checkout.
        </p>
      </aside>
      {people.error ? <Notice error>{people.error}</Notice> : null}
      {creating ? (
        <CalendarForm
          workspaceId={workspaceId}
          timezone={boot.workspace.timezone}
          onClose={() => setCreating(false)}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}
function CalendarForm({
  workspaceId,
  timezone,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(""),
    [zone, setZone] = useState(timezone),
    [days, setDays] = useState([1, 2, 3, 4, 5, 6]),
    [holidays, setHolidays] = useState(""),
    [start, setStart] = useState("09:00"),
    [half, setHalf] = useState("13:00"),
    [end, setEnd] = useState("18:00"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Create work calendar" onClose={onClose}>
      <form
        className={styles.formGrid}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await hrmsRequest<WorkCalendar>(workspaceId, "calendars", "POST", {
              name,
              timezone: zone,
              workingDays: days.sort(),
              holidays: holidays.split(/[\s,]+/).filter(Boolean),
              dayStart: start,
              halfDay: half,
              dayEnd: end,
            });
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          id="calendar-name"
          label="Calendar name"
          placeholder="Studio · Monday to Saturday"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="calendar-timezone"
          label="Timezone"
          required
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          hint="For example, Asia/Kolkata."
        />
        <fieldset className={styles.fieldset}>
          <legend>Working days</legend>
          <div className={styles.actions}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
              (label, i) => (
                <Checkbox
                  key={label}
                  checked={days.includes(i)}
                  onChange={(e) =>
                    setDays((d) => (e ? [...d, i] : d.filter((x) => x !== i)))
                  }
                >
                  {label}
                </Checkbox>
              ),
            )}
          </div>
        </fieldset>
        <div className={styles.threeColumns}>
          <TextField
            id="calendar-start"
            type="time"
            label="Day starts"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            id="calendar-half"
            type="time"
            label="Half-day boundary"
            required
            value={half}
            onChange={(e) => setHalf(e.target.value)}
          />
          <TextField
            id="calendar-end"
            type="time"
            label="Day ends"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <TextArea
          id="calendar-holidays"
          label="Holiday dates"
          optional
          placeholder="2026-10-02, 2026-12-25"
          hint="Use YYYY-MM-DD, separated by commas or new lines."
          value={holidays}
          onChange={(e) => setHolidays(e.target.value)}
        />
        {error ? <Notice error>{error}</Notice> : null}
        <Button type="submit" loading={busy}>
          Create calendar
        </Button>
      </form>
    </Modal>
  );
}
function PolicyForm({
  workspaceId,
  boot,
  people,
  onSaved,
}: {
  workspaceId: string;
  boot: HrmsBootstrap;
  people: HrmsPerson[];
  onSaved: () => void;
}) {
  const [calendar, setCalendar] = useState(
      boot.settings?.defaultCalendarId ?? boot.calendars[0]?.id ?? "",
    ),
    [approver, setApprover] = useState(boot.settings?.fallbackApproverId ?? ""),
    [accuracy, setAccuracy] = useState(boot.settings?.maxGpsAccuracyM ?? 100),
    [age, setAge] = useState(boot.settings?.maxCaptureAgeSeconds ?? 120),
    [retention, setRetention] = useState(
      boot.settings?.mediaRetentionDays ?? 365,
    ),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <form
      className={styles.settingsForm}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await hrmsRequest(workspaceId, "settings", "PUT", {
            version: boot.settings?.version ?? 0,
            defaultCalendarId: calendar,
            fallbackApproverId: approver || null,
            maxGpsAccuracyM: accuracy,
            maxCaptureAgeSeconds: age,
            mediaRetentionDays: retention,
          });
          setSaved(true);
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Attendance policy</h3>
      <div className={styles.twoColumns}>
        <SelectField
          id="policy-calendar"
          label="Default work calendar"
          value={calendar}
          required
          onChange={(e) => setCalendar(e)}
        >
          {boot.calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="policy-approver"
          label="Default approver"
          value={approver}
          onChange={(e) => setApprover(e)}
          hint="Handles employees without a reporting manager. Needs HRMS team permission."
        >
          <option value="">Workspace HR administrators</option>
          {people
            .filter((p) => p.status === "active")
            .map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
        </SelectField>
        <TextField
          id="policy-accuracy"
          type="number"
          label="Maximum GPS uncertainty (m)"
          min={5}
          max={500}
          required
          value={accuracy}
          onChange={(e) => setAccuracy(Number(e.target.value))}
        />
        <TextField
          id="policy-age"
          type="number"
          label="Fresh capture window (seconds)"
          min={30}
          max={600}
          required
          value={age}
          onChange={(e) => setAge(Number(e.target.value))}
        />
        <TextField
          id="policy-retention"
          type="number"
          label="Photo access window (days)"
          min={30}
          max={3650}
          required
          value={retention}
          onChange={(e) => setRetention(Number(e.target.value))}
          hint="Older photos are no longer available to viewers."
        />
      </div>
      <p className={styles.muted}>
        Photos and location are collected only when recording attendance.
        Missing or uncertain evidence goes to a reviewer.
      </p>
      {error ? <Notice error>{error}</Notice> : null}
      {saved ? <Notice>Settings saved.</Notice> : null}
      <Button type="submit" loading={busy}>
        Save attendance settings
      </Button>
    </form>
  );
}
export function LeaveSettings({ workspaceId, boot, revision, onSaved }: Props) {
  const types = useHrms<LeaveType[]>(workspaceId, "leave/types", revision),
    [editing, setEditing] = useState<LeaveType | null | undefined>(),
    [year, setYear] = useState(
      Number(localDay(boot.workspace.timezone).slice(0, 4)),
    ),
    [selected, setSelected] = useState<LeaveBalance | null>(null);
  const balances = useHrms<LeaveBalance[]>(
    workspaceId,
    `leave/balances?scope=team&year=${year}`,
    revision,
  );
  return (
    <>
      <div className={styles.sectionHeading}>
        <div>
          <h3>Leave types</h3>
          <p>Simple annual allowances, with optional half-day requests.</p>
        </div>
        <Button variant="secondary" onClick={() => setEditing(null)}>
          Add leave type
        </Button>
      </div>
      {types.error || balances.error ? (
        <Notice error>{types.error || balances.error}</Notice>
      ) : null}
      <ul className={styles.rows}>
        {types.data?.map((t) => (
          <li key={t.id}>
            <div>
              <strong>{t.name}</strong>
              <p>
                {t.annualDays} days annually ·{" "}
                {t.allowHalfDay ? "Half days allowed" : "Full days only"} ·{" "}
                {t.active ? "Active" : "Inactive"}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setEditing(t)}>
              Edit
            </Button>
          </li>
        ))}
      </ul>
      <div className={styles.sectionHeading}>
        <h3>Individual allowances</h3>
        <TextField
          id="allowance-year"
          type="number"
          label="Year"
          min={2000}
          max={2200}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </div>
      {balances.data?.length ? (
        <DataTable
          caption="Employee leave allowances"
          getRowKey={(b) => `${b.membershipId}:${b.leaveTypeId}`}
          rows={balances.data}
          columns={[
            { key: "name", header: "Employee", render: (b) => b.name },
            { key: "type", header: "Leave", render: (b) => b.leaveTypeName },
            { key: "total", header: "Allowance", render: (b) => b.allowance },
            {
              key: "used",
              header: "Used / pending",
              render: (b) => `${b.used} / ${b.pending}`,
            },
            {
              key: "action",
              header: "",
              render: (b) => (
                <Button variant="ghost" onClick={() => setSelected(b)}>
                  Adjust allowance
                </Button>
              ),
            },
          ]}
        />
      ) : (
        <p className={styles.muted}>
          Enable employees and add a leave type to manage allowances.
        </p>
      )}
      {editing !== undefined ? (
        <LeaveTypeForm
          workspaceId={workspaceId}
          item={editing}
          onClose={() => setEditing(undefined)}
          onSaved={onSaved}
        />
      ) : null}
      {selected ? (
        <AllowanceForm
          workspaceId={workspaceId}
          balance={selected}
          onClose={() => setSelected(null)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}
function LeaveTypeForm({
  workspaceId,
  item,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  item: LeaveType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? ""),
    [days, setDays] = useState(item?.annualDays ?? 12),
    [half, setHalf] = useState(item?.allowHalfDay ?? true),
    [active, setActive] = useState(item?.active ?? true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={item ? "Edit leave type" : "Add leave type"}
      onClose={onClose}
    >
      <form
        className={styles.formGrid}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await hrmsRequest(workspaceId, "leave/types", "PUT", {
              ...(item ? { id: item.id } : {}),
              version: item?.version ?? 0,
              name,
              annualDays: days,
              allowHalfDay: half,
              active,
            });
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          id="type-name"
          label="Leave name"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="type-days"
          label="Annual allowance (days)"
          required
          type="number"
          min={0}
          max={366}
          step={0.5}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <Checkbox checked={half} onChange={(e) => setHalf(e)}>
          Allow half-day leave
        </Checkbox>
        <Checkbox checked={active} onChange={(e) => setActive(e)}>
          Available for new requests
        </Checkbox>
        <p className={styles.muted}>
          Existing individual allowances remain unchanged. Adjust them in the
          table below.
        </p>
        {error ? <Notice error>{error}</Notice> : null}
        <Button type="submit" loading={busy}>
          Save leave type
        </Button>
      </form>
    </Modal>
  );
}
function AllowanceForm({
  workspaceId,
  balance,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  balance: LeaveBalance;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [days, setDays] = useState(balance.allowance),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Adjust annual allowance" onClose={onClose}>
      <p>
        {balance.name} · {balance.leaveTypeName} · {balance.year}
      </p>
      <form
        className={styles.formGrid}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await hrmsRequest(workspaceId, "leave/allowances", "PUT", {
              membershipId: balance.membershipId,
              leaveTypeId: balance.leaveTypeId,
              year: balance.year,
              days,
              version: balance.version,
            });
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          id="allowance-days"
          label="Total allowance (days)"
          required
          type="number"
          min={0}
          max={366}
          step={0.5}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
        {error ? <Notice error>{error}</Notice> : null}
        <Button type="submit" loading={busy}>
          Save allowance
        </Button>
      </form>
    </Modal>
  );
}
