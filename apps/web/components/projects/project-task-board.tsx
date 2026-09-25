"use client";

import { useState } from "react";
import { CalendarDays, Check, MessageSquare, Pause, Play, RotateCcw, TriangleAlert, UserRound } from "lucide-react";
import { label, taskProgress, type ProjectState, type Task } from "@/lib/projects/execution";
import {StateBadge} from "./project-stage";
import s from "./project-workspace.module.css";

type MoveStatus = "planned" | "in_progress" | "blocked";

const columns: Array<{
  id: string;
  title: string;
  hint: string;
  accepts?: MoveStatus;
  statuses: Task["status"][];
}> = [
  { id: "plan", title: "Planned", hint: "Ready to sequence", accepts: "planned", statuses: ["planned"] },
  { id: "working", title: "In progress", hint: "Work happening now", accepts: "in_progress", statuses: ["in_progress"] },
  { id: "waiting", title: "Waiting", hint: "Blocked or on hold", accepts: "blocked", statuses: ["blocked", "on_hold"] },
  { id: "review", title: "Inspection", hint: "Needs an independent check", statuses: ["awaiting_inspection"] },
  { id: "done", title: "Complete", hint: "Accepted work", statuses: ["completed"] },
];

const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function ProjectTaskBoard({
  state,
  tasks,
  busy,
  onOpen,
  onComments,
  onMove,
  onEdit,
  onReport,
  showEmptyLanes = true,
}: {
  state: ProjectState;
  tasks: Task[];
  busy: boolean;
  onOpen: (task: Task) => void;
  onComments: (task: Task) => void;
  onMove: (task: Task, status: MoveStatus) => void;
  onEdit?: (task: Task) => void;
  onReport?: (task: Task) => void;
  showEmptyLanes?: boolean;
}) {
  const [dragging, setDragging] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const canChangeStatus = state.canManage && state.commercialReady;
  const person = (id: string) =>
    state.members.find((member) => member.id === id)?.name ?? "Unassigned";
  const resource = (id: string) =>
    state.resources.find((item) => item.id === id)?.name ?? "No crew booked";

  const workTasks = tasks.filter(
    (task) =>
      !state.data.tasks.some(
        (child) => child.parentId === task.id && child.status !== "cancelled",
      ),
  );
  const visibleColumns = showEmptyLanes
    ? columns
    : columns.filter((column) =>
        workTasks.some((task) => column.statuses.includes(task.status)),
      );

  if (!workTasks.length && !showEmptyLanes) {
    return (
      <div className={s.boardNoTasks}>
        <strong>No tasks match this view</strong>
        <span>Clear the filter or add the first task to the work plan.</span>
      </div>
    );
  }

  return (
    <div className={s.boardRegion} role="region" aria-label="Project task board" tabIndex={0}>
      <div className={s.taskBoard}>
        {visibleColumns.map((column) => {
          const records = workTasks.filter((task) => column.statuses.includes(task.status));
          return (
            <section
              className={s.boardColumn}
              data-column={column.id}
              data-drop-target={dropTarget===column.id || undefined}
              key={column.id}
              aria-labelledby={`task-column-${column.id}`}
              onDragOver={(event) => {
                const dragged=workTasks.find(task=>task.id===dragging);
                if (!busy && dragged && ((canChangeStatus && column.accepts && !["completed","awaiting_inspection"].includes(dragged.status)) || (column.id==="review" && dragged.status==="in_progress" && state.canReport && onReport) || (column.id==="done" && dragged.status==="awaiting_inspection" && state.canReview))) { event.preventDefault(); setDropTarget(column.id); }
              }}
              onDrop={(event) => {
                if (busy) return;
                event.preventDefault();
                const task = workTasks.find((item) => item.id === event.dataTransfer.getData("text/task-id"));
                setDragging(""); setDropTarget("");
                if (task && column.id==="review" && task.status==="in_progress" && state.canReport && onReport) { onReport(task); return; }
                if (task && column.id==="done" && task.status==="awaiting_inspection" && state.canReview) { onOpen(task); return; }
                if (!canChangeStatus || !column.accepts) return;
                if (task && !["completed", "awaiting_inspection"].includes(task.status) && !busy && !column.statuses.includes(task.status)) onMove(task, column.accepts);
              }}
            >
              <header className={s.boardColumnHeader}>
                <div>
                  <h2 id={`task-column-${column.id}`}>{column.title}</h2>
                  <span data-pending={records.length > 0 && column.id !== "done" || undefined}>{records.length}</span>
                </div>
                <p>{column.hint}</p>
              </header>
              {dropTarget===column.id && <div className={s.boardDropHint}>{column.id==="review"?"Drop to report progress":column.id==="done"?"Drop to review inspection":column.id==="waiting"?"Drop to record blocker":"Drop to move task"}</div>}
              <div className={s.boardCards}>
                {records.map((task) => {
                  const workOrder = state.data.workPackages?.find(work=>work.id===task.packageId);
                  const gaps = [
                    ...(!state.commercialReady ? ["Commercial release"] : []),
                    ...(!task.ownerId ? ["Assign owner"] : []),
                    ...(!task.readiness.scope ? ["Confirm scope"] : []),
                    ...(!task.readiness.access ? ["Confirm access"] : []),
                    ...(!task.readiness.materials ? ["Materials pending"] : []),
                    ...(task.location!=="office" && !state.data.documents.some(doc=>doc.id===task.drawingId && doc.status==="approved") ? ["Approved drawing"] : []),
                    ...(task.predecessors.some(id=>!state.data.tasks.some(previous=>previous.id===id && previous.status==="completed")) ? ["Preceding task"] : []),
                    ...(workOrder && !["ready","in_progress"].includes(workOrder.status) ? ["Work order release"] : []),
                    ...(task.location!=="office" && (!task.resourceId || !state.bookings.some(booking=>booking.taskId===task.id && booking.projectId===state.id && booking.status==="confirmed")) ? ["Confirm crew booking"] : []),
                  ];
                  const progress = Math.round(taskProgress(state.data, task));
                  const comments = state.data.comments.filter((comment) => comment.recordId === task.id).length;
                  const parent = state.data.tasks.find((candidate) => candidate.id === task.parentId);
                  const overdue = !["completed", "cancelled"].includes(task.status) && task.end < (state.today ?? new Date().toISOString().slice(0, 10));
                  return (
                    <article
                      className={s.boardCard}
                      data-dragging={dragging === task.id || undefined}
                      data-priority={task.priority}
                      draggable={!busy && task.status!=="completed" && (task.status==="awaiting_inspection" ? state.canReview : canChangeStatus || (task.status==="in_progress" && state.canReport))}
                      key={task.id}
                      onDragEnd={() => {setDragging("");setDropTarget("");}}
                      onDragStart={(event) => {
                        setDragging(task.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/task-id", task.id);
                      }}
                    >
                      <button className={s.boardCardOpen} onClick={() => onOpen(task)}>
                        <span className={s.boardCardTopline}>
                          <span>{[workOrder?.title || parent?.title, task.area || "General"].filter(Boolean).join(" · ")}</span>
                          {task.priority !== "normal" && <em>{label(task.priority)}</em>}
                        </span>
                        <strong>{task.title}</strong><span><StateBadge state={task.status}/></span>
                        <span className={s.boardMeta}>
                          <UserRound size={12} /> {person(task.ownerId)}
                        </span>
                        <span className={s.boardMeta}>
                          <CalendarDays size={12} /> {shortDate(task.start)} – {shortDate(task.end)}
                          {overdue && <em>Overdue</em>}
                        </span>
                        <span className={s.boardMeta}>
                          {task.status === "blocked" || task.status === "on_hold" ? <TriangleAlert size={12} /> : task.status === "completed" ? <Check size={12} /> : <UserRound size={12} />}
                          {resource(task.resourceId)}
                        </span>
                        {task.blocker && <span className={s.boardBlocker}>{task.blocker}</span>}
                        <span className={s.boardProgress}>
                          <span><i style={{ width: `${progress}%` }} /></span>
                          <b>{progress}%</b>
                        </span>
                        <small>
                          {task.approved} / {task.quantity} {task.unit} approved
                        </small>
                      </button>
                      {task.status === "planned" && gaps.length>0 && <button className={s.boardReadiness} onClick={()=>onOpen(task)}><TriangleAlert size={13}/><span>{gaps.slice(0,2).join(" · ")}{gaps.length>2?` · +${gaps.length-2}`:""}</span></button>}
                      <footer>
                        {state.canManage && onEdit && !["completed","awaiting_inspection"].includes(task.status) && <button disabled={busy} onClick={()=>onEdit(task)}>Edit task</button>}
                        {state.canReport && task.status==="in_progress" && onReport && <button disabled={busy} onClick={()=>onReport(task)}>Update progress</button>}
                        {state.canReview && task.status==="awaiting_inspection" && <button disabled={busy} onClick={()=>onOpen(task)}>Review inspection</button>}
                        <button aria-label={`Comments on ${task.title}`} onClick={() => onComments(task)}>
                          <MessageSquare size={13} /> {comments || "Comments"}
                        </button>
                        {state.canManage && task.status !== "in_progress" && !["awaiting_inspection", "completed"].includes(task.status) && (
                          <button disabled={busy || !state.commercialReady} title={!state.commercialReady ? "Complete the Pre-execution release checklist before starting work." : undefined} onClick={() => gaps.length ? onOpen(task) : onMove(task, "in_progress")}>
                            <Play size={13} /> {gaps.length ? "Review readiness" : "Start task"}
                          </button>
                        )}
                        {state.canManage && ["blocked", "on_hold"].includes(task.status) && (
                          <button disabled={busy || !state.commercialReady} onClick={() => onMove(task, "planned")}>
                            <RotateCcw size={13} /> Replan
                          </button>
                        )}
                        {state.canManage && task.status === "in_progress" && (
                          <button disabled={busy || !state.commercialReady} onClick={() => onMove(task, "blocked")}>
                            <Pause size={13} /> Block
                          </button>
                        )}
                      </footer>
                    </article>
                  );
                })}
                {!records.length && <p className={s.boardEmpty}>No work here</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
