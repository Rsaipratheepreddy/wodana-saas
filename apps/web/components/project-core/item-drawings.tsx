"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { FileText, PenTool, Ruler, UserRound } from "lucide-react";
import {
  Button, DataGrid, DateField, EmptyState, ErrorState, FileUploader, FormDialog, FormSection, InlineNotice, NumericInput, ReviewDialog, SegmentedControl, SelectField, Skeleton, StateChip,
  TagsField, TextAreaField, TextInput, type DataGridColumn, type ItemState,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { itemProofApi, type DrawingDetails, type ItemDrawing, type ItemDrawingState, type ItemDrawingsState, type ItemDrawingVersion, type ItemPlanInput, type ItemProofApi, type ItemSupplies, type ItemVersionStatus } from "@/lib/project-core/items";
import type { MeasureUnit } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import proof from "./item-proof.module.css";
import styles from "./project-core.module.css";

const ACCEPT = "application/pdf,image/*";
const CHIP: Record<ItemDrawingState, ItemState> = {
  not_needed: "not_applicable", waiting: "upcoming", with_lead_designer: "in_progress", with_client: "waiting", changes_asked: "returned", signed: "done",
};

/** The words for an item's drawing state, one chip each. */
export function useItemDrawingLabels() {
  const t = useT();
  return useMemo<Record<ItemDrawingState, string>>(() => ({
    not_needed: t("Not needed"), waiting: t("Waiting for drawing"), with_lead_designer: t("With the lead designer"), with_client: t("With the client"),
    changes_asked: t("Changes asked"), signed: t("Signed"),
  }), [t]);
}

function useUnitLabels() {
  const t = useT();
  return useMemo<Record<MeasureUnit, string>>(() => ({ mm: t("mm"), cm: t("cm"), m: t("m"), in: t("in"), ft: t("ft") }), [t]);
}

/** "4,500 × 2,400 × 600 mm": the sizes a version shows, in the workspace's digits. */
function useSizeText() {
  const format = useProjectFormat();
  const units = useUnitLabels();
  return (size: { width: string | null; height: string | null; depth: string | null; dimensionUnit: MeasureUnit } | null) => {
    if (!size) return "";
    const parts = [size.width, size.height, size.depth].filter((value): value is string => Boolean(value)).map((value) => format.number(value));
    return parts.length ? `${parts.join(" × ")} ${units[size.dimensionUnit]}` : "";
  };
}

/**
 * Shop drawings per item: each item's state as one chip, its current version, and the next step. The project's team
 * uploads a version (the file, the quantity and sizes it shows, a note); the lead designer checks it in a review that
 * previews the drawing, approving it for the client or returning it with the reason; the client signs in the portal,
 * which locks the item. Opening a row shows its versions and the signature.
 */
export function ItemDrawings({ workspaceId, projectId, onChanged }: { workspaceId: string; projectId: string; onChanged?: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useItemDrawingLabels();
  const size = useSizeText();
  const api = useMemo(() => itemProofApi(workspaceId, projectId), [workspaceId, projectId]);
  const [data, setData] = useState<ItemDrawingsState | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<{ kind: "upload" | "review" | "detail" | "plan" | "supplies"; lineId: string } | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.drawings()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The shop drawings didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const changed = (next: ItemDrawingsState) => { setData(next); onChanged?.(); };

  const columns = useMemo<DataGridColumn<ItemDrawing>[]>(() => [
    { id: "item", header: t("Item"), accessorFn: (item) => item.title, size: 240, meta: { primary: true, renderCell: (item) => <span className={styles.lineCell}>
      <span>{item.title}</span><small>{[item.area, `${format.number(item.quantity)} ${item.unit}`.trim()].filter(Boolean).join(" · ")}</small>
    </span> } },
    { id: "state", header: t("Drawing"), accessorFn: (item) => labels[item.state], size: 170, meta: { renderCell: (item) => <StateChip state={CHIP[item.state]} label={labels[item.state]} /> } },
    { id: "version", header: t("Version"), accessorFn: (item) => item.number, size: 200, meta: { mobileHidden: true, renderCell: (item) => {
      if (item.signature) return <span className={styles.lineCell}><span>{t("V{number}", { number: item.locked?.number ?? item.number })}</span>
        <small>{t("Signed by {name} on {date}", { name: item.signature.signerName, date: format.when(item.signature.signedAt) })}</small></span>;
      if (!item.current) return <span className={styles.muted}>—</span>;
      return <span className={styles.lineCell}><span>{t("V{number}", { number: item.current.number })}</span>
        <small>{[item.current.byName, format.when(item.current.at)].filter(Boolean).join(" · ")}</small></span>;
    } } },
    { id: "size", header: t("Size"), accessorFn: (item) => size(item.locked ?? item.current), size: 170, meta: { mobileHidden: true, priority: "medium",
      renderCell: (item) => <span className={styles.number}>{size(item.locked ?? item.current) || "—"}</span> } },
    { id: "supplies", header: t("Supplies"), accessorFn: (item) => (item.supplies ? 1 : 0), size: 150, meta: { mobileHidden: true, priority: "medium",
      renderCell: (item) => <StateChip state={item.supplies ? "done" : "upcoming"} label={item.supplies ? t("Signed off") : t("Not signed off")} /> } },
    { id: "action", header: "", enableSorting: false, size: 150, meta: { align: "end", interactive: true, renderCell: (item) => item.canReview
      ? <Button size="compact" variant="primary" onPress={() => setDialog({ kind: "review", lineId: item.lineId })}>{t("Review")}</Button>
      : item.canUpload ? <Button size="compact" onPress={() => setDialog({ kind: "upload", lineId: item.lineId })}>{item.number ? t("Upload a new version") : t("Upload drawing")}</Button> : null } },
  ], [format, labels, size, t]);

  if (error && !data) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!data) return <Skeleton lines={4} shape="rows" />;
  const open = dialog ? data.items.find((item) => item.lineId === dialog.lineId) ?? null : null;
  return <div className={styles.scopeView}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <DataGrid<ItemDrawing> ariaLabel={t("Shop drawings")} wrapText columns={columns} data={data.items} getRowId={(item) => item.lineId} selectable={false} rowNumbers={false}
      showToolbar={false} showFooter={false} pageSize={200} onRowAction={(item) => setDialog({ kind: "detail", lineId: item.lineId })}
      emptyContent={<EmptyState illustration={null} title={t("No items yet")} />} />
    {open && dialog?.kind === "upload" ? <UploadDialog item={open} units={data.units} unit={data.dimensionUnit} onClose={() => setDialog(null)}
      onSave={async (file, details) => { changed(await api.uploadDrawing(open.lineId, crypto.randomUUID(), file, details)); setDialog(null); }} /> : null}
    {open && dialog?.kind === "review" && open.current ? <ReviewDrawing item={open} version={open.current} api={api} onClose={() => setDialog(null)}
      onDecide={async (decision, reason) => { changed(await api.review(open.current!.id, open.version, decision, reason)); setDialog(null); }} /> : null}
    {open && dialog?.kind === "plan" ? <PlanDialog item={open} onClose={() => setDialog(null)}
      onSave={async (input) => { changed(await api.plan(open.lineId, open.plan?.version ?? 0, input)); setDialog(null); }} /> : null}
    {open && dialog?.kind === "supplies" ? <SuppliesDialog item={open} onClose={() => setDialog(null)}
      onSave={async (method, note) => { changed(await api.signOffSupplies(open.lineId, method, note)); setDialog(null); }} /> : null}
    {open && dialog?.kind === "detail" ? <ItemDetail item={open} api={api} onClose={() => setDialog(null)}
      onPlan={data.canPlan ? () => setDialog({ kind: "plan", lineId: open.lineId }) : undefined}
      onSupplies={open.canSignOffSupplies ? () => setDialog({ kind: "supplies", lineId: open.lineId }) : undefined}
      onNext={open.canReview ? () => setDialog({ kind: "review", lineId: open.lineId }) : open.canUpload ? () => setDialog({ kind: "upload", lineId: open.lineId }) : undefined}
      nextLabel={open.canReview ? t("Review") : open.number ? t("Upload a new version") : t("Upload drawing")} /> : null}
  </div>;
}

/** A shop drawing version: the file, the quantity (the item's own to start with), the sizes in the workspace's unit, a note. Save bottom-end. */
function UploadDialog({ item, units, unit, onClose, onSave }: {
  item: ItemDrawing; units: MeasureUnit[]; unit: MeasureUnit; onClose: () => void; onSave: (file: File, details: DrawingDetails) => Promise<void>;
}) {
  const t = useT();
  const unitLabels = useUnitLabels();
  const last = item.current;
  const [file, setFile] = useState<File | null>(null);
  const [quantity, setQuantity] = useState<number>(Number(last?.quantity ?? item.quantity));
  const [width, setWidth] = useState<number>(last?.width ? Number(last.width) : Number.NaN);
  const [height, setHeight] = useState<number>(last?.height ? Number(last.height) : Number.NaN);
  const [depth, setDepth] = useState<number>(last?.depth ? Number(last.depth) : Number.NaN);
  const [dimensionUnit, setDimensionUnit] = useState<MeasureUnit>(last?.dimensionUnit ?? unit);
  const [note, setNote] = useState("");
  const text = (value: number) => (Number.isFinite(value) ? String(value) : "");
  const valid = Boolean(file) && Number.isFinite(quantity) && quantity > 0;
  return <FormDialog size="md" title={t("Shop drawing for {item}", { item: item.title })} description={t("V{number}", { number: item.number + 1 })} onClose={onClose}
    isDirty={Boolean(file || note.trim())} isSubmitDisabled={!valid} submitLabel={t("Upload")}
    onSubmit={() => onSave(file!, { version: item.version, quantity: text(quantity), width: text(width), height: text(height), depth: text(depth), dimensionUnit, note: note.trim() })}>
    <FormSection>
      <FileUploader accept={ACCEPT} multiple={false} label={file ? file.name : t("Drawing file")} onFiles={(files) => setFile(files[0] ?? null)} />
      <NumericInput label={t("Quantity ({unit})", { unit: item.unit })} isRequired minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={quantity}
        onChange={(value) => setQuantity(value)} />
      <NumericInput label={t("Width")} minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={width} onChange={setWidth} />
      <NumericInput label={t("Height")} minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={height} onChange={setHeight} />
      <NumericInput label={t("Depth")} minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={depth} onChange={setDepth} />
      <SelectField label={t("Unit")} accent="neutral" selectedKey={dimensionUnit} items={units.map((id) => ({ id, label: unitLabels[id] }))}
        onSelectionChange={(key) => setDimensionUnit(String(key) as MeasureUnit)} />
      <TextAreaField label={t("Note")} maxLength={1000} value={note} onChange={setNote} />
    </FormSection>
  </FormDialog>;
}

/** The drawing's preview (or its file) under review. */
function DrawingPreview({ version, api }: { version: ItemDrawingVersion; api: ItemProofApi }) {
  return <div className={proof.evidence}>
    {/* eslint-disable-next-line @next/next/no-img-element -- private, authenticated previews stay on the same-origin file endpoint. */}
    {version.hasPreview ? <img alt={version.name} src={api.drawingUrl(version.id, true)} /> : null}
    <a className="wd-button" data-variant="secondary" data-size="compact" href={api.drawingUrl(version.id)} target="_blank" rel="noreferrer"><FileText aria-hidden="true" size={14} />{version.name}</a>
  </div>;
}

/** The lead designer's check: approved goes to the client; returned needs the reason. Never decided from the list. */
function ReviewDrawing({ item, version, api, onClose, onDecide }: {
  item: ItemDrawing; version: ItemDrawingVersion; api: ItemProofApi; onClose: () => void; onDecide: (decision: "approve" | "return", reason: string) => Promise<void>;
}) {
  const t = useT();
  const format = useProjectFormat();
  const size = useSizeText();
  return <ReviewDialog title={t("Check {item}", { item: item.title })} description={t("V{number}", { number: version.number })} icon={<PenTool />}
    confirmLabel={t("Approve for the client")} returnLabel={t("Return")} onClose={onClose}
    facts={[
      { label: t("Uploaded by"), value: [version.byName, format.when(version.at)].filter(Boolean).join(" · "), icon: <UserRound /> },
      { label: t("Quantity"), value: `${format.number(version.quantity)} ${version.unit}`.trim(), icon: <Ruler /> },
      ...(size(version) ? [{ label: t("Size"), value: size(version), icon: <Ruler /> }] : []),
      ...(version.note ? [{ label: t("Note"), value: version.note }] : []),
    ]}
    evidence={<DrawingPreview version={version} api={api} />}
    onConfirm={() => onDecide("approve", "")} onReturn={(reason) => onDecide("return", reason)} />;
}

/** One item: every version with who and when, the lead designer's and the client's words, and the client's signature (who, when, device, fingerprint). */
function ItemDetail({ item, api, onClose, onNext, nextLabel, onPlan, onSupplies }: {
  item: ItemDrawing; api: ItemProofApi; onClose: () => void; onNext?: () => void; nextLabel: string; onPlan?: () => void; onSupplies?: () => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const size = useSizeText();
  const labels = useItemDrawingLabels();
  const words: Record<ItemVersionStatus, string> = { with_lead_designer: t("With the lead designer"), returned: t("Returned"), with_client: t("With the client"),
    changes_asked: t("Changes asked"), signed: t("Signed") };
  return <FormDialog size="md" title={item.title} description={labels[item.state]} onClose={onClose} hideSubmit={!onNext} submitLabel={nextLabel}
    onSubmit={() => { onClose(); onNext?.(); }}>
    <dl className={styles.detailList}>
      <div><dt>{t("Plan")}</dt><dd>{item.plan ? [item.plan.drafterName && t("Drawing by {name}", { name: item.plan.drafterName }),
        item.plan.drafterDueOn && t("due {date}", { date: format.when(item.plan.drafterDueOn) }), item.plan.personsNeeded && t("{count} people", { count: item.plan.personsNeeded }),
        item.plan.crewNames.join(", "), item.plan.deliveryMode === "delivery" ? t("Delivery only") : t("Delivery and installation")].filter(Boolean).join(" · ") : t("Not planned")}
        {onPlan ? <Button size="compact" variant="quiet" onPress={() => { onClose(); onPlan(); }}>{item.plan ? t("Change plan") : t("Plan item")}</Button> : null}</dd></div>
      <div><dt>{t("Supplies")}</dt><dd>{item.supplies ? t("Signed off by {name} on {date}", { name: item.supplies.signedByName ?? "", date: format.when(item.supplies.signedAt) }) : t("Not signed off")}
        {item.supplies ? <small>{[item.supplies.method === "ordered" ? t("Ordered") : t("From factory stock"), item.supplies.note].filter(Boolean).join(" · ")}</small> : null}
        {onSupplies ? <Button size="compact" variant="quiet" onPress={() => { onClose(); onSupplies(); }}>{t("Sign off supplies")}</Button> : null}</dd></div>
      {item.signature ? <div><dt>{t("Signed")}</dt><dd>{t("{name} on {date}", { name: item.signature.signerName, date: format.when(item.signature.signedAt) })}
        <small>{[item.signature.device, t("Code confirmed"), item.signature.fingerprint.slice(0, 12)].filter(Boolean).join(" · ")}</small></dd></div> : null}
      {item.locked ? <div><dt>{t("Locked")}</dt><dd>{`${format.number(item.locked.quantity)} ${item.locked.unit}`.trim()}{size(item.locked) ? <small>{size(item.locked)}</small> : null}</dd></div> : null}
      {item.versions.map((version) => <div key={version.id}>
        <dt>{t("V{number}", { number: version.number })} · {words[version.status]}</dt>
        <dd><a className={styles.detailLink} href={api.drawingUrl(version.id)} target="_blank" rel="noreferrer">{version.name}</a>
          <small>{[version.byName, format.when(version.at), size(version)].filter(Boolean).join(" · ")}</small>
          {version.reviewNote ? <small>{t("Lead designer: {note}", { note: version.reviewNote })}</small> : null}
          {version.clientNote ? <small>{t("Client: {note}", { note: version.clientNote })}</small> : null}</dd>
      </div>)}
    </dl>
    {!item.versions.length ? <EmptyState illustration={null} title={item.needed ? t("No drawing yet") : t("Not needed")} /> : null}
  </FormDialog>;
}

/** Guide steps 18, 22 and 24: who drafts the item's drawing (a name, no login) and by when, the factory's people and crew, and how it reaches site. Save bottom-end. */
function PlanDialog({ item, onClose, onSave }: { item: ItemDrawing; onClose: () => void; onSave: (input: ItemPlanInput) => Promise<void> }) {
  const t = useT();
  const plan = item.plan;
  const [drafterName, setDrafterName] = useState(plan?.drafterName ?? "");
  const [dueOn, setDueOn] = useState<string | null>(plan?.drafterDueOn ?? null);
  const [persons, setPersons] = useState<number>(plan?.personsNeeded ?? Number.NaN);
  const [crew, setCrew] = useState<string[]>(plan?.crewNames ?? []);
  const [mode, setMode] = useState<ItemPlanInput["deliveryMode"]>(plan?.deliveryMode ?? "delivery_install");
  return <FormDialog size="md" title={t("Plan {item}", { item: item.title })} onClose={onClose} isDirty submitLabel={t("Save")}
    onSubmit={() => onSave({ drafterName: drafterName.trim(), drafterDueOn: dueOn, personsNeeded: Number.isFinite(persons) ? persons : null, crewNames: crew, deliveryMode: mode })}>
    <FormSection>
      <TextInput label={t("Drawing by")} maxLength={120} value={drafterName} onChange={setDrafterName} />
      <DateField label={t("Drawing due")} value={dueOn ? parseDate(dueOn) : null} onChange={(value) => setDueOn(value ? value.toString() : null)} />
      <NumericInput label={t("People needed")} minValue={1} maxValue={99} formatOptions={{ maximumFractionDigits: 0 }} value={persons} onChange={setPersons} />
      <TagsField label={t("Crew")} values={crew} onChange={(values) => setCrew(values.slice(0, 20))} />
      <SegmentedControl label={t("Delivery")} value={mode} onChange={(value) => setMode(value as ItemPlanInput["deliveryMode"])}
        options={[{ id: "delivery", label: t("Delivery only") }, { id: "delivery_install", label: t("Delivery and installation") }]} />
    </FormSection>
  </FormDialog>;
}

/** Guide step 21: procurement ordered the materials or checked the factory's stock, and signs off the item's supplies. What's missing comes back from the check. */
function SuppliesDialog({ item, onClose, onSave }: { item: ItemDrawing; onClose: () => void; onSave: (method: ItemSupplies["method"], note: string) => Promise<void> }) {
  const t = useT();
  const format = useProjectFormat();
  const [method, setMethod] = useState<ItemSupplies["method"]>("ordered");
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={t("Sign off supplies for {item}", { item: item.title })}
    description={[`${format.number(item.locked?.quantity ?? item.quantity)} ${item.locked?.unit ?? item.unit}`.trim(), item.signature ? t("Drawing signed") : null].filter(Boolean).join(" · ")}
    onClose={onClose} isDirty={Boolean(note.trim())} submitLabel={t("Sign off supplies")} onSubmit={() => onSave(method, note.trim())}>
    <FormSection>
      <SegmentedControl label={t("Materials")} value={method} onChange={(value) => setMethod(value as ItemSupplies["method"])}
        options={[{ id: "ordered", label: t("Ordered") }, { id: "from_stock", label: t("From factory stock") }]} />
      <TextAreaField label={t("Note")} maxLength={1000} value={note} onChange={setNote} />
    </FormSection>
  </FormDialog>;
}
