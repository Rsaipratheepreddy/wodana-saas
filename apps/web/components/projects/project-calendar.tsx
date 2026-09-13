"use client";
import { useState } from "react";
import { ControlledModalDialog } from "@/design-system";
import type { ProjectState, ProjectResource } from "@/lib/projects/execution";
import type { WorkCalendar } from "../../../../services/business-core/src/projects/project-calendar";
import s from "./project-workspace.module.css";
const names = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function ProjectCalendar({
  state,
  run,
  busy,
}: {
  state: ProjectState;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const [resource, setResource] = useState<ProjectResource | null>(null),
    [calendar, setCalendar] = useState<WorkCalendar>({
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startTime: "00:00",
      endTime: "24:00",
      holidays: [],
    }),
    [error, setError] = useState("");
  return (
    <div className={s.form}>
      <div className={s.row}>
        <div>
          <h2>Working hours & exceptions</h2>
          <p className={s.muted}>
            Bookings use the resource shift, working days, dated exceptions and
            approved leave. Times are in {state.timezone ?? "workspace time"}.
          </p>
        </div>
      </div>
      <div className={s.scroll}>
        <table data-record-table="" className={s.table}>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Working week</th>
              <th>Daily shift</th>
              <th>Exceptions</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {state.resources.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  <span className={s.detail}>
                    {r.kind} · {r.members.length} members
                  </span>
                </td>
                <td>
                  {r.calendar
                    ? r.calendar.weekdays
                        .map((n) => names[n].slice(0, 3))
                        .join(" · ")
                    : "Every day · no calendar set"}
                </td>
                <td>
                  {r.calendar
                    ? `${r.calendar.startTime}–${r.calendar.endTime}`
                    : "Full day"}
                </td>
                <td>{r.calendar?.holidays.length ?? 0} non-working dates</td>
                <td>
                  {state.canManage && (
                    <button
                      className={s.button}
                      disabled={busy}
                      onClick={() => {
                        setResource(r);
                        setError("");
                        setCalendar(
                          r.calendar ?? {
                            weekdays: [0, 1, 2, 3, 4, 5, 6],
                            startTime: "08:00",
                            endTime: "17:00",
                            holidays: [],
                          },
                        );
                      }}
                    >
                      Edit calendar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ControlledModalDialog
        isOpen={Boolean(resource)}
        onOpenChange={(v) => !v && setResource(null)}
        title={`Calendar · ${resource?.name ?? ""}`}
      >
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run("resource", { resource: { ...resource, calendar } }))
              setResource(null);
            else
              setError(
                "Calendar was not saved. Existing future bookings must be released before a calendar change.",
              );
          }}
        >
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <fieldset className={s.form}>
            <legend>Working days</legend>
            <div className={s.actions}>
              {names.map((name, n) => (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={calendar.weekdays.includes(n)}
                    onChange={(e) =>
                      setCalendar({
                        ...calendar,
                        weekdays: e.target.checked
                          ? [...calendar.weekdays, n].sort()
                          : calendar.weekdays.filter((d) => d !== n),
                      })
                    }
                  />
                  {name.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={s.grid}>
            <label className={s.field}>
              Shift starts
              <input
                required
                type="time"
                value={calendar.startTime}
                onChange={(e) =>
                  setCalendar({ ...calendar, startTime: e.target.value })
                }
              />
            </label>
            <label className={s.field}>
              Shift ends
              <input
                required
                type="time"
                value={
                  calendar.endTime === "24:00" ? "23:59" : calendar.endTime
                }
                onChange={(e) =>
                  setCalendar({ ...calendar, endTime: e.target.value })
                }
              />
            </label>
          </div>
          <div className={s.row}>
            <h3>Non-working dates</h3>
            <button
              type="button"
              className={s.button}
              onClick={() =>
                setCalendar({
                  ...calendar,
                  holidays: [...calendar.holidays, { date: "", reason: "" }],
                })
              }
            >
              Add exception
            </button>
          </div>
          {calendar.holidays.map((h, n) => (
            <div key={n} className={s.grid}>
              <label className={s.field}>
                Date
                <input
                  required
                  type="date"
                  value={h.date}
                  onChange={(e) =>
                    setCalendar({
                      ...calendar,
                      holidays: calendar.holidays.map((v, i) =>
                        i === n ? { ...v, date: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label className={s.field}>
                Reason
                <input
                  required
                  value={h.reason}
                  onChange={(e) =>
                    setCalendar({
                      ...calendar,
                      holidays: calendar.holidays.map((v, i) =>
                        i === n ? { ...v, reason: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                className={s.button}
                type="button"
                onClick={() =>
                  setCalendar({
                    ...calendar,
                    holidays: calendar.holidays.filter((_, i) => i !== n),
                  })
                }
              >
                Remove exception
              </button>
            </div>
          ))}
          <p className={s.muted}>
            Release future bookings before changing a resource calendar. Rebook
            the affected work after reviewing the new availability.
          </p>
          <div className={s.actions}>
            <button
              className={s.button}
              type="button"
              onClick={() => setResource(null)}
            >
              Cancel
            </button>
            <button className={s.primary} disabled={busy}>
              Save calendar
            </button>
          </div>
        </form>
      </ControlledModalDialog>
    </div>
  );
}
