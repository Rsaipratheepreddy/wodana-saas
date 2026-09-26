"use client";

import { useCallback, useEffect, useState } from "react";
import { parseDate } from "@internationalized/date";
import { ArrowRight, Plus, X } from "lucide-react";
import {
  ActivityFeed, Avatar, Button, Checkbox, DateField, ErrorState, IconButton, InlineNotice, InspectorSheet, MenuButton, SegmentedControl, SelectField, Skeleton,
  TextAreaField, TextInput, type ActivityItem,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectApi } from "@/lib/project-core/client";
import type { WorkActivity, WorkBoard, WorkDetail, WorkItem, WorkType } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { ALL_STATUSES, PRIORITIES, StatusIcon, StatusLabel, TypeIcon, isOpen, useWorkLabels } from "./work-labels";
import styles from "./work.module.css";

type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;

/**
 * One piece of work, like an issue in a tracker: its properties saved as they change, then its
 * subtasks, what it waits on, and its comments and history.
 */
export function WorkSheet({ api, projectId, itemId, board, onBoard, onOpenItem, onClose }: {
  api: ProjectApi; projectId: string; itemId: string; board: WorkBoard; onBoard: (board: WorkBoard) => void; onOpenItem: (id: string) => void; onClose: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<WorkDetail | null>(board.item?.id === itemId ? board.item : null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try { setDetail(await api.workItem(projectId, itemId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("This item didn't load.")); }
  }, [api, projectId, itemId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const run: Run = useCallback(async (action, input = {}) => {
    setNotice("");
    try {
      const next = await api.workCommand(projectId, action, { itemId, ...input });
      onBoard(next);
      // A new subtask or blocker comes back as its own item; this one is read again.
      if (next.item?.id === itemId) setDetail(next.item); else await load();
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : t("Could not save."));
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return false;
    }
  }, [api, projectId, itemId, onBoard, load, t]);

  return <InspectorSheet isOpen size="md" title={detail ? `#${detail.number} ${detail.title}` : t("Loading")} hideTitle onOpenChange={(open) => { if (!open) onClose(); }}>
    {error && !detail ? <ErrorState description={error} onRetry={() => void load()} />
      : !detail ? <Skeleton lines={8} />
      : <WorkBody key={`${detail.id}:${detail.version}`} detail={detail} board={board} run={run} notice={notice} onOpenItem={onOpenItem} />}
  </InspectorSheet>;
}

function WorkBody({ detail, board, run, notice, onOpenItem }: { detail: WorkDetail; board: WorkBoard; run: Run; notice: string; onOpenItem: (id: string) => void }) {
  const t = useT();
  const labels = useWorkLabels();
  const format = useProjectFormat();
  const edit = board.canEdit;
  const update = (patch: Record<string, unknown>) => run("update", { version: detail.version, ...patch });
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description);
  const parent = detail.parentId ? board.items.find((item) => item.id === detail.parentId) ?? null : null;
  const person = board.people.find((member) => member.membershipId === detail.assigneeId);
  const packageName = board.packages.find((item) => item.id === detail.packageId)?.name;
  const stageName = board.stages.find((item) => item.id === detail.stageId)?.name;
  const typeOptions: WorkType[] = ["task", "client_request", "snag", "blocker"];
  const due = detail.dueDate && isOpen(detail.status) ? format.until(detail.dueDate) : null;

  return <div className={styles.sheet}>
    <p className={styles.sheetKey}>
      <TypeIcon type={detail.type} /><span>{labels.type[detail.type]} #{detail.number}</span>
      {parent ? <button type="button" className={styles.linkButton} onClick={() => onOpenItem(parent.id)}>{t("Subtask of #{number} {title}", { number: parent.number, title: parent.title })}</button> : null}
    </p>
    {edit ? <div className={styles.titleField}><TextInput label={null} aria-label={t("Title")} value={title} onChange={setTitle}
        onBlur={() => { if (title.trim() && title.trim() !== detail.title) void update({ title }); }} /></div>
      : <h2 className={styles.sheetTitle}>{detail.title}</h2>}
    {notice ? <InlineNotice tone="error" message={notice} /> : null}

    <dl className={styles.facts}>
      <div><dt>{t("Status")}</dt><dd>
        {edit ? <MenuButton size="compact" label={<StatusLabel status={detail.status} />} onAction={(id) => void update({ status: id })}
          items={ALL_STATUSES.filter((status) => status !== detail.status).map((status) => ({ id: status, label: labels.status[status] }))} /> : <StatusLabel status={detail.status} />}
        {detail.blockedBy.length && isOpen(detail.status) ? <span className={styles.blocked}>{t("Blocked")}</span> : null}
      </dd></div>
      <div><dt>{t("Assignee")}</dt><dd>
        {edit ? <MenuButton size="compact" label={detail.assigneeName ? <span className={styles.person}><Avatar name={detail.assigneeName} size="sm" />{detail.assigneeName}</span> : t("No one")}
            onAction={(id) => void update({ assigneeId: id === "none" ? null : id })}
            items={[...(detail.assigneeId ? [{ id: "none", label: t("No one") }] : []), ...board.people.filter((member) => member.membershipId !== detail.assigneeId).map((member) => ({ id: member.membershipId, label: member.name }))]} />
          : detail.assigneeName ?? person?.name ?? t("No one")}
      </dd></div>
      <div><dt>{t("Priority")}</dt><dd>
        {edit ? <MenuButton size="compact" label={labels.priority[detail.priority]} onAction={(id) => void update({ priority: id })}
          items={PRIORITIES.filter((priority) => priority !== detail.priority).map((priority) => ({ id: priority, label: labels.priority[priority] }))} /> : labels.priority[detail.priority]}
      </dd></div>
      {!detail.parentId ? <div><dt>{t("Type")}</dt><dd>
        {edit ? <MenuButton size="compact" label={<span className={styles.person}><TypeIcon type={detail.type} />{labels.type[detail.type]}</span>} onAction={(id) => void update({ type: id })}
          items={typeOptions.filter((type) => type !== detail.type).map((type) => ({ id: type, label: labels.type[type] }))} /> : labels.type[detail.type]}
      </dd></div> : null}
      <div><dt>{t("Dates")}</dt><dd className={styles.dates}>
        {edit ? <>
          <DateField label={null} aria-label={t("Start")} value={detail.startDate ? parseDate(detail.startDate) : null}
            onChange={(value) => { const next = value ? value.toString() : null; if (next !== detail.startDate) void update({ startDate: next }); }} />
          <ArrowRight aria-hidden="true" className={styles.muted} size={14} />
          <DateField label={null} aria-label={t("Due")} value={detail.dueDate ? parseDate(detail.dueDate) : null}
            onChange={(value) => { const next = value ? value.toString() : null; if (next !== detail.dueDate) void update({ dueDate: next }); }} />
        </> : <span>{[format.day(detail.startDate), format.day(detail.dueDate)].filter(Boolean).join(" – ") || "—"}</span>}
        {due ? <span className={styles.muted} data-late={due.late || undefined}>{due.text}</span> : null}
      </dd></div>
      {board.packages.length ? <div><dt>{t("Package")}</dt><dd>
        {edit ? <MenuButton size="compact" label={packageName ?? t("None")} onAction={(id) => void update({ packageId: id === "none" ? null : id })}
          items={[...(detail.packageId ? [{ id: "none", label: t("None") }] : []), ...board.packages.filter((item) => item.id !== detail.packageId).map((item) => ({ id: item.id, label: item.name }))]} /> : packageName ?? "—"}
      </dd></div> : null}
      <div><dt>{t("Stage")}</dt><dd>
        {edit ? <MenuButton size="compact" label={stageName ?? t("None")} onAction={(id) => void update({ stageId: id === "none" ? null : id })}
          items={[...(detail.stageId ? [{ id: "none", label: t("None") }] : []), ...board.stages.filter((item) => item.id !== detail.stageId).map((item) => ({ id: item.id, label: item.name }))]} /> : stageName ?? "—"}
      </dd></div>
      {board.lines.length ? <div><dt>{t("Scope item")}</dt><dd>
        {edit ? <SelectField label={null} aria-label={t("Scope item")} accent="neutral" placeholder={t("None")} selectedKey={detail.boqLineId ?? "none"}
            onSelectionChange={(key) => { const next = key === "none" || key === null ? null : String(key); if (next !== detail.boqLineId) void update({ boqLineId: next }); }}
            items={[{ id: "none", label: t("None") }, ...board.lines.map((line) => ({ id: line.id, label: line.areaName ? `${line.title} · ${line.areaName}` : line.title }))]} />
          : board.lines.find((line) => line.id === detail.boqLineId)?.title ?? "—"}
      </dd></div> : null}
    </dl>

    {edit ? <TextAreaField label={t("Description")} value={description} onChange={setDescription}
        onBlur={() => { if (description.trim() !== detail.description) void update({ description }); }} />
      : detail.description ? <p className={styles.description}>{detail.description}</p> : null}

    {!detail.parentId ? <Subtasks detail={detail} board={board} run={run} onOpenItem={onOpenItem} /> : null}
    <WaitsOn detail={detail} board={board} run={run} onOpenItem={onOpenItem} />
    <Activity detail={detail} board={board} run={run} />
  </div>;
}

function Subtasks({ detail, board, run, onOpenItem }: { detail: WorkDetail; board: WorkBoard; run: Run; onOpenItem: (id: string) => void }) {
  const t = useT();
  const [adding, setAdding] = useState("");
  const children = detail.subtaskIds.map((id) => board.items.find((item) => item.id === id)).filter((item): item is WorkItem => Boolean(item) && item!.status !== "cancelled");
  const add = async () => {
    if (!adding.trim()) return;
    if (await run("create", { id: crypto.randomUUID(), parentId: detail.id, title: adding.trim() })) setAdding("");
  };
  if (!children.length && !board.canEdit) return null;
  return <section className={styles.part} aria-label={t("Subtasks")}>
    <h3>{t("Subtasks")}{children.length ? <span className={styles.muted}>{t("{done} of {count}", { done: children.filter((item) => item.status === "done").length, count: children.length })}</span> : null}</h3>
    {children.length ? <ul className={styles.refList}>{children.map((child) => <li key={child.id}>
      <Checkbox aria-label={t("Done: {title}", { title: child.title })} isSelected={child.status === "done"} isDisabled={!board.canEdit}
        onChange={(done) => void run("update", { itemId: child.id, version: child.version, status: done ? "done" : "todo" })} />
      <button type="button" className={styles.refButton} data-done={child.status === "done" || undefined} onClick={() => onOpenItem(child.id)}>
        <span className={styles.number}>#{child.number}</span>{child.title}
      </button>
      {child.assigneeName ? <Avatar name={child.assigneeName} size="sm" /> : null}
    </li>)}</ul> : null}
    {board.canEdit ? <form className={styles.addRow} onSubmit={(event) => { event.preventDefault(); void add(); }}>
      <TextInput label={null} aria-label={t("New subtask")} placeholder={t("Add a subtask")} value={adding} onChange={setAdding} />
      <Button size="compact" type="submit" isDisabled={!adding.trim()}><Plus aria-hidden="true" size={14} />{t("Add")}</Button>
    </form> : null}
  </section>;
}

function WaitsOn({ detail, board, run, onOpenItem }: { detail: WorkDetail; board: WorkBoard; run: Run; onOpenItem: (id: string) => void }) {
  const t = useT();
  const [mode, setMode] = useState<"link" | "blocker" | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [kind, setKind] = useState("fs");
  const [lag, setLag] = useState("0");
  const [blocker, setBlocker] = useState("");
  const linked = new Set([detail.id, ...detail.before.map((item) => item.id), ...detail.after.map((item) => item.id)]);
  const candidates = board.items.filter((item) => !linked.has(item.id) && item.status !== "cancelled");
  const link = async () => {
    if (pick && await run("link", { predecessorId: pick, kind, lagDays: Number(lag) || 0 })) { setMode(null); setPick(null); setLag("0"); }
  };
  const report = async () => {
    if (blocker.trim() && await run("create", { id: crypto.randomUUID(), type: "blocker", blocks: detail.id, title: blocker.trim() })) { setMode(null); setBlocker(""); }
  };
  if (!detail.before.length && !detail.after.length && !board.canEdit) return null;
  const ref = (item: WorkDetail["before"][number], remove: boolean) => <li key={item.id}>
    <StatusIcon status={item.status} />
    <button type="button" className={styles.refButton} data-done={!isOpen(item.status) || undefined} onClick={() => onOpenItem(item.id)}>
      <TypeIcon type={item.type} /><span className={styles.number}>#{item.number}</span>{item.title}
    </button>
    <span className={styles.muted}>{item.kind === "ss" ? t("starts first") : t("finishes first")}{item.lagDays ? ` · ${t("{count} days after", { count: item.lagDays })}` : ""}</span>
    {remove && board.canEdit ? <IconButton aria-label={t("Stop waiting on #{number}", { number: item.number })} size="compact" variant="quiet" onPress={() => void run("unlink", { predecessorId: item.id })}><X size={14} /></IconButton> : null}
  </li>;

  return <section className={styles.part} aria-label={t("Waiting on")}>
    <h3>{t("Waiting on")}</h3>
    {detail.before.length ? <ul className={styles.refList}>{detail.before.map((item) => ref(item, true))}</ul> : null}
    {detail.after.length ? <p className={styles.muted}>{t("Holding up {items}", { items: detail.after.map((item) => `#${item.number}`).join(", ") })}</p> : null}
    {board.canEdit && !mode ? <div className={styles.addRow}>
      <Button size="compact" onPress={() => setMode("link")} isDisabled={!candidates.length}>{t("Wait on another item")}</Button>
      <Button size="compact" onPress={() => setMode("blocker")}>{t("Report a blocker")}</Button>
    </div> : null}
    {mode === "link" ? <div className={styles.inlineForm}>
      <SelectField label={t("Item")} placeholder={t("Choose an item")} selectedKey={pick} onSelectionChange={(key) => setPick(key === null ? null : String(key))}
        items={candidates.map((item) => ({ id: item.id, label: `#${item.number} ${item.title}` }))} />
      <div className={styles.pair}>
        <SegmentedControl label={t("When")} value={kind} onChange={setKind} options={[{ id: "fs", label: t("After it finishes") }, { id: "ss", label: t("After it starts") }]} />
        <TextInput label={t("Days in between")} inputMode="numeric" value={lag} onChange={(value) => setLag(value.replace(/[^\d-]/g, ""))} />
      </div>
      <div className="wd-dialog-actions"><Button onPress={() => setMode(null)}>{t("Cancel")}</Button><Button variant="primary" isDisabled={!pick} onPress={() => void link()}>{t("Save")}</Button></div>
    </div> : null}
    {mode === "blocker" ? <form className={styles.inlineForm} onSubmit={(event) => { event.preventDefault(); void report(); }}>
      <TextInput label={t("What's in the way")} autoFocus value={blocker} onChange={setBlocker} />
      <div className="wd-dialog-actions"><Button onPress={() => setMode(null)}>{t("Cancel")}</Button><Button variant="primary" type="submit" isDisabled={!blocker.trim()}>{t("Save")}</Button></div>
    </form> : null}
  </section>;
}

function Activity({ detail, board, run }: { detail: WorkDetail; board: WorkBoard; run: Run }) {
  const t = useT();
  const format = useProjectFormat();
  const describe = useActivityText();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const items: ActivityItem[] = [...detail.activity].reverse().map((entry) => ({
    id: entry.id, actor: entry.by, occurredAt: format.when(entry.at),
    ...(entry.kind === "comment" ? { kind: "comment" as const, action: t("commented"), detail: (entry as { body: string }).body } : { kind: "change" as const, action: describe(entry) }),
  }));
  return <section className={styles.part} aria-label={t("Activity")}>
    <h3>{t("Activity")}</h3>
    {board.canEdit ? <form className={styles.commentBox} onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      if (await run("comment", { id: crypto.randomUUID(), body: comment })) setComment("");
      setBusy(false);
    }}>
      <TextAreaField label={null} aria-label={t("Comment")} placeholder={t("Write a comment")} value={comment} onChange={setComment} />
      <Button size="compact" type="submit" isLoading={busy} isDisabled={!comment.trim()}>{t("Comment")}</Button>
    </form> : null}
    <ActivityFeed items={items} />
  </section>;
}

/** One line for each change in an item's history. */
function useActivityText() {
  const t = useT();
  const labels = useWorkLabels();
  const format = useProjectFormat();
  return (entry: WorkActivity) => {
    const detail = (entry as { detail: Record<string, unknown> }).detail ?? {};
    const text = (key: string) => (typeof detail[key] === "string" ? detail[key] as string : "");
    switch (entry.kind) {
      case "created": return detail.parent ? t("added it as a subtask of #{number}", { number: String(detail.parent) }) : t("created it");
      case "status": return t("moved it to {status}", { status: labels.status[text("to") as keyof typeof labels.status] ?? text("to") });
      case "assignee": return text("name") ? t("gave it to {name}", { name: text("name") }) : t("took it off its assignee");
      case "priority": return t("set the priority to {priority}", { priority: labels.priority[text("to") as keyof typeof labels.priority] ?? text("to") });
      case "type": return t("made it a {type}", { type: (labels.type[text("to") as WorkType] ?? text("to")).toLocaleLowerCase() });
      case "title": return t("renamed it from {from}", { from: text("from") });
      case "dates": return text("dueDate") ? t("set it due {date}", { date: format.day(text("dueDate")) }) : t("changed its dates");
      case "package": return text("name") ? t("moved it to {name}", { name: text("name") }) : t("took it out of its package");
      case "stage": return text("name") ? t("put it in {name}", { name: text("name") }) : t("took it out of its stage");
      case "line": return text("title") ? t("tied it to {title}", { title: text("title") }) : t("untied it from the scope");
      case "linked": return t("made it wait on #{number} {title}", { number: String(detail.number), title: text("title") });
      case "unlinked": return t("stopped it waiting on #{number}", { number: String(detail.number) });
      case "blocked": return t("reported a blocker: #{number} {title}", { number: String(detail.number), title: text("title") });
      default: return t("changed it");
    }
  };
}
