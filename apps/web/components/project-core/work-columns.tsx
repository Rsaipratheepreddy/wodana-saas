"use client";

import { Avatar, type GroupedTableColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkBoard, WorkItem } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import { AwayChip, StatusLabel, TypeIcon, isOpen, useWorkLabels } from "./work-labels";
import styles from "./work.module.css";

/** A work item as a table row; subtasks listed under their task are one level in. */
export type WorkRow = WorkItem & { depth: 0 | 1 };

/** The columns every list of work uses: title (with what holds it up), assignee, due and status. */
export function useWorkColumns<T extends WorkRow>(board: WorkBoard): GroupedTableColumn<T>[] {
  const t = useT();
  const format = useProjectFormat();
  const labels = useWorkLabels();
  return [
    { id: "title", label: t("Title"), width: "52%", render: (row) => <span className={styles.titleCell} data-depth={row.depth || undefined}>
      <span><TypeIcon type={row.type} label={labels.type[row.type]} /><span className={styles.number}>#{row.number}</span><span data-done={row.status === "done" || undefined}>{row.title}</span></span>
      <Meta row={row} waiting={board.materials[row.id]?.length ?? 0} parent={row.depth === 0 && row.parentId ? board.items.find((item) => item.id === row.parentId) : undefined} />
    </span> },
    { id: "assignee", label: t("Assignee"), width: "20%", mobileHidden: true, render: (row) => row.assigneeName
      ? <span className={styles.person}><Avatar name={row.assigneeName} size="sm" />{row.assigneeName}<AwayChip item={row} /></span> : <span className={styles.muted}>—</span> },
    { id: "due", label: t("Due"), width: "12%", mobileHidden: true, render: (row) => {
      if (!row.dueDate) return <span className={styles.muted}>—</span>;
      const due = isOpen(row.status) ? format.until(row.dueDate) : null;
      return <span className={styles.muted} data-late={due?.late || undefined}>{format.short(row.dueDate)}</span>;
    } },
    { id: "status", label: t("Status"), width: "16%", render: (row) => <StatusLabel status={row.status} /> },
  ];
}

/** Under a row's title: what holds it up, its subtasks and a high priority. */
function Meta({ row, parent, waiting }: { row: WorkRow; parent?: WorkItem; waiting: number }) {
  const t = useT();
  const labels = useWorkLabels();
  const parts = [
    parent ? t("Subtask of #{number}", { number: parent.number }) : "",
    row.subtasks ? t("{done} of {count} subtasks", { done: row.subtasksDone, count: row.subtasks }) : "",
    row.priority === "urgent" || row.priority === "high" ? labels.priority[row.priority] : "",
    row.type === "snag" && row.severity && row.severity !== "minor" ? labels.severity[row.severity] : "",
  ].filter(Boolean);
  const blocked = row.blockedBy.length > 0 && isOpen(row.status);
  if (!parts.length && !blocked && !waiting) return null;
  return <small>{blocked ? <span className={styles.blocked}>{t("Blocked by {items}", { items: row.blockedBy.map((item) => `#${item.number}`).join(", ") })}</span> : null}
    {waiting ? <span className={styles.blocked}>{waiting === 1 ? t("1 material not in") : t("{count} materials not in", { count: waiting })}</span> : null}{parts.join(" · ")}</small>;
}
