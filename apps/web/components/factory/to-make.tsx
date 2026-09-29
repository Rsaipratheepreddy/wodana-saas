"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, DateField, EmptyState, ErrorState, GroupedTable, InlineNotice, ListTabs, NoResultsState, SearchInput, SelectField, Skeleton, TextAreaField, TextInput,
  type GroupedTableColumn, type GroupedTableSection, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { FactoryState, MakeLine } from "@/lib/factory/types";
import { DueText, ProjectFilterChip, operationsStyles as ops } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import styles from "./factory.module.css";

type View = "left" | "hold" | "all";
const numeric = (value: string) => value.replace(/[^\d.]/g, "");

/**
 * What running projects make in the factory, one project at a time: each line, when the work needs it, how
 * much is on work orders and what's left. A line plans a work order; several selected plan one each.
 */
export function ToMake({ api, state, error, onReload, onPlanned, projectId = null, onProject = () => undefined }: {
  api: FactoryApi; state: FactoryState | null; error: string; onReload: () => void; onPlanned: (orderId: string | null) => void;
  projectId?: string | null; onProject?: (projectId: string | null) => void;
}) {
  const t = useT();
  const [view, setView] = useState<View>("left");
  const [search, setSearch] = useState("");
  const [planning, setPlanning] = useState<MakeLine | null>(null);
  const [bulk, setBulk] = useState<MakeLine[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  if (!state) return <Skeleton lines={6} shape="rows" />;
  const needle = search.trim().toLocaleLowerCase();
  const scoped = state.toMake.filter((line) => (!projectId || line.projectId === projectId)
    && (!needle || `${line.title} ${line.specification} ${line.projectReference} ${line.projectName} ${line.packageName ?? ""}`.toLocaleLowerCase().includes(needle)));
  const held = (line: MakeLine) => line.projectStatus === "on_hold";
  const queues: Record<View, (line: MakeLine) => boolean> = { left: (line) => Number(line.left) !== 0 && !held(line), hold: (line) => Number(line.left) !== 0 && held(line), all: () => true };
  const count = (key: View) => scoped.filter(queues[key]).length;
  const lines = scoped.filter(queues[view]);
  const plannable = (line: MakeLine) => Boolean(state.canManage) && Number(line.left) > 0;
  const columns: GroupedTableColumn<MakeLine>[] = [
    { id: "item", label: t("Item"), render: (line) => <span className={styles.nameCell}><span>{line.title}</span>
      {line.specification || line.packageName ? <small>{[line.packageName, line.specification].filter(Boolean).join(" · ")}</small> : null}</span> },
    { id: "needed", label: t("Needed by"), width: "9rem", mobileHidden: true, render: (line) => <DueText date={line.suggestedEnd} done={Number(line.left) <= 0} /> },
    { id: "quantity", label: t("Quantity"), width: "8rem", align: "end", mobileHidden: true, render: (line) => <span className={styles.number}>{`${quantityText(line.quantity)} ${line.unit}`.trim()}</span> },
    { id: "left", label: t("Left to plan"), width: "11rem", align: "end", render: (line) => Number(line.left) > 0
      ? <span className={styles.nameCell}><strong className={styles.number}>{`${quantityText(line.left)} ${line.unit}`.trim()}</strong>
        {Number(line.planned) ? <small>{t("{quantity} on work orders", { quantity: `${quantityText(line.planned)} ${line.unit}`.trim() })}</small> : null}</span>
      : Number(line.left) < 0 ? <span className={styles.lateText}>{t("{quantity} more on work orders than it needs", { quantity: `${quantityText(line.left.replace("-", ""))} ${line.unit}`.trim() })}</span>
      : <span className={styles.muted}>{t("Planned")}</span> },
    // One clear next action per line.
    ...(state.canManage ? [{ id: "action", label: "", width: "9rem", align: "end" as const, render: (line: MakeLine) => plannable(line)
      ? <Button size="compact" variant="quiet" aria-label={t("Plan work order for {name}", { name: line.title })} onPress={() => setPlanning(line)}>{t("Plan work order")}</Button>
      : Number(line.left) < 0 ? <Button size="compact" variant="quiet" onPress={() => onPlanned(null)}>{t("Open work orders")}</Button> : null }] : []),
  ];
  const sections: GroupedTableSection<MakeLine>[] = [...new Set(lines.map((line) => line.projectId))].map((id) => {
    const rows = lines.filter((line) => line.projectId === id);
    return { id, label: `${rows[0].projectReference} · ${rows[0].projectName}${held(rows[0]) ? ` · ${t("On hold")}` : ""}`, rows, emptyMessage: "" };
  });
  const chosen = state.toMake.filter((line) => selected.has(line.lineId) && plannable(line));
  const project = projectId ? state.toMake.find((line) => line.projectId === projectId) ?? state.orders.find((order) => order.projectId === projectId) : null;
  return <div className={styles.stack} data-tour="factory-to-make">
    <div className={styles.toolbar}>
      <ListTabs label={t("What to make")} value={view} onChange={(next) => { setView(next); setSelected(new Set()); }} items={[
        { id: "left", label: t("Left to plan"), count: count("left") },
        ...(count("hold") ? [{ id: "hold" as const, label: t("On hold"), count: count("hold") }] : []),
        { id: "all", label: t("Everything") },
      ]} />
      <div className={styles.filters}>
        <ProjectFilterChip project={projectId ? { id: projectId, reference: project?.projectReference ?? t("This project"), name: project?.projectName } : null} onClear={() => onProject(null)} />
        <SearchInput label={t("Search what to make")} placeholder={t("Search")} value={search} onChange={setSearch} />
      </div>
    </div>
    {!sections.length ? (needle ? <NoResultsState onClear={() => setSearch("")} />
      : <EmptyState illustration={null} title={view === "left" ? t("Nothing left to plan") : view === "hold" ? t("No project is on hold") : t("Nothing to make yet")}
        description={view === "all" ? t("Scope lines of packages made in our factory appear here once their project starts.") : null} />)
      : <GroupedTable<MakeLine> ariaLabel={t("To make")} columns={columns} sections={sections} getRowId={(line) => line.lineId} getRowLabel={(line) => `${line.projectReference} ${line.title}`}
          selectable={Boolean(state.canManage)} selectedIds={selected}
          onSelectionChange={(ids) => setSelected(new Set([...ids].filter((id) => state.toMake.some((line) => line.lineId === id && plannable(line)))))}
          onRowAction={state.canManage ? (line) => { if (plannable(line)) setPlanning(line); } : undefined} />}
    {chosen.length ? <div className={styles.selectionBar} role="region" aria-label={t("Selected lines")}>
      <span className={styles.muted}>{t("{count} selected", { count: chosen.length })}</span>
      <Button size="compact" variant="quiet" onPress={() => setSelected(new Set())}>{t("Clear")}</Button>
      <span className={styles.selectionActions}>
        <Button size="compact" variant="primary" onPress={() => setBulk(chosen)}>{t("Plan work orders ({count})", { count: chosen.length })}</Button>
      </span>
    </div> : null}
    {planning ? <PlanDialog api={api} line={planning} state={state} onClose={() => setPlanning(null)} onPlanned={(id) => { setPlanning(null); onPlanned(id); }} /> : null}
    {bulk ? <PlanManyDialog api={api} lines={bulk} state={state} onClose={() => setBulk(null)} onPlanned={() => { setBulk(null); setSelected(new Set()); onPlanned(null); }} /> : null}
  </div>;
}

/** A work order for all or part of what's left of a line: where it's made and when (by default when the package's work needs it). */
function PlanDialog({ api, line, state, onClose, onPlanned }: { api: FactoryApi; line: MakeLine; state: FactoryState; onClose: () => void; onPlanned: (id: string) => void }) {
  const t = useT();
  const [id] = useState(() => crypto.randomUUID());
  const [quantity, setQuantity] = useState(quantityText(line.left));
  const [workcenterId, setWorkcenterId] = useState(state.workcenters.length === 1 ? state.workcenters[0].id : "");
  const [start, setStart] = useState(line.suggestedStart);
  const [end, setEnd] = useState(line.suggestedEnd);
  const [notes, setNotes] = useState("");
  const [hours, setHours] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const over = Number(quantity) > Number(line.left);
  const valid = Number(quantity) > 0 && !over && (!start || !end || end >= start);
  return <FormDialog size="md" title={t("Plan work order")} onClose={onClose} error={error || undefined} isSubmitDisabled={!valid} submitLabel={t("Plan work order")} onSubmit={async () => { setError("");
        try { const saved = await api.plan({ id, lineId: line.lineId, quantity, workcenterId: workcenterId || null, plannedStart: start, plannedEnd: end, plannedHours: hours || null, notes: notes.trim() });
          onPlanned(saved.order.id); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
      }}>
      <p className={styles.muted}>{`${line.projectReference} · ${line.title}`}</p>
      {line.projectStatus === "on_hold" ? <InlineNotice tone="info" message={t("{project} is on hold: it can be planned, not released.", { project: line.projectReference })} /> : null}
      <div className={styles.pair}>
        <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={line.unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))}
          isInvalid={over} errorMessage={over ? t("Only {quantity} left.", { quantity: `${quantityText(line.left)} ${line.unit}`.trim() }) : undefined} />
        <SelectField label={t("Workcenter")} placeholder={t("Choose")} selectedKey={workcenterId} onSelectionChange={(key) => setWorkcenterId(key ? String(key) : "")}
          items={state.workcenters.map((center) => ({ id: center.id, label: center.name }))} />
      </div>
      <div className={styles.pair}>
        <DateField label={t("Start")} value={start ? parseDate(start) : null} onChange={(value) => setStart(value ? value.toString() : null)} />
        <DateField label={t("Finish")} value={end ? parseDate(end) : null} onChange={(value) => setEnd(value ? value.toString() : null)}
          isInvalid={Boolean(start && end && end < start)} errorMessage={start && end && end < start ? t("The finish can't be before the start.") : undefined} />
      </div>
      <TextInput label={t("Hours it takes")} inputMode="decimal" suffix={t("h")} value={hours} onChange={(value) => setHours(numeric(value))}
        description={workcenterId ? t("Left empty: the workcenter's hours a day over its working days.") : undefined} />
      <TextAreaField label={t("Notes")} value={notes} onChange={setNotes} />
  </FormDialog>;
}

/**
 * One work order for each selected line, for all that's left, when its work needs it, on one workcenter.
 * Each is its own command (replayed safely by its id); those that can't be planned say why.
 */
function PlanManyDialog({ api, lines, state, onClose, onPlanned }: { api: FactoryApi; lines: MakeLine[]; state: FactoryState; onClose: () => void; onPlanned: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [ids] = useState(() => Object.fromEntries(lines.map((line) => [line.lineId, crypto.randomUUID()])));
  const [workcenterId, setWorkcenterId] = useState(state.workcenters.length === 1 ? state.workcenters[0].id : "");
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return <FormDialog size="md" title={t("Plan work orders ({count})", { count: lines.length })} onClose={onClose} submitLabel={t("Plan work orders ({count})", { count: lines.length })} onSubmit={async () => { setFailed([]);
        const missed: string[] = [];
        for (const line of lines) {
          try { await api.plan({ id: ids[line.lineId], lineId: line.lineId, quantity: line.left, workcenterId: workcenterId || null, plannedStart: line.suggestedStart, plannedEnd: line.suggestedEnd }); }
          catch (cause) { missed.push(`${line.title}: ${cause instanceof Error ? cause.message : t("Could not save.")}`); }
        }
        if (missed.length) setFailed(missed); else onPlanned();
      }}>
      {failed.length ? <InlineNotice tone="error" message={t("Not planned: {lines}", { lines: failed.join("; ") })} /> : null}
      <ul className={ops.list}>{lines.map((line) => <li key={line.lineId}>
        <span className={styles.nameCell}><span>{line.title}</span>
          <small>{[line.projectReference, line.suggestedStart || line.suggestedEnd ? [format.short(line.suggestedStart), format.short(line.suggestedEnd)].filter(Boolean).join(" – ") : ""].filter(Boolean).join(" · ")}</small></span>
        <span className={styles.number}>{`${quantityText(line.left)} ${line.unit}`.trim()}</span>
      </li>)}</ul>
      <SelectField label={t("Workcenter")} placeholder={t("Choose")} selectedKey={workcenterId} onSelectionChange={(key) => setWorkcenterId(key ? String(key) : "")}
        items={state.workcenters.map((center) => ({ id: center.id, label: center.name }))} />
  </FormDialog>;
}
