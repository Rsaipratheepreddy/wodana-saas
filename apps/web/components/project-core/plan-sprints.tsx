"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus } from "lucide-react";
import {
  BurndownChart, Button, ControlledModalDialog, DateField, GroupedTable, InspectorSheet, MenuButton, SelectField, Skeleton, TextAreaField, TextInput,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { ProjectApi } from "@/lib/project-core/client";
import type { MissReason, Sprint, SprintDetail, WorkBoard, WorkItem } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { isOpen } from "./work-labels";
import { useWorkColumns, type WorkRow } from "./work-columns";
import styles from "./work.module.css";

type Run = (action: string, input?: Record<string, unknown>) => Promise<boolean>;
const REASONS: MissReason[] = ["blocked", "waiting_on_client", "materials_late", "underestimated", "people_unavailable", "reprioritised", "other"];

export function useMissReasons() {
  const t = useT();
  return useMemo<Record<MissReason, string>>(() => ({
    blocked: t("Blocked"), waiting_on_client: t("Waiting on the client"), materials_late: t("Materials late"), underestimated: t("Took longer than planned"),
    people_unavailable: t("People not available"), reprioritised: t("Other work came first"), other: t("Other"),
  }), [t]);
}

/**
 * Sprints, like a tracker's backlog: the running sprint with its burndown, the sprints planned next,
 * then the backlog. Work moves between them by selecting rows; closed sprints keep their report.
 */
export function PlanSprints({ board, api, projectId, run, onOpen }: { board: WorkBoard; api: ProjectApi; projectId: string; run: Run; onOpen: (id: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const columns = useWorkColumns<WorkRow>(board);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Sprint | "new" | null>(null);
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState<Sprint | null>(null);
  const [detail, setDetail] = useState<SprintDetail | null>(null);
  const active = board.sprints.find((sprint) => sprint.status === "active") ?? null;
  const planned = board.sprints.filter((sprint) => sprint.status === "planned");
  const closed = board.sprints.filter((sprint) => sprint.status === "closed").reverse();
  const loadDetail = useCallback(async () => { if (active) setDetail(await api.sprint(projectId, active.id).catch(() => null)); }, [api, projectId, active]);
  useEffect(() => { queueMicrotask(() => void loadDetail()); }, [loadDetail]);

  const rows = (sprintId: string | null): WorkRow[] => board.items
    .filter((item) => !item.parentId && item.status !== "cancelled" && item.sprintId === sprintId && (sprintId || isOpen(item.status)))
    .map((item) => ({ ...item, depth: 0 as const }));
  const move = async (target: string) => {
    if (await run("set_sprint", { itemIds: [...selected], sprintId: target === "backlog" ? null : target })) setSelected(new Set());
  };
  const dates = (sprint: Sprint) => `${format.short(sprint.startDate)} – ${format.short(sprint.endDate)}`;
  const table = (id: string, list: WorkRow[], empty: string) => <GroupedTable<WorkRow> ariaLabel={id} columns={columns} getRowId={(row) => row.id} getRowLabel={(row) => `#${row.number} ${row.title}`}
    selectable={board.canEdit} selectedIds={selected} onSelectionChange={(ids) => setSelected(new Set([...[...selected].filter((key) => !list.some((row) => row.id === key)), ...ids]))}
    onRowAction={(row: WorkItem) => onOpen(row.id)}
    sections={[{ id, label: list.length === 1 ? t("1 item") : t("{count} items", { count: list.length }), rows: list, emptyMessage: empty }]} />;
  const moveTargets = [...(active ? [active] : []), ...planned].map((sprint) => ({ id: sprint.id, label: sprint.name }));

  return <div className={styles.sprints}>
    {selected.size ? <div className={styles.toolbarGroup}>
      <span className={styles.muted}>{t("{count} selected", { count: selected.size })}</span>
      <MenuButton size="compact" label={t("Move to")} onAction={(id) => void move(id)} items={[...moveTargets, { id: "backlog", label: t("Backlog") }]} />
      <Button size="compact" variant="quiet" onPress={() => setSelected(new Set())}>{t("Clear")}</Button>
    </div> : null}

    {active ? <section className={styles.sprint} aria-label={active.name}>
      <header className={styles.sprintHead}>
        <div><h3>{active.name} <span className={styles.running}>{t("Running")}</span></h3><small>{[dates(active), active.goal].filter(Boolean).join(" · ")}</small></div>
        <div className={styles.toolbarGroup}>
          {board.canManage ? <Button size="compact" onPress={() => setEditing(active)}>{t("Edit")}</Button> : null}
          {board.canManage ? <Button size="compact" variant="primary" isDisabled={!detail} onPress={() => setClosing(true)}>{t("Close sprint")}</Button> : null}
        </div>
      </header>
      {detail?.days.length ? <BurndownChart ariaLabel={t("Burndown")} points={detail.days.map((day) => ({ label: format.short(day.date), remaining: day.remaining, ideal: day.ideal }))}
        summary={t("{done} of {count} committed done", { done: active.committedDone, count: active.committed })} /> : null}
      {table(active.id, rows(active.id), t("Nothing in this sprint"))}
    </section> : null}

    {planned.map((sprint) => <section className={styles.sprint} aria-label={sprint.name} key={sprint.id}>
      <header className={styles.sprintHead}>
        <div><h3>{sprint.name}</h3><small>{[dates(sprint), sprint.goal].filter(Boolean).join(" · ")}</small></div>
        {board.canManage ? <div className={styles.toolbarGroup}>
          <Button size="compact" onPress={() => setEditing(sprint)}>{t("Edit")}</Button>
          <Button size="compact" variant={active ? "secondary" : "primary"} isDisabled={Boolean(active) || !sprint.items} onPress={() => void run("start_sprint", { sprintId: sprint.id, version: sprint.version })}>{t("Start sprint")}</Button>
        </div> : null}
      </header>
      {table(sprint.id, rows(sprint.id), t("Move work here from the backlog"))}
    </section>)}

    <section className={styles.sprint} aria-label={t("Backlog")}>
      <header className={styles.sprintHead}><div><h3>{t("Backlog")}</h3></div>
        {board.canManage ? <Button size="compact" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("New sprint")}</Button> : null}
      </header>
      {table("backlog", rows(null), t("All open work is in a sprint"))}
    </section>

    {closed.length ? <section className={styles.sprint} aria-label={t("Closed sprints")}>
      <header className={styles.sprintHead}><div><h3>{t("Closed sprints")}</h3></div></header>
      <ul className={styles.closedList}>{closed.map((sprint) => <li key={sprint.id}><button type="button" onClick={() => setReport(sprint)}>
        <span>{sprint.name}</span><span className={styles.muted}>{dates(sprint)}</span>
        <span>{t("{done} of {count} committed done", { done: sprint.committedDone, count: sprint.committed })}</span>
      </button></li>)}</ul>
    </section> : null}

    {editing ? <SprintDialog sprint={editing === "new" ? null : editing} last={board.sprints.at(-1) ?? null} run={run} onClose={() => setEditing(null)} /> : null}
    {closing && active && detail ? <CloseSprintDialog sprint={active} detail={detail} planned={planned} run={run} onClose={() => setClosing(false)} /> : null}
    {report ? <SprintReport api={api} projectId={projectId} sprint={report} onClose={() => setReport(null)} /> : null}
  </div>;
}

/** A sprint's name, dates and goal. A new one follows the last, two weeks long. */
function SprintDialog({ sprint, last, run, onClose }: { sprint: Sprint | null; last: Sprint | null; run: Run; onClose: () => void }) {
  const t = useT();
  const suggested = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const after = last ? new Date(Date.parse(`${last.endDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : today;
    const start = after > today ? after : today;
    return { start, end: new Date(Date.parse(`${start}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10) };
  }, [last]);
  const [id] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [start, setStart] = useState(sprint?.startDate ?? suggested.start);
  const [end, setEnd] = useState(sprint?.endDate ?? suggested.end);
  const [busy, setBusy] = useState(false);
  const valid = start && end && end >= start && (!sprint || name.trim());
  const save = async () => {
    setBusy(true);
    const done = sprint ? await run("update_sprint", { sprintId: sprint.id, version: sprint.version, name: name.trim(), goal: goal.trim(), startDate: start, endDate: end })
      : await run("create_sprint", { id, name: name.trim(), goal: goal.trim(), startDate: start, endDate: end });
    setBusy(false);
    if (done) onClose();
  };
  return <ControlledModalDialog isOpen size="md" title={sprint ? sprint.name : t("New sprint")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions">
      {sprint?.status === "planned" ? <Button variant="quiet" onPress={async () => { if (await run("delete_sprint", { sprintId: sprint.id, version: sprint.version })) onClose(); }}>{t("Delete")}</Button> : null}
      <span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={() => void save()}>{t("Save")}</Button>
    </div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Name")} placeholder={sprint ? undefined : t("Next sprint number")} value={name} onChange={setName} />
      <div className={styles.pair}>
        <DateField label={t("Start")} isDisabled={sprint?.status === "active"} value={start ? parseDate(start) : null} onChange={(value) => setStart(value ? value.toString() : "")} />
        <DateField label={t("End")} value={end ? parseDate(end) : null} onChange={(value) => setEnd(value ? value.toString() : "")}
          isInvalid={Boolean(start && end && end < start)} errorMessage={t("The sprint can't end before it starts.")} />
      </div>
      <TextAreaField label={t("Goal")} value={goal} onChange={setGoal} />
    </div>
  </ControlledModalDialog>;
}

/** Closing asks why each unfinished commitment wasn't done, and where the unfinished work goes. */
function CloseSprintDialog({ sprint, detail, planned, run, onClose }: { sprint: Sprint; detail: SprintDetail; planned: Sprint[]; run: Run; onClose: () => void }) {
  const t = useT();
  const reasons = useMissReasons();
  const [given, setGiven] = useState<Record<string, { reason: MissReason | null; note: string }>>(
    () => Object.fromEntries(detail.unfinished.map((item) => [item.itemId, { reason: null, note: "" }])));
  const [moveTo, setMoveTo] = useState<string>(planned[0]?.id ?? "backlog");
  const [busy, setBusy] = useState(false);
  const valid = Object.values(given).every((entry) => entry.reason);
  return <ControlledModalDialog isOpen size="lg" title={t("Close {name}", { name: sprint.name })} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true);
        if (await run("close_sprint", { sprintId: sprint.id, version: sprint.version, moveTo: moveTo === "backlog" ? null : moveTo, reasons: given })) onClose();
        setBusy(false);
      }}>{t("Close sprint")}</Button></div>}>
    <div className={styles.dialogBody}>
      <p className={styles.dialogText}>{t("{done} of {count} committed done", { done: sprint.committedDone, count: sprint.committed })}</p>
      {detail.unfinished.length ? <ul className={styles.missList} aria-label={t("Not finished")}>
        {detail.unfinished.map((item) => <li key={item.itemId}>
          <span><span className={styles.number}>#{item.number}</span> {item.title}</span>
          <SelectField aria-label={t("Why #{number} wasn't finished", { number: item.number })} label={null} placeholder={t("Why")} selectedKey={given[item.itemId]?.reason ?? null}
            onSelectionChange={(key) => setGiven({ ...given, [item.itemId]: { ...given[item.itemId], reason: key as MissReason } })}
            items={REASONS.map((reason) => ({ id: reason, label: reasons[reason] }))} />
          <TextInput aria-label={t("Note for #{number}", { number: item.number })} label={null} placeholder={t("Note")} value={given[item.itemId]?.note ?? ""}
            onChange={(note) => setGiven({ ...given, [item.itemId]: { ...given[item.itemId], note } })} />
        </li>)}
      </ul> : null}
      <SelectField label={t("Move unfinished work to")} selectedKey={moveTo} onSelectionChange={(key) => setMoveTo(String(key))}
        items={[...planned.map((item) => ({ id: item.id, label: item.name })), { id: "backlog", label: t("Backlog") }]} />
    </div>
  </ControlledModalDialog>;
}

/** A closed sprint: how the commitment burned down and what was missed and why. */
function SprintReport({ api, projectId, sprint, onClose }: { api: ProjectApi; projectId: string; sprint: Sprint; onClose: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const reasons = useMissReasons();
  const [detail, setDetail] = useState<SprintDetail | null>(null);
  useEffect(() => { api.sprint(projectId, sprint.id).then(setDetail).catch(() => setDetail(null)); }, [api, projectId, sprint.id]);
  return <InspectorSheet isOpen size="md" title={sprint.name} onOpenChange={(open) => { if (!open) onClose(); }}>
    {!detail ? <Skeleton lines={6} shape="facts" /> : <div className={styles.sheet}>
      <p className={styles.dialogText}>{[`${format.short(sprint.startDate)} – ${format.short(sprint.endDate)}`, sprint.goal].filter(Boolean).join(" · ")}</p>
      <BurndownChart ariaLabel={t("Burndown")} points={detail.days.map((day) => ({ label: format.short(day.date), remaining: day.remaining, ideal: day.ideal }))}
        summary={t("{done} of {count} committed done", { done: sprint.committedDone, count: sprint.committed })} />
      <dl className={styles.facts}>
        <div><dt>{t("Added during the sprint")}</dt><dd>{detail.added}</dd></div>
        <div><dt>{t("Taken out")}</dt><dd>{detail.removed}</dd></div>
      </dl>
      {detail.missed.length ? <section className={styles.part} aria-label={t("Not finished")}>
        <h3>{t("Not finished")}</h3>
        <ul className={styles.refList}>{detail.missed.map((item) => <li key={item.itemId}>
          <span className={styles.refButton}><span className={styles.number}>#{item.number}</span>{item.title}</span>
          <span className={styles.muted}>{[reasons[item.reason], item.note].filter(Boolean).join(" · ")}</span>
        </li>)}</ul>
      </section> : null}
    </div>}
  </InspectorSheet>;
}
