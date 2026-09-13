"use client";
import { useState } from "react";
import { ControlledModalDialog } from "@/design-system";
import type { ProjectState } from "@/lib/projects/execution";
import { previewReschedule } from "../../../../services/business-core/src/projects/project-reschedule";
import s from "./project-workspace.module.css";
export function ScheduleReplan({
  state,
  run,
  busy,
}: {
  state: ProjectState;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false),
    [taskId, setTaskId] = useState(""),
    [start, setStart] = useState(""),
    [note, setNote] = useState(""),
    [released, setReleased] = useState(false),
    [error, setError] = useState("");
  let changes: ReturnType<typeof previewReschedule> = [];
  let problem = "";
  if (taskId && start)
    try {
      changes = previewReschedule(
        state.data.tasks,
        state.resources,
        taskId,
        start,
      );
    } catch (e) {
      problem = (e as Error).message;
    }
  const bookings = state.bookings.filter(
    (b) => b.projectId === state.id && changes.some((c) => c.id === b.taskId),
  );
  return (
    <>
      <button
        className={s.button}
        disabled={busy}
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        Review date change
      </button>
      <ControlledModalDialog
        isOpen={open}
        onOpenChange={setOpen}
        title="Review schedule impact"
      >
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run("reschedule", {
                taskId,
                start,
                note,
                expectedChanges: changes,
                releaseBookings: released,
              })
            ) {
              setOpen(false);
            } else
              setError(
                "The change was not applied. Review the project message and latest schedule.",
              );
          }}
        >
          <div className={s.grid}>
            <label className={s.field}>
              Move this task
              <select
                required
                value={taskId}
                onChange={(e) => {
                  setTaskId(e.target.value);
                  setReleased(false);
                }}
              >
                <option value="">Choose unfinished work…</option>
                {state.data.tasks
                  .filter((t) => !["completed", "cancelled"].includes(t.status))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className={s.field}>
              New forecast start
              <input
                required
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setReleased(false);
                }}
              />
            </label>
          </div>
          <p className={s.muted}>
            Preview includes dependent work and each resource’s working
            calendar. Original baseline dates stay recorded.
          </p>
          {(problem || error) && (
            <p className={s.error} role="alert">
              {problem || error}
            </p>
          )}
          <div className={s.scroll}>
            <table data-record-table="" className={s.table}>
              <thead>
                <tr>
                  <th>Affected task</th>
                  <th>Current forecast</th>
                  <th>Proposed forecast</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.title}</td>
                    <td>
                      {c.fromStart} → {c.fromEnd}
                    </td>
                    <td>
                      {c.start} → {c.end}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bookings.length > 0 && (
            <label className={s.check}>
              <input
                type="checkbox"
                checked={released}
                onChange={(e) => setReleased(e.target.checked)}
              />
              Release {bookings.length} affected bookings. I will review
              availability and confirm their new bookings.
            </label>
          )}
          <label className={s.field}>
            Reason / instruction reference
            <textarea
              required
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className={s.actions}>
            <button
              type="button"
              className={s.button}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button
              className={s.primary}
              disabled={
                busy ||
                !changes.length ||
                Boolean(problem) ||
                Boolean(bookings.length && !released)
              }
            >
              Apply reviewed change
            </button>
          </div>
        </form>
      </ControlledModalDialog>
    </>
  );
}
