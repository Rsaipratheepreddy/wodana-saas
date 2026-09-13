"use client";
/* eslint-disable @next/next/no-img-element -- attendance evidence is streamed privately through the authenticated BFF. */
import { useState } from "react";
import type {
  AttendanceDay,
  AttendanceEvent,
  AttendanceHistory,
  AttendanceReview,
  HrmsBootstrap,
} from "@wodana/contracts";
import { Button, DataTable, TextArea, TextField } from "./controls";
import {
  hrmsRequest,
  hrmsUrl,
  localDay,
  minutesLabel,
  statusLabel,
  timeLabel,
} from "@/lib/hrms/client";
import { Empty, Modal, Notice, useHrms } from "./shared";
import styles from "./hrms.module.css";
type Props = {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
  team?: boolean;
};
export function AttendanceHistoryPanel(props: Props) {
  if (!props.team && !props.boot.employee)
    return (
      <Empty title="No attendance profile">
        Your administrator can enable attendance in People.
      </Empty>
    );
  return <History {...props} />;
}
function History({
  workspaceId,
  boot,
  revision,
  onSaved,
  team = false,
}: Props) {
  const timezone = boot.employee?.calendar.timezone ?? boot.workspace.timezone;
  const today = localDay(timezone),
    [from, setFrom] = useState(today.slice(0, 8) + "01"),
    [to, setTo] = useState(today);
  const query = `from=${from}&to=${to}&scope=${team ? "team" : "self"}`;
  const { data, error, loading } = useHrms<AttendanceHistory>(
    workspaceId,
    `attendance/history?${query}`,
    revision,
  );
  const reviews = useHrms<AttendanceReview[]>(
    workspaceId,
    `reviews?scope=${team ? "team" : "self"}`,
    revision,
  );
  const [selected, setSelected] = useState<AttendanceDay | null>(null);
  const total = data?.days.reduce((sum, d) => sum + d.workedMinutes, 0) ?? 0;
  return (
    <>
      <div className={styles.toolbar}>
        <div>
          <h2>{team ? "Team attendance" : "Time summary"}</h2>
          <p>
            Every session adds to your day. Open sessions stay marked as in
            progress.
          </p>
        </div>
        <a
          className={styles.linkButton}
          href={hrmsUrl(workspaceId, `attendance/export?${query}`)}
        >
          Export CSV
        </a>
      </div>
      <div className={styles.filters}>
        <TextField
          id="history-from"
          type="date"
          label="From"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField
          id="history-to"
          type="date"
          label="To"
          required
          min={from}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Button
          variant="secondary"
          onClick={() => {
            setFrom(today);
            setTo(today);
          }}
        >
          Today
        </Button>
        <strong>{minutesLabel(total)} completed</strong>
      </div>
      {error ? <Notice error>{error}</Notice> : null}
      {loading ? <Notice>Loading attendance…</Notice> : null}
      {data?.days.length ? (
        <DataTable
          caption="Daily attendance summary"
          getRowKey={(d) => `${d.membershipId}:${d.date}`}
          rows={data.days}
          columns={[
            ...(team
              ? [
                  {
                    key: "name",
                    header: "Employee",
                    render: (d: AttendanceDay) => d.name,
                  },
                ]
              : []),
            {
              key: "date",
              header: "Date",
              render: (d) => (
                <Button variant="ghost" onClick={() => setSelected(d)}>
                  {d.date}
                </Button>
              ),
            },
            {
              key: "in",
              header: "First in",
              render: (d) => timeLabel(d.firstIn, d.timezone),
            },
            {
              key: "out",
              header: "Last out",
              render: (d) =>
                d.open ? "In progress" : timeLabel(d.lastOut, d.timezone),
            },
            {
              key: "hours",
              header: "Completed",
              render: (d) => minutesLabel(d.workedMinutes),
            },
            {
              key: "status",
              header: "Status",
              render: (d) => (
                <span className={styles.status} data-status={d.status}>
                  {statusLabel(d.status)}
                  {d.leaveDays ? ` · ${d.leaveDays} day leave` : ""}
                </span>
              ),
            },
            {
              key: "work",
              header: "Work context",
              render: (d) =>
                d.breakdown
                  .map((b) => `${b.name} (${minutesLabel(b.minutes)})`)
                  .join(", ") || "—",
            },
          ]}
        />
      ) : !loading && !error ? (
        <Empty title="No records in this range">
          Select dates within the employee’s attendance period.
        </Empty>
      ) : null}
      <Reviews
        workspaceId={workspaceId}
        items={reviews.data ?? []}
        evidence={boot.permissions.evidence}
        team={team}
        onSaved={onSaved}
      />
      {reviews.error ? <Notice error>{reviews.error}</Notice> : null}
      {selected && data ? (
        <DayDetail
          workspaceId={workspaceId}
          day={selected}
          data={data}
          boot={boot}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}
export function DecisionDialog({
  title,
  detail,
  onClose,
  onSubmit,
}: {
  title: string;
  detail?: React.ReactNode;
  onClose: () => void;
  onSubmit: (
    decision: "approve" | "reject",
    reason: string,
  ) => Promise<unknown>;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function decide(decision: "approve" | "reject") {
    if (reason.trim().length < 3) {
      setError("Add a short reason for your decision.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(decision, reason);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {detail}
      <TextArea
        id="decision-reason"
        label="Decision reason"
        required
        minLength={3}
        maxLength={2000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error ? <Notice error>{error}</Notice> : null}
      <footer className={styles.actions}>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void decide("reject")}
        >
          Reject
        </Button>
        <Button loading={busy} onClick={() => void decide("approve")}>
          Approve
        </Button>
      </footer>
    </Modal>
  );
}
function Reviews({
  workspaceId,
  items,
  evidence,
  team,
  onSaved,
}: {
  workspaceId: string;
  items: AttendanceReview[];
  evidence: boolean;
  team: boolean;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<AttendanceReview | null>(null);
  return (
    <>
      <div className={styles.sectionHeading}>
        <h2>{team ? "Attendance approvals" : "My attendance requests"}</h2>
        <span>
          {items.filter((r) => r.status === "pending").length} pending
        </span>
      </div>
      {items.length ? (
        <ul className={styles.rows}>
          {items.map((r) => (
            <li key={r.id}>
              <div>
                <strong>
                  {team ? `${r.name} · ` : ""}
                  {statusLabel(r.kind)}
                </strong>
                <p>{r.reason}</p>
                {r.requestedAt ? (
                  <small>
                    Requested time: {new Date(r.requestedAt).toLocaleString()}
                  </small>
                ) : null}
                {r.decisionReason ? <p>Reviewer: {r.decisionReason}</p> : null}
              </div>
              <span className={styles.status}>{statusLabel(r.status)}</span>
              <Button variant="secondary" onClick={() => setSelected(r)}>
                {r.canDecide ? "Review" : "Details"}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>No attendance requests.</p>
      )}
      {selected ? (
        selected.canDecide ? (
          <DecisionDialog
            title={`Review ${statusLabel(selected.kind).toLowerCase()}`}
            detail={
              <ReviewEvidence
                row={selected}
                workspaceId={workspaceId}
                showPhoto={evidence}
              />
            }
            onClose={() => setSelected(null)}
            onSubmit={async (decision, reason) => {
              await hrmsRequest(
                workspaceId,
                `reviews/${selected.id}/decision`,
                "POST",
                { decision, reason },
              );
              onSaved();
            }}
          />
        ) : (
          <Modal title="Attendance request" onClose={() => setSelected(null)}>
            <ReviewEvidence
              row={selected}
              workspaceId={workspaceId}
              showPhoto={!team || evidence}
            />
            <p>
              {statusLabel(selected.status)}
              {selected.decisionReason ? ` · ${selected.decisionReason}` : ""}
            </p>
          </Modal>
        )
      ) : null}
    </>
  );
}
function ReviewEvidence({
  row,
  workspaceId,
  showPhoto,
}: {
  row: AttendanceReview;
  workspaceId: string;
  showPhoto: boolean;
}) {
  return (
    <div className={styles.evidence}>
      <p>
        {row.name} · {row.reason}
      </p>
      {row.originalAt ? (
        <p>Previous: {new Date(row.originalAt).toLocaleString()}</p>
      ) : null}
      {row.requestedAt ? (
        <p>Requested: {new Date(row.requestedAt).toLocaleString()}</p>
      ) : null}
      <p>{row.evidence?.issues?.map(statusLabel).join(" · ")}</p>
      {row.evidence?.position ? (
        <p>
          GPS {row.evidence.position.latitude.toFixed(5)},{" "}
          {row.evidence.position.longitude.toFixed(5)} · ±
          {Math.round(row.evidence.position.accuracyM)} m
        </p>
      ) : null}
      {row.captureId && row.evidence?.photoCaptured && showPhoto ? (
        <img
          src={hrmsUrl(workspaceId, `captures/${row.captureId}/photo`)}
          alt="Attendance evidence"
        />
      ) : null}
    </div>
  );
}
function DayDetail({
  workspaceId,
  day,
  data,
  boot,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  day: AttendanceDay;
  data: AttendanceHistory;
  boot: HrmsBootstrap;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sessions = data.sessions.filter(
    (s) =>
      s.membershipId === day.membershipId &&
      localDay(s.calendar.timezone, new Date(s.startedAt)) <= day.date &&
      (!s.endedAt ||
        localDay(s.calendar.timezone, new Date(s.endedAt)) >= day.date),
  );
  const events = data.events.filter((e) =>
    sessions.some((s) => s.id === e.sessionId),
  );
  const [correction, setCorrection] = useState<{
      sessionId: string;
      event?: AttendanceEvent;
    } | null>(null),
    [requested, setRequested] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const own = day.membershipId === boot.membershipId;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!correction) return;
    setBusy(true);
    try {
      await hrmsRequest(workspaceId, "reviews", "POST", {
        actionId: crypto.randomUUID(),
        sessionId: correction.sessionId,
        kind: correction.event ? "correction" : "missing_checkout",
        ...(correction.event ? { eventId: correction.event.id } : {}),
        requestedAt: new Date(requested).toISOString(),
        reason,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${day.name} · ${day.date}`} onClose={onClose}>
      <p>
        {minutesLabel(day.workedMinutes)} completed · {day.timezone}
      </p>
      <ol className={styles.timeline}>
        {events.map((event) => (
          <li key={event.id}>
            <div>
              <strong>
                {statusLabel(event.kind)} ·{" "}
                {timeLabel(event.effectiveAt, day.timezone)}
              </strong>
              <p>
                {event.note || "Attendance recorded"}
                {event.originalAt !== event.effectiveAt
                  ? ` · original ${timeLabel(event.originalAt, day.timezone)}`
                  : ""}
              </p>
              <small>
                {event.evidence.issues?.map(statusLabel).join(" · ")}
              </small>
              {(own || boot.permissions.evidence) &&
              event.evidence.photoCaptured &&
              event.captureId ? (
                <a
                  href={hrmsUrl(
                    workspaceId,
                    `captures/${event.captureId}/photo`,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  View photo
                </a>
              ) : null}
            </div>
            {own ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setCorrection({ sessionId: event.sessionId, event });
                  setError("");
                }}
              >
                Request correction
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      {own
        ? sessions
            .filter((s) => !s.endedAt)
            .map((s) => (
              <Button
                key={s.id}
                variant="secondary"
                onClick={() => setCorrection({ sessionId: s.id })}
              >
                Report missing checkout
              </Button>
            ))
        : null}
      {correction ? (
        <form onSubmit={submit} className={styles.formGrid}>
          <h3>
            {correction.event ? "Correct attendance time" : "Missing checkout"}
          </h3>
          <TextField
            id="correct-time"
            label="Requested date and time"
            type="datetime-local"
            required
            value={requested}
            onChange={(e) => setRequested(e.target.value)}
            hint={`Enter time in this device’s timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}
          />
          <TextArea
            id="correct-reason"
            label="Reason"
            required
            minLength={3}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error ? <Notice error>{error}</Notice> : null}
          <Button type="submit" loading={busy}>
            Send for approval
          </Button>
        </form>
      ) : null}
    </Modal>
  );
}
