"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, EmptyState, ErrorState, GroupedTable, InlineNotice, SearchInput, SegmentedControl, SelectField, Skeleton, TextAreaField, TextInput,
  type GroupedTableColumn, type GroupedTableSection } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { FactoryState, MakeLine } from "@/lib/factory/types";
import { quantityText } from "../purchasing/order-labels";
import styles from "./factory.module.css";

type Show = "left" | "all";
const numeric = (value: string) => value.replace(/[^\d.]/g, "");

/** What running projects make in the factory, one project at a time: each line, how much is on work orders and what's left. A line opens to plan a work order. */
export function ToMake({ api, state, error, onReload, onPlanned }: { api: FactoryApi; state: FactoryState | null; error: string; onReload: () => void; onPlanned: (orderId: string) => void }) {
  const t = useT();
  const [show, setShow] = useState<Show>("left");
  const [search, setSearch] = useState("");
  const [planning, setPlanning] = useState<MakeLine | null>(null);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  if (!state) return <Skeleton lines={6} />;
  const needle = search.trim().toLocaleLowerCase();
  const lines = state.toMake.filter((line) => (show === "all" || Number(line.left) !== 0)
    && (!needle || `${line.title} ${line.specification} ${line.projectReference} ${line.projectName}`.toLocaleLowerCase().includes(needle)));
  const columns: GroupedTableColumn<MakeLine>[] = [
    { id: "item", label: t("Item"), width: "46%", render: (line) => <span className={styles.nameCell}><span>{line.title}</span>
      {line.specification || line.packageName ? <small>{[line.packageName, line.specification].filter(Boolean).join(" · ")}</small> : null}</span> },
    { id: "quantity", label: t("Quantity"), width: "18%", render: (line) => <span className={styles.number}>{`${quantityText(line.quantity)} ${line.unit}`.trim()}</span> },
    { id: "planned", label: t("On work orders"), width: "18%", mobileHidden: true, render: (line) => Number(line.planned) ? <span className={styles.number}>{`${quantityText(line.planned)} ${line.unit}`.trim()}</span> : "—" },
    { id: "left", label: t("Left"), width: "18%", render: (line) => Number(line.left) > 0 ? <strong className={styles.number}>{`${quantityText(line.left)} ${line.unit}`.trim()}</strong>
      : Number(line.left) < 0 ? <span className={styles.lateText}>{t("{quantity} more on work orders than it needs", { quantity: `${quantityText(line.left.replace("-", ""))} ${line.unit}`.trim() })}</span>
      : <span className={styles.muted}>{t("Planned")}</span> },
  ];
  const sections: GroupedTableSection<MakeLine>[] = [...new Set(lines.map((line) => line.projectId))].map((projectId) => {
    const rows = lines.filter((line) => line.projectId === projectId);
    return { id: projectId, label: `${rows[0].projectReference} · ${rows[0].projectName}`, rows, emptyMessage: "" };
  });
  return <div className={styles.stack}>
    <div className={styles.filters}>
      <SearchInput label={t("Search what to make")} placeholder={t("Search")} value={search} onChange={setSearch} />
      <SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "left", label: t("Left to plan") }, { id: "all", label: t("Everything") }]} />
    </div>
    {!sections.length ? <EmptyState illustration={null} title={show === "left" ? t("Nothing left to plan") : t("Nothing to make yet")}
        description={t("Scope lines of packages made in our factory appear here once their project starts.")} />
      : <GroupedTable<MakeLine> ariaLabel={t("To make")} columns={columns} sections={sections} getRowId={(line) => line.lineId} getRowLabel={(line) => `${line.projectReference} ${line.title}`}
          selectable={false} onRowAction={state.canManage ? (line) => { if (Number(line.left) > 0) setPlanning(line); } : undefined} />}
    {planning ? <PlanDialog api={api} line={planning} state={state} onClose={() => setPlanning(null)} onPlanned={(id) => { setPlanning(null); onPlanned(id); }} /> : null}
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const over = Number(quantity) > Number(line.left);
  const valid = Number(quantity) > 0 && !over && (!start || !end || end >= start);
  return <ControlledModalDialog isOpen size="md" title={t("Plan work order")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); setError("");
        try { const saved = await api.plan({ id, lineId: line.lineId, quantity, workcenterId: workcenterId || null, plannedStart: start, plannedEnd: end, notes: notes.trim() }); onPlanned(saved.order.id); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
      }}>{t("Plan work order")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <p className={styles.muted}>{`${line.projectReference} · ${line.title}`}</p>
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
      <TextAreaField label={t("Notes")} value={notes} onChange={setNotes} />
    </div>
  </ControlledModalDialog>;
}
