"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import { Badge,
  Button, DataGrid, DateField, FormDialog, FormSection, VisuallyHidden, EmptyState, ErrorState, IconButton, InlineNotice, InspectorSheet, NoResultsState, SelectField, Skeleton, TextAreaField, TextInput,
  type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { StockLocation, UnmatchedDelivery, UnmatchedState } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { PhotoPicker, SavedPhotos } from "./delivery-photos";
import { quantityText } from "./order-labels";
import { usePlaceLabel } from "./receive-dialog";
import styles from "./purchasing.module.css";

type Line = { description: string; quantity: string; unit: string };
const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const OTHER = "other";

/** Goods that came without an order, the open ones first. A row opens them to match or send back. */
export function UnmatchedList({ rows, search, onSearch, toolbar, onOpen }: {
  rows: UnmatchedDelivery[]; search: string; onSearch: (value: string) => void; toolbar: React.ReactNode; onOpen: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const columns = useMemo<DataGridColumn<UnmatchedDelivery>[]>(() => [
    { id: "number", header: t("Arrived"), accessorFn: (row) => row.number, size: 220, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.supplierName}</span><small>{row.lines === 1 ? t("1 line") : t("{count} lines", { count: row.lines })}</small></span> } },
    { id: "where", header: t("Arrived at"), accessorFn: (row) => row.locationName, size: 180 },
    { id: "when", header: t("Received"), accessorFn: (row) => row.receivedOn, size: 170, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{format.day(row.receivedOn)}</span><small>{row.receivedByName}</small></span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 170, meta: { renderCell: (row) => <Badge tone={row.status === "open" ? "warning" : row.status === "matched" ? "success" : "neutral"}>
      {row.status === "open" ? t("To match") : row.status === "matched" ? t("Matched") : t("Sent back")}</Badge> } },
  ], [t, format]);
  const shown = rows.filter((row) => !search.trim() || `${row.supplierName} ${row.locationName} ${row.deliveryNote}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <DataGrid<UnmatchedDelivery> ariaLabel={t("Without an order")} columns={columns} data={shown} getRowId={(row) => row.id} onRowAction={(row) => onOpen(row.id)}
    onSearchChange={onSearch} searchValue={search} searchLabel={t("Search deliveries")} toolbarLeading={toolbar} rowNumbers={false} selectable={false} wrapText
    emptyContent={search.trim() ? <NoResultsState onClear={() => onSearch("")} /> : <EmptyState title={t("Nothing waiting to be matched")} />} />;
}

/** Records goods that came without an order: who from, where, what the note says, and photos. */
export function RecordUnmatchedDialog({ api, locations, onClose, onRecorded }: { api: PurchasingApi; locations: StockLocation[]; onClose: () => void; onRecorded: (next: UnmatchedState) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const placeLabel = usePlaceLabel();
  const [id] = useState(() => crypto.randomUUID());
  const [suppliers, setSuppliers] = useState<Array<{ id: string; label: string }>>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const places = useMemo(() => [...locations.map((location) => ({ id: location.id, label: location.name })),
    ...(locations.some((location) => location.kind === "warehouse") ? [] : [{ id: "warehouse", label: placeLabel({ kind: "warehouse", name: null, projectReference: null }) }])], [locations, placeLabel]);
  const [place, setPlace] = useState<string | null>(places[0]?.id ?? null);
  const [receivedOn, setReceivedOn] = useState(format.today());
  const [note, setNote] = useState("");
  const [handedOverBy, setHandedOverBy] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "", unit: "" }]);
  const [photos, setPhotos] = useState<File[]>([]);
  const photoIds = useMemo(() => photos.map(() => crypto.randomUUID()), [photos]);
  useEffect(() => {
    api.suppliers().then((state) => setSuppliers(state.suppliers.filter((item) => item.status !== "archived").sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({ id: item.id, label: item.name })))).catch(() => undefined);
  }, [api]);
  const filled = lines.filter((line) => line.description.trim() && Number(line.quantity) > 0);
  const known = vendorId && vendorId !== OTHER;
  const ready = Boolean(place) && filled.length > 0 && (known || supplierName.trim());
  const setLine = (index: number, patch: Partial<Line>) => setLines(lines.map((line, item) => (item === index ? { ...line, ...patch } : line)));
  const save = async () => {
    let saved = await api.recordUnmatched({ id, vendorId: known ? vendorId : null, supplierName: known ? "" : supplierName.trim(), place, receivedOn, deliveryNote: note.trim(),
      handedOverBy: handedOverBy.trim(), lines: filled.map((line) => ({ description: line.description.trim(), quantity: line.quantity, unit: line.unit.trim() })) });
    for (const [index, file] of photos.entries()) saved = await api.uploadPhoto({ kind: "unmatched", id }, photoIds[index], file);
    onRecorded(saved);
  };
  return <FormDialog size="lg" title={t("Goods without an order")} onClose={onClose} isDirty={Boolean(filled.length || note.trim() || photos.length)} isSubmitDisabled={!ready} submitLabel={t("Save")} onSubmit={save}>
      <FormSection title={t("Delivery")}>
        <SelectField label={t("From")} isRequired selectedKey={vendorId} placeholder={t("Choose the supplier")} onSelectionChange={(key) => setVendorId(key === null ? null : String(key))}
          items={[...suppliers, { id: OTHER, label: t("Not in the list") }]} />
        {vendorId === OTHER ? <TextInput label={t("Who delivered")} isRequired maxLength={160} value={supplierName} onChange={setSupplierName} /> : null}
        <SelectField label={t("Arrived at")} isRequired selectedKey={place} onSelectionChange={(key) => setPlace(key === null ? null : String(key))} items={places} />
        <DateField label={t("Received on")} isRequired value={parseDate(receivedOn)} onChange={(value) => value && setReceivedOn(value.toString())} />
        <TextInput label={t("Delivery note")} maxLength={120} value={note} onChange={setNote} />
        <TextInput label={t("Handed over by")} maxLength={160} value={handedOverBy} onChange={setHandedOverBy} />
      </FormSection>
      <FormSection title={t("What arrived")}>
        <ul className={styles.draftLines} aria-label={t("What arrived")}>{lines.map((line, index) => <li key={index}>
          <TextInput label={<VisuallyHidden>{t("What arrived, line {number}", { number: index + 1 })}</VisuallyHidden>} maxLength={240} placeholder={t("What arrived")} value={line.description} onChange={(description) => setLine(index, { description })} />
          <TextInput label={<VisuallyHidden>{t("Quantity, line {number}", { number: index + 1 })}</VisuallyHidden>} placeholder={t("Quantity")} inputMode="decimal" value={line.quantity} onChange={(value) => setLine(index, { quantity: numeric(value) })} />
          <TextInput label={<VisuallyHidden>{t("Unit, line {number}", { number: index + 1 })}</VisuallyHidden>} maxLength={20} placeholder={t("Unit")} value={line.unit} onChange={(unit) => setLine(index, { unit })} />
          {lines.length > 1 ? <IconButton aria-label={t("Remove line {number}", { number: index + 1 })} size="compact" variant="quiet" onPress={() => setLines(lines.filter((_, item) => item !== index))}>
            <X aria-hidden="true" size={14} /></IconButton> : <span />}
        </li>)}</ul>
        <div><Button size="compact" variant="quiet" onPress={() => setLines([...lines, { description: "", quantity: "", unit: "" }])}><Plus aria-hidden="true" size={14} />{t("Add line")}</Button></div>
      </FormSection>
      <FormSection title={t("Photos")}>
        <PhotoPicker files={photos} onChange={setPhotos} />
      </FormSection>
  </FormDialog>;
}

/** Goods that came without an order: what, from whom, where, photos — matched to an order by a buyer, or sent back. */
export function UnmatchedSheet({ api, deliveryId, onChanged, onClose, onOpenReceipt }: {
  api: PurchasingApi; deliveryId: string; onChanged: () => void; onClose: () => void; onOpenReceipt: (receiptId: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<UnmatchedState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"match" | "return" | null>(null);
  const [adding, setAdding] = useState<File[]>([]);
  const load = useCallback(async () => {
    try { setState(await api.unmatched(deliveryId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The delivery didn't load.")); }
  }, [api, deliveryId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const resolve = async (input: Record<string, unknown>) => {
    setNotice("");
    setState(await api.resolveUnmatched(deliveryId, input)); onChanged();
  };
  const addPhotos = async (files: File[]) => {
    setAdding(files);
    try { let next: UnmatchedState | null = null; for (const file of files) next = await api.uploadPhoto({ kind: "unmatched", id: deliveryId }, crypto.randomUUID(), file); if (next) setState(next); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The photo could not be uploaded.")); }
    setAdding([]);
  };
  const delivery = state?.delivery;
  const open = delivery?.status === "open";
  return <InspectorSheet isOpen size="lg" title={delivery ? t("Without an order {number}", { number: delivery.number }) : t("Without an order")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={open && state ? <div className="wd-dialog-actions">
      <Button variant="quiet" onPress={() => setDialog("return")}>{t("Sent back")}</Button><span className={styles.spacer} />
      {state.canBuy ? <Button variant="primary" isDisabled={!state.candidates.length} onPress={() => setDialog("match")}>{t("Match to an order")}</Button> : null}
    </div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !delivery ? <Skeleton lines={6} shape="facts" /> : <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {delivery.status === "matched" && delivery.receiptId ? <InlineNotice tone="success" message={t("Matched by {name}; now delivery {number}.", { name: delivery.resolvedByName ?? "", number: delivery.receiptNumber ?? "" })} /> : null}
      {delivery.status === "returned" ? <InlineNotice tone="info" message={t("Sent back: {reason}", { reason: delivery.resolutionNote })} /> : null}
      {open && state.canBuy && !state.candidates.length ? <InlineNotice tone="info" message={t("No open order from this supplier is still waiting for goods.")} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("From")}</dt><dd>{delivery.supplierName}</dd></div>
        <div><dt>{t("Arrived at")}</dt><dd>{delivery.locationName}</dd></div>
        <div><dt>{t("Received")}</dt><dd>{[format.day(delivery.receivedOn), delivery.receivedByName].join(" · ")}</dd></div>
        {delivery.deliveryNote ? <div><dt>{t("Delivery note")}</dt><dd>{delivery.deliveryNote}</dd></div> : null}
        {delivery.handedOverBy ? <div><dt>{t("Handed over by")}</dt><dd>{delivery.handedOverBy}</dd></div> : null}
      </dl>
      <ul className={styles.receipts} aria-label={t("What arrived")}>{state.lines.map((line) => <li key={line.id}>
        <span className={styles.nameCell}><span>{line.description}</span></span><span className={styles.money}>{`${quantityText(line.quantity)} ${line.unit}`.trim()}</span>
      </li>)}</ul>
      {delivery.status === "matched" && delivery.receiptId ? <Button size="compact" variant="quiet" onPress={() => onOpenReceipt(delivery.receiptId!)}>{t("Delivery {number}", { number: delivery.receiptNumber ?? "" })}</Button> : null}
      <section className={styles.part} aria-label={t("Photos")}>
        <SavedPhotos photos={state.photos} url={api.photoUrl} />
        {open && state.canReceive ? <PhotoPicker files={adding} onChange={(files) => void addPhotos(files)} /> : null}
      </section>
    </div>}
    {dialog === "return" ? <SendBackDialog onClose={() => setDialog(null)} onSave={async (note) => { await resolve({ action: "return", note }); setDialog(null); }} /> : null}
    {dialog === "match" && state ? <MatchDialog state={state} onClose={() => setDialog(null)} onSave={async (input) => { await resolve({ action: "match", ...input }); setDialog(null); }} /> : null}
  </InspectorSheet>;
}

function SendBackDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={t("Sent back")} onClose={onClose} cancelLabel={t("Back")} isDirty={Boolean(note.trim())} isSubmitDisabled={!note.trim()} submitLabel={t("Save")} onSubmit={() => onSave(note.trim())}>
    <TextAreaField label={t("Why the goods went back")} isRequired value={note} onChange={setNote} />
  </FormDialog>;
}

/** Which order these goods belong to, and which of its lines each one is. */
function MatchDialog({ state, onClose, onSave }: { state: UnmatchedState; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [orderId, setOrderId] = useState<string | null>(state.candidates.length === 1 ? state.candidates[0].id : null);
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [note, setNote] = useState("");
  const order = state.candidates.find((candidate) => candidate.id === orderId);
  const complete = Boolean(order) && state.lines.every((line) => picks[line.id]);
  return <FormDialog size="lg" title={t("Match to an order")} onClose={onClose} isSubmitDisabled={!complete} submitLabel={t("Match")}
    onSubmit={() => onSave({ orderId, note: note.trim(), lines: state.lines.map((line) => ({ unmatchedLineId: line.id, orderLineId: picks[line.id] })) })}>
      <SelectField label={t("Order")} isRequired selectedKey={orderId} onSelectionChange={(key) => { setOrderId(key === null ? null : String(key)); setPicks({}); }}
        items={state.candidates.map((candidate) => ({ id: candidate.id, label: `${candidate.number} · ${candidate.supplierName}` }))} />
      {order ? state.lines.map((line) => <SelectField key={line.id} label={t("{item} is", { item: `${line.description} (${quantityText(line.quantity)} ${line.unit})`.trim() })} isRequired
        selectedKey={picks[line.id] ?? null} onSelectionChange={(key) => setPicks({ ...picks, [line.id]: key === null ? null : String(key) })}
        items={order.lines.map((item) => ({ id: item.id, label: [item.description, item.projectReference, t("{quantity} to come", { quantity: `${quantityText(item.outstanding)} ${item.unit}`.trim() })].filter(Boolean).join(" · ") }))} />) : null}
      <TextInput label={t("Note")} maxLength={500} value={note} onChange={setNote} />
  </FormDialog>;
}
