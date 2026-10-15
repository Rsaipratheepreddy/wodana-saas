"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge, Button, EmptyState, ErrorState, FormDialog, IconButton, InlineNotice, InspectorSheet, RecordTable, SelectField, Skeleton, TextAreaField, TextInput, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import {
  COMPONENT_TYPES, HANDOVER_ITEMS, REQUIREMENT_ITEM_TYPES, type ComponentType, type HandoverItem, type HandoverRow, type LineRequirementRow, type RequirementItemType, type RequirementState,
  type TechnicalHandover,
} from "@/lib/project-core/technical";
import { catalogItemHref } from "@/lib/readiness/types";
import { ReadinessCellView, useReadinessLabels } from "../readiness/readiness-grid";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";
import readinessStyles from "../readiness/readiness.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;

/** The words for component kinds and where a line's requirements stand. */
export function useRequirementLabels() {
  const t = useT();
  return useMemo(() => ({
    type: { board: t("Board"), fabric: t("Fabric"), foam: t("Foam"), hardware: t("Hardware"), labour: t("Labour"), other: t("Other") } satisfies Record<ComponentType, string>,
    state: {
      verified: t("Verified recipe"), confirmed: t("Confirmed by the factory"), pending: t("Waiting for the factory lead"), needs_requirements: t("Needs factory requirements"), not_needed: t("Not made"),
    } satisfies Record<RequirementState, string>,
    tone: { verified: "success", confirmed: "success", pending: "warning", needs_requirements: "danger", not_needed: "neutral" } satisfies Record<RequirementState, "success" | "warning" | "danger" | "neutral">,
  }), [t]);
}

/**
 * PLM-165: the technical handover pack. Every line of the project's scope with its drawing need, where its material and
 * labour requirements stand (PLM-166), its size and a checklist of what is still missing. Sales or design hands it over;
 * the technical team accepts it once nothing required is missing (an item marked "Not applicable" with a reason no
 * longer counts). A line opens its requirements: the verified recipe's quantities, or the factory's record to fill and
 * confirm.
 */
export function ProjectTechnicalHandover({ workspaceId, projectId, version, run }: { workspaceId: string; projectId: string; version: number; run: Run }) {
  const t = useT();
  const format = useProjectFormat();
  const words = useReadinessLabels();
  const labels = useRequirementLabels();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [pack, setPack] = useState<TechnicalHandover | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"hand_over" | { waive: { row: HandoverRow; item: HandoverItem } } | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setPack(await api.technicalHandover(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The handover didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, version]);

  const act = async (action: string, input: Record<string, unknown> = {}) => {
    setBusy(true);
    const ok = await run(action, input);
    setBusy(false);
    if (ok) await load();
    return ok;
  };

  const drawingWords: Record<string, string> = { bespoke: t("Bespoke"), made_to_order: t("Made to order"), no_catalogue_drawing: t("No catalogue drawing"), catalogue_drawing: t("Catalogue drawing") };
  const columns = useMemo<DataGridColumn<HandoverRow>[]>(() => [
    { id: "item", header: t("Item"), accessorFn: (row) => `${row.title} ${row.code ?? ""}`, size: 240, meta: { primary: true, renderCell: (row) => <span className={readinessStyles.item}>
      <strong>{row.title}</strong>
      <small>{[row.code ? <bdi dir="ltr" key="code">{row.code}</bdi> : null, <span className={styles.number} key="qty">{Number(row.quantity).toLocaleString()} {row.unit}</span>]
        .filter(Boolean).flatMap((part, index) => (index ? [" · ", part] : [part]))}</small>
    </span> } },
    { id: "area", header: t("Area"), accessorFn: (row) => row.areaName ?? "", size: 120, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.muted}>{row.areaName ?? t("General")}</span> } },
    { id: "size", header: t("Size"), accessorFn: (row) => row.size ?? "", size: 140, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.number}>{row.size ?? "—"}</span> } },
    { id: "drawing", header: t("Drawings"), accessorFn: (row) => (row.drawing?.needed ? 1 : 0), size: 150, meta: { renderCell: (row) => !row.drawing ? <span className={readinessStyles.notNeeded}>{t("Not needed")}</span>
      : <span className={readinessStyles.item}><Badge tone={row.drawing.needed ? "info" : "neutral"}>{row.drawing.needed ? t("Needed") : t("Not needed")}</Badge><small>{drawingWords[row.drawing.reason]}{row.drawing.overridden ? ` · ${t("Decided by the team")}` : ""}</small></span> } },
    { id: "requirements", header: t("Materials & labour"), accessorFn: (row) => row.requirements, size: 190, meta: { interactive: true, renderCell: (row) => row.requirements === "not_needed"
      ? <span className={readinessStyles.notNeeded}>{labels.state.not_needed}</span>
      : <button aria-label={t("Open requirements for {item}", { item: row.title })} className={readinessStyles.chip} onClick={() => setLine(row.lineId)} type="button"><Badge tone={labels.tone[row.requirements]}>{labels.state[row.requirements]}</Badge></button> } },
    ...HANDOVER_ITEMS.map((item): DataGridColumn<HandoverRow> => ({ id: item, header: words.column[item], accessorFn: (row) => row.cells[item]?.state ?? "", size: 130, enableSorting: false, meta: { interactive: true, renderCell: (row) => {
      const waiver = row.waivers[item];
      if (waiver) return <span className={readinessStyles.notNeeded} title={`${waiver.reason} · ${waiver.byName ?? ""}`}>{t("Not applicable")}</span>;
      const cell = row.cells[item];
      const catalogue = row.catalogItemId && row.catalogId && (item === "picture" || item === "size") ? { href: catalogItemHref(row.catalogId, row.catalogItemId, item) } : null;
      const target = cell?.state === "missing" && pack?.canWaive ? { onPress: () => setDialog({ waive: { row, item } }) } : catalogue;
      return <ReadinessCellView cell={cell} label={words.column[item]} target={target} />;
    } } })),
    { id: "missing", header: t("Missing"), accessorFn: (row) => row.missing.length, size: 90, meta: { align: "end", renderCell: (row) => row.missing.length ? <Badge tone="danger">{row.missing.length}</Badge> : <span className={readinessStyles.notNeeded}>—</span> } },
  ], [labels, pack?.canWaive, t, words, drawingWords]);

  if (error && !pack) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!pack) return <Skeleton lines={6} shape="rows" />;
  const status = pack.status === "accepted" && pack.accepted ? t("Accepted by {name} on {date}", { name: pack.accepted.byName ?? "", date: format.when(pack.accepted.at) })
    : pack.status === "handed_over" && pack.handedOver ? t("Handed over by {name} on {date}", { name: pack.handedOver.byName ?? "", date: format.when(pack.handedOver.at) })
      : t("Not handed over yet");
  const selected = line ? pack.requirements.find((row) => row.lineId === line) ?? null : null;

  return <div className={styles.scopeView}>
    <div className={styles.scopeToolbar}>
      <div className={styles.headFacts}>
        <Badge tone={pack.status === "accepted" ? "success" : pack.status === "handed_over" ? "info" : "neutral"}>{status}</Badge>
        <Badge tone={pack.missing ? "danger" : "success"}>{pack.missing ? t("{count} missing", { count: pack.missing }) : t("Nothing missing")}</Badge>
        {pack.handedOver?.note ? <span className={styles.muted}>{pack.handedOver.note}</span> : null}
      </div>
      <div className={styles.toolbarActions}>
        {pack.canHandOver ? <Button size="compact" variant={pack.status === "draft" ? "primary" : "secondary"} onPress={() => setDialog("hand_over")}>{pack.status === "draft" ? t("Hand over to technical") : t("Hand over again")}</Button> : null}
        {pack.canAccept ? <Button size="compact" variant="primary" isLoading={busy} isDisabled={pack.missing > 0} onPress={() => void act("accept_technical_handover", { handoverVersion: pack.version })}>{t("Accept handover")}</Button> : null}
      </div>
    </div>
    {pack.canAccept && pack.missing > 0 ? <InlineNotice tone="info" message={t("The pack can't be accepted while items are missing. Fill them, or mark them not applicable with a reason.")} /> : null}
    <RecordTable<HandoverRow> ariaLabel={t("Technical handover")} columns={columns} data={pack.rows} getRowId={(row) => row.lineId} onRowAction={(row) => setLine(row.lineId)}
      emptyContent={<EmptyState illustration={null} title={t("No items")} />} />

    {dialog === "hand_over" ? <HandOverDialog onClose={() => setDialog(null)} onSave={async (note) => { if (await act("hand_over_technical", { note, handoverVersion: pack.version })) setDialog(null); }} /> : null}
    {dialog && typeof dialog === "object" ? <WaiveDialog item={words.column[dialog.waive.item]} title={dialog.waive.row.title} onClose={() => setDialog(null)}
      onSave={async (reason) => { if (await act("waive_handover_item", { lineId: dialog.waive.row.lineId, item: dialog.waive.item, reason })) setDialog(null); }} /> : null}
    {selected ? <RequirementsSheet row={selected} pack={pack} busy={busy} act={act} onClose={() => setLine(null)} /> : null}
  </div>;
}

/** Handing the pack over: a note for the technical team (what to look at first). */
function HandOverDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={t("Hand over to technical")} onClose={onClose} isDirty={Boolean(note.trim())} submitLabel={t("Hand over")} onSubmit={() => void onSave(note.trim())}>
    <TextAreaField label={t("Note for the technical team")} value={note} onChange={setNote} />
  </FormDialog>;
}

/** Marking a checklist item not applicable on one line needs the reason. */
function WaiveDialog({ item, title, onClose, onSave }: { item: string; title: string; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  return <FormDialog size="md" title={t("{item} not applicable for {title}", { item, title })} onClose={onClose} isDirty={Boolean(reason.trim())} isSubmitDisabled={!reason.trim()} submitLabel={t("Save")}
    onSubmit={() => void onSave(reason.trim())}>
    <TextAreaField label={t("Why it doesn't apply")} isRequired value={reason} onChange={setReason} />
  </FormDialog>;
}

type ItemDraft = { componentType: RequirementItemType; name: string; quantity: string; unit: string; note: string };

/**
 * PLM-166: one line's requirements. A verified recipe shows its quantities by kind and the labour hours; otherwise the
 * factory's record is filled here (materials by kind, labour hours, notes) and the factory lead confirms it. Editing a
 * confirmed record opens it again.
 */
function RequirementsSheet({ row, pack, busy, act, onClose }: { row: LineRequirementRow; pack: TechnicalHandover; busy: boolean; act: (action: string, input?: Record<string, unknown>) => Promise<boolean>; onClose: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useRequirementLabels();
  const factory = row.factory;
  const [items, setItems] = useState<ItemDraft[]>(() => (factory?.items ?? []).map(({ componentType, name, quantity, unit, note }) => ({ componentType, name, quantity: Number(quantity).toString(), unit, note })));
  const [hours, setHours] = useState(factory?.labourHours ? Number(factory.labourHours).toString() : "");
  const [notes, setNotes] = useState(factory?.notes ?? "");
  const [editing, setEditing] = useState(!factory);
  const decimal = (value: string) => value.replace(/[^\d.]/g, "");
  const update = (index: number, patch: Partial<ItemDraft>) => setItems((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const complete = items.every((item) => item.name.trim() && /^\d+(\.\d+)?$/.test(item.quantity)) && (!hours || /^\d+(\.\d+)?$/.test(hours));
  const save = async () => {
    if (await act("save_factory_requirement", { lineId: row.lineId, items: items.map((item) => ({ ...item, name: item.name.trim() })), labourHours: hours || null, notes: notes.trim(), requirementVersion: factory?.version })) setEditing(false);
  };
  const recipe = row.recipe;
  const groups = recipe.state === "verified" ? COMPONENT_TYPES.map((type) => ({ type, lines: recipe.lines.filter((line) => line.componentType === type) })).filter((group) => group.lines.length) : [];
  const canEdit = pack.canSaveRequirements && recipe.state !== "verified";
  return <InspectorSheet isOpen size="md" title={row.title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={canEdit && editing ? <div className="wd-dialog-actions">
      <span className={styles.spacer} />
      {factory ? <Button onPress={() => setEditing(false)}>{t("Cancel")}</Button> : null}
      <Button variant="primary" isLoading={busy} isDisabled={!complete || (!items.length && !hours)} onPress={() => void save()}>{t("Save")}</Button>
    </div> : null}>
    <div className={styles.sheetBody}>
      <dl className={styles.sheetFacts}>
        <div><dt>{t("Quantity")}</dt><dd>{Number(row.quantity).toLocaleString()} {row.unit}{row.size ? ` · ${row.size}` : ""}</dd></div>
        <div><dt>{t("Materials & labour")}</dt><dd><Badge tone={labels.tone[row.state]}>{labels.state[row.state]}</Badge></dd></div>
        {recipe.state === "verified" ? <div><dt>{t("Recipe verified")}</dt><dd>{t("{name} on {date}", { name: recipe.verified.byName ?? "", date: format.when(recipe.verified.at) })}</dd></div> : null}
        {factory?.status === "confirmed" && factory.confirmedAt ? <div><dt>{t("Confirmed")}</dt><dd>{t("{name} on {date}", { name: factory.confirmedByName ?? "", date: format.when(factory.confirmedAt) })}</dd></div> : null}
      </dl>

      {recipe.state === "verified" ? <>
        <h3 className={styles.sheetHeading}>{t("From the verified recipe")}</h3>
        {groups.map((group) => <div key={group.type}>
          <p className={styles.muted}>{labels.type[group.type]}</p>
          <ul className={styles.history}>{group.lines.map((line) => <li key={line.componentItemId}><span>{line.label}</span>
            <small>{group.type === "labour" && line.hours ? t("{hours} h", { hours: Number(line.hours) }) : t("{quantity} {unit} · buy {purchase}", { quantity: Number(line.quantity).toLocaleString(), unit: line.unitCode, purchase: Number(line.purchaseQuantity).toLocaleString() })}</small></li>)}</ul>
        </div>)}
        {Number(recipe.labourHours) > 0 ? <p className={styles.muted}>{t("Labour: {hours} h", { hours: Number(recipe.labourHours) })}</p> : null}
      </> : <>
        {recipe.state === "unverified" ? <InlineNotice tone="info" message={t("The catalogue recipe isn't verified, so its quantities aren't used. Record the factory requirements instead.")} /> : null}
        {recipe.state === "needs_measurements" ? <InlineNotice tone="info" message={t("The recipe needs a measurement this item doesn't have: {problem}", { problem: recipe.problem })} /> : null}
        <h3 className={styles.sheetHeading}>{t("Factory requirements")}</h3>
        {editing && canEdit ? <>
          {items.map((item, index) => <div className={styles.measureRow} key={index}>
            <SelectField aria-label={t("Kind")} label={t("Kind")} selectedKey={item.componentType} onSelectionChange={(key) => update(index, { componentType: key as RequirementItemType })}
              items={REQUIREMENT_ITEM_TYPES.map((type) => ({ id: type, label: labels.type[type] }))} />
            <TextInput label={t("Material")} isRequired value={item.name} onChange={(value) => update(index, { name: value })} />
            <TextInput label={t("Qty")} isRequired value={item.quantity} onChange={(value) => update(index, { quantity: decimal(value) })} />
            <TextInput label={t("Unit")} value={item.unit} onChange={(value) => update(index, { unit: value })} />
            <IconButton aria-label={`${t("Remove")} ${item.name}`} onPress={() => setItems((current) => current.filter((_, at) => at !== index))}><Trash2 aria-hidden="true" size={15} /></IconButton>
          </div>)}
          <div className={styles.toolbarActions}>
            <Button size="compact" variant="quiet" onPress={() => setItems((current) => [...current, { componentType: "board", name: "", quantity: "1", unit: "", note: "" }])}><Plus aria-hidden="true" size={14} />{t("Add material")}</Button>
          </div>
          <TextInput label={t("Labour hours")} value={hours} onChange={(value) => setHours(decimal(value))} suffix="h" />
          <TextAreaField label={t("Notes")} value={notes} onChange={setNotes} />
        </> : factory ? <>
          {factory.items.length ? <ul className={styles.history}>{factory.items.map((item) => <li key={item.id}><span>{item.name}</span><small>{labels.type[item.componentType]} · {Number(item.quantity).toLocaleString()} {item.unit}{item.note ? ` · ${item.note}` : ""}</small></li>)}</ul> : null}
          {factory.labourHours ? <p className={styles.muted}>{t("Labour: {hours} h", { hours: Number(factory.labourHours) })}</p> : null}
          {factory.notes ? <p className={styles.prose}>{factory.notes}</p> : null}
          <p className={styles.muted}>{t("Last changed by {name} on {date}", { name: factory.updatedByName ?? "", date: format.when(factory.updatedAt) })}</p>
          <div className={styles.toolbarActions}>
            {canEdit ? <Button size="compact" onPress={() => setEditing(true)}>{t("Edit")}</Button> : null}
            {pack.canConfirmRequirements && factory.status === "pending" ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void act("confirm_factory_requirement", { lineId: row.lineId, requirementVersion: factory.version })}>{t("Confirm requirements")}</Button> : null}
          </div>
        </> : <p className={styles.muted}>{t("Nothing recorded yet.")}</p>}
      </>}
    </div>
  </InspectorSheet>;
}
