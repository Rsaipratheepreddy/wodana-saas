"use client";
import { useState } from "react";
import type {
  HrmsBootstrap,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
} from "@wodana/contracts";
import {
  Button,
  DataTable,
  SelectField,
  TextArea,
  TextField,
} from "./controls";
import { hrmsRequest, localDay, statusLabel } from "@/lib/hrms/client";
import { Empty, Modal, Notice, useHrms } from "./shared";
import { DecisionDialog } from "./time-summary";
import styles from "./hrms.module.css";
export function LeavePanel({
  workspaceId,
  boot,
  revision,
  onSaved,
}: {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
}) {
  const [team, setTeam] = useState(!boot.employee && boot.permissions.team),
    [year, setYear] = useState(
      Number(localDay(boot.workspace.timezone).slice(0, 4)),
    ),
    [requesting, setRequesting] = useState(false),
    [selected, setSelected] = useState<LeaveRequest | null>(null),
    [cancel, setCancel] = useState<LeaveRequest | null>(null);
  const query = `scope=${team ? "team" : "self"}&year=${year}`;
  const requests = useHrms<LeaveRequest[]>(
      workspaceId,
      `leave/requests?${query}`,
      revision,
    ),
    balances = useHrms<LeaveBalance[]>(
      workspaceId,
      `leave/balances?${query}`,
      revision,
    ),
    types = useHrms<LeaveType[]>(workspaceId, "leave/types", revision);
  return (
    <>
      <div className={styles.toolbar}>
        <div>
          <h2>Leave</h2>
          <p>Request time away and follow its approval.</p>
        </div>
        {boot.employee?.enabled ? (
          <Button
            onClick={() => setRequesting(true)}
            disabled={!types.data?.some((t) => t.active)}
          >
            Request leave
          </Button>
        ) : null}
      </div>
      <div className={styles.filters}>
        {boot.permissions.team ? (
          <SelectField
            id="leave-scope"
            label="Show"
            value={team ? "team" : "self"}
            onChange={(e) => setTeam(e === "team")}
          >
            <option value="self">My leave</option>
            <option value="team">Team leave</option>
          </SelectField>
        ) : null}
        <TextField
          id="leave-year"
          label="Year"
          type="number"
          min={2000}
          max={2200}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </div>
      {requests.error || balances.error || types.error ? (
        <Notice error>{requests.error || balances.error || types.error}</Notice>
      ) : null}
      {balances.data?.length ? (
        <div className={styles.balanceGrid}>
          {balances.data.map((b) => (
            <div
              className={styles.balanceCard}
              key={`${b.membershipId}:${b.leaveTypeId}`}
            >
              <span>
                {team ? `${b.name} · ` : ""}
                {b.leaveTypeName}
              </span>
              <div className={styles.balanceBody}>
                <div className={styles.ring}>
                  <svg viewBox="0 0 100 100" aria-hidden="true">
                    <circle
                      className={styles.ringTrack}
                      cx="50"
                      cy="50"
                      r="43"
                      fill="none"
                      strokeWidth="8"
                    />
                    <circle
                      className={styles.ringValue}
                      cx="50"
                      cy="50"
                      r="43"
                      fill="none"
                      strokeWidth="8"
                      pathLength="100"
                      strokeDasharray={`${b.allowance ? Math.min(100, ((b.used + b.pending) / b.allowance) * 100) : 0} 100`}
                    />
                  </svg>
                  <div>
                    <strong>{b.available}</strong>
                    <small>available</small>
                  </div>
                </div>
                <dl>
                  <dt>Annual allowance</dt>
                  <dd>{b.allowance} days</dd>
                  <dt>Used · pending</dt>
                  <dd>
                    {b.used} · {b.pending}
                  </dd>
                </dl>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.muted}>
          Your leave allowances appear once your attendance profile and leave
          types are configured.
        </p>
      )}
      <div className={styles.leaveOverview}>
        <section className={styles.cleanCard}>
          <h3>Recent leave</h3>
          {requests.data?.length ? (
            <ul className={styles.rows}>
              {requests.data.slice(0, 4).map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>
                      {team ? `${r.name} · ` : ""}
                      {r.leaveTypeName}
                    </strong>
                    <p>{r.reason}</p>
                    <small>
                      {r.startDate} · {r.days} day(s)
                    </small>
                  </div>
                  <span className={styles.status} data-status={r.status}>
                    {statusLabel(r.status)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No leave requests yet.</p>
          )}
        </section>
        <section className={styles.cleanCard}>
          <h3>Coming up</h3>
          <ul className={styles.rows}>
            {[
              ...(requests.data ?? [])
                .filter(
                  (r) =>
                    ["approved", "cancellation_pending"].includes(r.status) &&
                    r.endDate >= localDay(boot.workspace.timezone),
                )
                .map((r) => ({
                  id: r.id,
                  date: r.startDate,
                  title: team
                    ? `${r.name} · ${r.leaveTypeName}`
                    : r.leaveTypeName,
                  detail: `${r.days} day(s) · ${statusLabel(r.status)}`,
                })),
              ...(boot.employee?.calendar.holidays ?? [])
                .filter(
                  (d) =>
                    d >= localDay(boot.workspace.timezone) &&
                    Number(d.slice(0, 4)) === year,
                )
                .map((d) => ({
                  id: `holiday-${d}`,
                  date: d,
                  title: "Work calendar holiday",
                  detail: boot.employee!.calendar.name,
                })),
            ]
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 5)
              .map((item) => (
                <li key={item.id}>
                  <span className={styles.dateTile}>
                    {item.date.slice(8)}
                    <small>
                      {new Date(item.date + "T12:00:00").toLocaleDateString(
                        undefined,
                        { month: "short" },
                      )}
                    </small>
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                </li>
              ))}
          </ul>
          <p className={styles.muted}>
            Approved leave and holidays from your work calendar.
          </p>
        </section>
      </div>
      <div className={styles.sectionHeading}>
        <h2>{team ? "Team leave history" : "Leave history"}</h2>
        <span>{requests.data?.length ?? 0} requests</span>
      </div>
      {requests.loading ? <Notice>Loading leave requests…</Notice> : null}
      {requests.data?.length ? (
        <DataTable
          caption="Leave requests"
          rows={requests.data}
          getRowKey={(r) => r.id}
          columns={[
            ...(team
              ? [
                  {
                    key: "name",
                    header: "Employee",
                    render: (r: LeaveRequest) => r.name,
                  },
                ]
              : []),
            {
              key: "type",
              header: "Leave type",
              render: (r) => r.leaveTypeName,
            },
            {
              key: "dates",
              header: "Dates",
              render: (r) => `${r.startDate} – ${r.endDate}`,
            },
            {
              key: "days",
              header: "Days",
              render: (r) => `${r.days} · ${statusLabel(r.dayPart)}`,
            },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <span className={styles.status} data-status={r.status}>
                  {statusLabel(r.status)}
                </span>
              ),
            },
            {
              key: "reason",
              header: "Reason",
              render: (r) => (
                <>
                  {r.reason}
                  {r.decisionReason ? (
                    <small className={styles.block}>
                      Reviewer: {r.decisionReason}
                    </small>
                  ) : null}
                </>
              ),
            },
            {
              key: "action",
              header: "Actions",
              render: (r) => (
                <div className={styles.actions}>
                  {r.canDecide ? (
                    <Button variant="secondary" onClick={() => setSelected(r)}>
                      Review
                    </Button>
                  ) : null}
                  {r.membershipId === boot.membershipId &&
                  ["pending", "approved"].includes(r.status) ? (
                    <Button variant="ghost" onClick={() => setCancel(r)}>
                      {r.status === "pending" ? "Withdraw" : "Cancel leave"}
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      ) : !requests.loading ? (
        <Empty title="No leave requests">
          Requests for {year} will appear here.
        </Empty>
      ) : null}
      {requesting ? (
        <LeaveForm
          workspaceId={workspaceId}
          types={types.data ?? []}
          timezone={boot.employee?.calendar.timezone ?? boot.workspace.timezone}
          onClose={() => setRequesting(false)}
          onSaved={onSaved}
        />
      ) : null}
      {selected ? (
        <DecisionDialog
          title={
            selected.status === "cancellation_pending"
              ? "Review leave cancellation"
              : "Review leave request"
          }
          detail={
            <p>
              {selected.name} · {selected.days} day(s) · {selected.startDate} to{" "}
              {selected.endDate}
              <br />
              {selected.reason}
              <br />
              {selected.cancellationReason}
            </p>
          }
          onClose={() => setSelected(null)}
          onSubmit={async (decision, reason) => {
            await hrmsRequest(
              workspaceId,
              `leave/requests/${selected.id}/decision`,
              "POST",
              { decision, reason },
            );
            onSaved();
          }}
        />
      ) : null}
      {cancel ? (
        <CancelForm
          workspaceId={workspaceId}
          request={cancel}
          onClose={() => setCancel(null)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}
function LeaveForm({
  workspaceId,
  types,
  timezone,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  types: LeaveType[];
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = localDay(timezone),
    [start, setStart] = useState(today),
    [end, setEnd] = useState(today),
    [type, setType] = useState(types.find((t) => t.active)?.id ?? ""),
    [part, setPart] = useState("full"),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [actionId] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await hrmsRequest(workspaceId, "leave/requests", "POST", {
        actionId,
        leaveTypeId: type,
        startDate: start,
        endDate: end,
        dayPart: part,
        reason,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Request leave" onClose={onClose}>
      <form className={styles.formGrid} onSubmit={submit}>
        <SelectField
          id="leave-type"
          label="Leave type"
          required
          value={type}
          onChange={(e) => {
            setType(e);
            setPart("full");
          }}
        >
          {types
            .filter((t) => t.active)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </SelectField>
        <div className={styles.twoColumns}>
          <TextField
            id="leave-start"
            type="date"
            label="First day"
            required
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (e.target.value > end) setEnd(e.target.value);
            }}
          />
          <TextField
            id="leave-end"
            type="date"
            label="Last day"
            min={start}
            required
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setPart("full");
            }}
          />
        </div>
        <SelectField
          id="leave-part"
          label="Day portion"
          value={part}
          onChange={(e) => setPart(e)}
        >
          <option value="full">Full day(s)</option>
          {start === end && types.find((t) => t.id === type)?.allowHalfDay ? (
            <>
              <option value="first_half">First half</option>
              <option value="second_half">Second half</option>
            </>
          ) : null}
        </SelectField>
        <p className={styles.muted}>
          Working days and holidays follow your calendar. Pending requests
          reserve your balance.
        </p>
        <TextArea
          id="leave-reason"
          label="Reason"
          required
          minLength={3}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? <Notice error>{error}</Notice> : null}
        <Button type="submit" loading={busy}>
          Submit request
        </Button>
      </form>
    </Modal>
  );
}
function CancelForm({
  workspaceId,
  request,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  request: LeaveRequest;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={
        request.status === "pending"
          ? "Withdraw leave"
          : "Request leave cancellation"
      }
      onClose={onClose}
    >
      <form
        className={styles.formGrid}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await hrmsRequest(
              workspaceId,
              `leave/requests/${request.id}/cancel`,
              "POST",
              { reason },
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
        <TextArea
          id="cancel-reason"
          label="Reason"
          required
          minLength={3}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error ? <Notice error>{error}</Notice> : null}
        <Button type="submit" loading={busy}>
          {request.status === "pending"
            ? "Withdraw request"
            : "Send cancellation for approval"}
        </Button>
      </form>
    </Modal>
  );
}
