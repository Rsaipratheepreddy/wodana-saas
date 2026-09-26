"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Bot, Check, ChevronRight, Circle, GripVertical, LockKeyhole, Play, Plus } from "lucide-react";
import { Button } from "../components/actions";
import { Avatar } from "../components/avatar";
import { Checkbox, SelectField, TextInput } from "../components/forms";
import { Badge, Progress } from "../components/status";

export type WorkflowStage = { id: string; label: string; state: "complete" | "current" | "upcoming" | "blocked" };
export function StageTracker({ ariaLabel = "Workflow stages", stages }: { ariaLabel?: string; stages: WorkflowStage[] }) { return <ol aria-label={ariaLabel} className="wd-stage-tracker" tabIndex={0}>{stages.map((stage, index) => <li aria-current={stage.state === "current" ? "step" : undefined} data-state={stage.state} key={stage.id}><span>{stage.state === "complete" ? <Check aria-hidden="true" size={14} /> : stage.state === "blocked" ? <LockKeyhole aria-hidden="true" size={13} /> : index + 1}</span><strong>{stage.label}</strong>{index < stages.length - 1 ? <i aria-hidden="true" /> : null}</li>)}</ol>; }

export type TaskItem = { id: string; title: string; complete: boolean; assignee?: string; due?: string };
export function TaskChecklist({ items, onChange }: { items: TaskItem[]; onChange?: (items: TaskItem[]) => void }) { const complete = items.filter((item) => item.complete).length; return <div className="wd-task-checklist"><header><strong>Checklist</strong><span>{complete}/{items.length}</span></header><Progress label="Checklist progress" max={items.length || 1} value={complete} />{items.map((item) => <div key={item.id}><Checkbox isSelected={item.complete} onChange={(selected) => onChange?.(items.map((entry) => entry.id === item.id ? { ...entry, complete: selected } : entry))}>{item.title}</Checkbox><span>{item.assignee ? <Avatar name={item.assignee} size="sm" /> : null}{item.due ? <small>{item.due}</small> : null}</span></div>)}</div>; }

export function ApprovalRow({ approver, description, label, onApprove, onReject, state = "pending" }: { approver?: string; description?: string; label: string; onApprove?: () => void; onReject?: () => void; state?: "pending" | "approved" | "rejected" }) { return <div className="wd-approval-row"><span data-state={state}>{state === "approved" ? <Check size={14} /> : state === "rejected" ? <AlertTriangle size={14} /> : <Circle size={14} />}</span><div><strong>{label}</strong>{description ? <small>{description}</small> : null}</div>{approver ? <Avatar name={approver} size="sm" /> : null}<Badge tone={state === "approved" ? "success" : state === "rejected" ? "danger" : "warning"}>{state}</Badge>{state === "pending" ? <div><Button onPress={onReject} size="compact">Reject</Button><Button onPress={onApprove} size="compact" variant="primary">Approve</Button></div> : null}</div>; }

export type KanbanColumn<T> = { id: string; label: string; items: T[]; limit?: number };
/**
 * Columns of cards. Cards open with click, Enter or Space when `onItemAction` is set; with `onMove`
 * they can be dragged to another column (the record's own panel is the keyboard way to move them).
 */
export function Kanban<T>({ columns, getId, getLabel, onItemAction, onMove, renderItem }: {
  columns: KanbanColumn<T>[]; getId: (item: T) => string; getLabel?: (item: T) => string; onItemAction?: (item: T) => void;
  onMove?: (itemId: string, columnId: string) => void; renderItem: (item: T) => ReactNode;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const draggable = Boolean(onMove) || !onItemAction;
  return <div className="wd-kanban">{columns.map((column) => <section aria-label={column.label} data-drop-target={target === column.id || undefined} key={column.id}
    onDragLeave={onMove ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null); } : undefined}
    onDragOver={onMove ? (event) => { if (event.dataTransfer.types.includes(CARD)) { event.preventDefault(); setTarget(column.id); } } : undefined}
    onDrop={onMove ? (event) => { const id = event.dataTransfer.getData(CARD); setTarget(null); if (id) { event.preventDefault(); onMove(id, column.id); } } : undefined}>
    <header><strong>{column.label}</strong><Badge>{column.items.length}{column.limit ? ` / ${column.limit}` : ""}</Badge></header>
    <div>{column.items.map((item) => { const id = getId(item); return <article aria-label={onItemAction ? getLabel?.(item) : undefined} data-actionable={onItemAction ? true : undefined} draggable={draggable} key={id}
      onClick={onItemAction ? () => onItemAction(item) : undefined}
      onDragStart={onMove ? (event) => { event.dataTransfer.setData(CARD, id); event.dataTransfer.effectAllowed = "move"; } : undefined}
      onKeyDown={onItemAction ? (event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onItemAction(item); } } : undefined}
      role={onItemAction ? "button" : undefined} tabIndex={onItemAction ? 0 : undefined}>
      {draggable && !onItemAction ? <GripVertical aria-hidden="true" size={14} /> : null}{renderItem(item)}</article>; })}</div>
  </section>)}</div>;
}
const CARD = "text/x-wd-card";

export type AutomationStep = { id: string; kind: "trigger" | "condition" | "action"; label: string; description?: string };
export function AutomationBuilder({ onChange, steps }: { onChange?: (steps: AutomationStep[]) => void; steps: AutomationStep[] }) { const [adding, setAdding] = useState(false); return <div className="wd-automation"><header><span><Bot size={16} /><strong>Automation</strong></span><Button onPress={() => setAdding(true)} size="compact"><Play size={13} />Test run</Button></header><ol>{steps.map((step, index) => <li key={step.id}><span data-kind={step.kind}>{index + 1}</span><div><strong>{step.label}</strong><small>{step.description ?? step.kind}</small></div>{index < steps.length - 1 ? <i /> : null}</li>)}</ol>{adding ? <div className="wd-automation-add"><SelectField aria-label="Step type" items={[{ id: "condition", label: "Condition" }, { id: "action", label: "Action" }]} label="Step type" /><TextInput label="Name" /><Button onPress={() => { onChange?.([...steps, { id: crypto.randomUUID(), kind: "action", label: "New action" }]); setAdding(false); }} variant="primary">Add step</Button></div> : <Button onPress={() => setAdding(true)}><Plus size={14} />Add step</Button>}</div>; }

export type ExceptionItem = { id: string; title: string; description: string; severity: "warning" | "danger"; actionLabel: string };
export function ExceptionQueue({ items, onAction }: { items: ExceptionItem[]; onAction?: (item: ExceptionItem) => void }) { return <div className="wd-exception-queue"><header><strong>Exceptions</strong><Badge tone={items.length ? "warning" : "success"}>{items.length} open</Badge></header>{items.map((item) => <button key={item.id} onClick={() => onAction?.(item)} type="button"><AlertTriangle size={15} /><span><strong>{item.title}</strong><small>{item.description}</small></span><Badge tone={item.severity}>{item.severity}</Badge><span>{item.actionLabel}<ChevronRight data-directional="true" size={14} /></span></button>)}</div>; }

export function CapacityBar({ allocated, label, total }: { allocated: number; label: string; total: number }) { return <div className="wd-capacity"><div><strong>{label}</strong><span>{allocated}h / {total}h</span></div><Progress label={`${label} capacity`} max={total} value={allocated} /></div>; }
