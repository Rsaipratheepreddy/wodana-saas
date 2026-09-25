"use client";

import type { CSSProperties } from "react";
import { Check, Flag, TriangleAlert } from "lucide-react";
import type { ProjectData, ProjectState, Task } from "@/lib/projects/execution";
import { label, taskProgress } from "@/lib/projects/execution";
import { ScheduleReplan } from "./schedule-replan";
import s from "./project-workspace.module.css";

export type Milestone = NonNullable<ProjectData["milestones"]>[number];

const dayValue = (date: string) => Date.parse(`${date}T12:00:00Z`);
const days = (start: string, end: string) =>
  Math.round((dayValue(end) - dayValue(start)) / 86400000);
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const clamp = (value: number) => Math.min(100, Math.max(0, value));

export function ProjectSchedule({
  state,
  onTask,
  onMilestone,
  onAccept,
  milestonesOnly = false,
  run,
  busy = false,
}: {
  state: ProjectState;
  run?: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
  busy?: boolean;
  onTask: (task: Task) => void;
  onMilestone: (milestone?: Milestone) => void;
  onAccept: (milestone: Milestone) => void;
  milestonesOnly?: boolean;
}) {
  const d = state.data;
  const today = new Date().toISOString().slice(0, 10);
  const milestones = [...(d.milestones ?? [])].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate),
  );
  const tasks = d.tasks
    .filter((task) => task.status !== "cancelled")
    .sort((a, b) => a.start.localeCompare(b.start));
  const dates = tasks.flatMap((task) => [
    task.baselineStart,
    task.baselineEnd,
    task.start,
    task.end,
  ]);
  const rangeStart = dates.sort()[0] ?? today;
  const rangeEnd = [...dates].sort().at(-1) ?? rangeStart;
  const rangeDays = Math.max(1, days(rangeStart, rangeEnd) + 1);
  const position = (date: string) => clamp((days(rangeStart, date) / rangeDays) * 100);
  const width = (start: string, end: string) =>
    Math.max(1.4, ((days(start, end) + 1) / rangeDays) * 100);
  const tickCount = Math.min(6, Math.max(2, rangeDays));
  const ticks = Array.from({ length: tickCount }, (_, index) => {
    const offset = Math.round((index / (tickCount - 1)) * (rangeDays - 1));
    return new Date(dayValue(rangeStart) + offset * 86400000)
      .toISOString()
      .slice(0, 10);
  });
  const todayPosition =
    today >= rangeStart && today <= rangeEnd ? position(today) : null;

  return (
    <div className={s.scheduleWorkspace}>
      <section className={s.milestoneSection} aria-labelledby="milestone-heading">
        <div className={s.timelineHeading}>
          <div>
            <h2 id="milestone-heading">Milestones</h2>
            <p>Client, procurement and handover dates with their owners and linked work.</p>
          </div>
          {state.canManage && (
            <button className={s.button} onClick={() => onMilestone()}>
              Add milestone
            </button>
          )}
        </div>

        {milestones.length ? (
          <ol className={s.milestoneTimeline}>
            {milestones.map((milestone) => {
              const complete = milestone.taskIds.filter(
                (id) => d.tasks.find((task) => task.id === id)?.status === "completed",
              ).length;
              const isReady =
                milestone.taskIds.length > 0 && complete === milestone.taskIds.length;
              const stateName = milestone.acceptedAt
                ? "accepted"
                : milestone.dueDate < today
                  ? "overdue"
                  : isReady
                    ? "ready"
                    : "planned";
              const progress = milestone.taskIds.length
                ? Math.round((complete / milestone.taskIds.length) * 100)
                : 0;
              return (
                <li key={milestone.id} data-state={stateName}>
                  <span className={s.milestoneNode} aria-hidden="true">
                    {stateName === "accepted" ? (
                      <Check size={13} />
                    ) : stateName === "overdue" ? (
                      <TriangleAlert size={13} />
                    ) : (
                      <Flag size={13} />
                    )}
                  </span>
                  <div className={s.milestoneContent}>
                    <div className={s.milestoneTitle}>
                      <div>
                        <time dateTime={milestone.dueDate}>{shortDate(milestone.dueDate)}</time>
                        <strong>{milestone.title}</strong>
                      </div>
                      <div className={s.actions}>
                        <span className={s.status} data-state={stateName === "overdue" ? "returned" : stateName}>
                          {stateName === "accepted" ? "Accepted" : stateName === "overdue" ? "Overdue" : stateName === "ready" ? "Ready to accept" : "On plan"}
                        </span>
                        {!milestone.acceptedAt && state.canManage && (
                          <button className={s.icon} onClick={() => onMilestone(milestone)}>
                            Edit
                          </button>
                        )}
                        {!milestone.acceptedAt && state.canReview && (
                          <button
                            className={s.button}
                            disabled={!isReady}
                            onClick={() => onAccept(milestone)}
                          >
                            Accept
                          </button>
                        )}
                      </div>
                    </div>
                    <div className={s.milestoneMeta}>
                      <span>
                        {state.members.find((person) => person.id === milestone.ownerId)?.name ?? "Unassigned"}
                      </span>
                      <span>{complete}/{milestone.taskIds.length} linked tasks complete</span>
                      {milestone.dueDate !== milestone.baselineDate && (
                        <span>{Math.abs(days(milestone.baselineDate, milestone.dueDate))} day shift from {shortDate(milestone.baselineDate)}</span>
                      )}
                    </div>
                    <span className={s.milestoneProgress} aria-label={`${progress}% complete`}>
                      <span style={{ width: `${progress}%` }} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={s.scheduleEmpty}>
            Add the client, procurement, and handover dates that the team must protect.
          </p>
        )}
      </section>

      {!milestonesOnly && (
        <section className={s.taskTimelineSection} aria-labelledby="task-timeline-heading">
          <div className={s.timelineHeading}>
            <div>
              <h2 id="task-timeline-heading">Task timeline</h2>
              <p>Thin line is the approved baseline. Solid bar is the latest forecast.</p>
            </div>
            {state.canManage && run && (
              <ScheduleReplan state={state} run={run} busy={busy} />
            )}
          </div>

          {tasks.length ? (
            <div
              className={s.taskTimelineScroll}
              role="region"
              aria-label="Project task timeline"
              tabIndex={0}
            >
              <div className={s.taskTimeline}>
                <div className={s.timelineScale}>
                  <span>Task / owner</span>
                  <div>
                    {ticks.map((tick) => (
                      <time
                        dateTime={tick}
                        key={tick}
                        style={{ insetInlineStart: `${position(tick)}%` }}
                      >
                        {shortDate(tick)}
                      </time>
                    ))}
                  </div>
                </div>
                {tasks.map((task) => {
                  const delay = days(task.baselineEnd, task.end);
                  const dependencies = task.predecessors
                    .map((id) => d.tasks.find((candidate) => candidate.id === id)?.title)
                    .filter(Boolean);
                  const progress = Math.round(taskProgress(d, task));
                  const baselineStyle = {
                    "--timeline-start": `${position(task.baselineStart)}%`,
                    "--timeline-size": `${width(task.baselineStart, task.baselineEnd)}%`,
                  } as CSSProperties;
                  const forecastStyle = {
                    "--timeline-start": `${position(task.start)}%`,
                    "--timeline-size": `${width(task.start, task.end)}%`,
                    "--timeline-progress": `${progress}%`,
                  } as CSSProperties;
                  return (
                    <button
                      className={s.timelineTask}
                      data-state={task.status}
                      key={task.id}
                      aria-label={`${task.title} ${task.area || "No area"} · ${label(task.status)} · ${progress}% complete`}
                      onClick={() => onTask(task)}
                    >
                      <span className={s.timelineTaskCopy}>
                        <strong>{task.title}</strong>
                        <small>{task.area || "No area"} · {state.members.find((person) => person.id === task.ownerId)?.name ?? "Unassigned"}</small>
                        <span>
                          {label(task.status)} · {progress}%
                          {delay > 0 ? ` · ${delay}d late` : " · on baseline"}
                        </span>
                        {dependencies.length > 0 && <em>After {dependencies.join(", ")}</em>}
                      </span>
                      <span className={s.timelineCanvas}>
                        {todayPosition !== null && (
                          <i
                            className={s.timelineToday}
                            style={{ insetInlineStart: `${todayPosition}%` }}
                          />
                        )}
                        <i className={s.timelineBaseline} style={baselineStyle} />
                        <i className={s.timelineForecast} style={forecastStyle}>
                          <span />
                        </i>
                        <small
                          className={s.timelineDates}
                          style={{ insetInlineStart: `${position(task.start)}%` }}
                        >
                          {shortDate(task.start)} – {shortDate(task.end)}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className={s.scheduleEmpty}>Add tasks to build the live delivery timeline.</p>
          )}
        </section>
      )}
    </div>
  );
}
