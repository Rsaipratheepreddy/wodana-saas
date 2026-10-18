"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge, Button, DataGrid, EditableFieldList, EmptyState, ErrorState, FactRow, NoAccessState, InlineNotice, InspectorSheet, NoResultsState, Skeleton, TextAreaField, TextInput, DateField, ToggleButton,
  type DataGridColumn, FormDialog, MoneyField, NumericInput, PercentageInput, VisuallyHidden,
} from "@/design-system";
import { parseDate } from "@internationalized/date";
import { useT } from "@/lib/i18n/i18n-provider";
import { isDenied, type PurchasingApi } from "@/lib/purchasing/client";
import type { PriceRequestRow, PriceRequestState, PriceRequestsState, PriceRequestStatus } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { fieldNumber, fieldText, quantityText } from "./order-labels";
import styles from "./purchasing.module.css";


type RequestLine = PriceRequestState["lines"][number];
/** A row of the comparison: one line against each supplier, or the totals under them. */
type CompareRow = { id: string; line: RequestLine | null };

function useRequestLabels() {
  const t = useT();
  return useMemo(() => ({ open: t("Waiting for prices"), awarded: t("Awarded"), cancelled: t("Cancelled") } satisfies Record<PriceRequestStatus, string>), [t]);
}

/** An open request whose suppliers have all answered is ready to award, not still "waiting for prices". */
function useRequestState() {
  const t = useT();
  const labels = useRequestLabels();
  return useCallback((status: PriceRequestStatus, answered: number, asked: number) => status === "open" && asked > 0 && answered >= asked
    ? { label: t("Ready to award"), tone: "info" as const }
    : { label: labels[status], tone: status === "open" ? "warning" as const : status === "awarded" ? "success" as const : "neutral" as const }, [labels, t]);
}

/** Price requests: what was asked, of how many suppliers, and how many replied. A row opens the comparison. */
export function PriceRequests({ api, openId, onOpen, onOrder, refreshKey }: { api: PurchasingApi; openId: string | null; onOpen: (id: string | null) => void; onOrder: (orderId: string) => void; refreshKey: number }) {
  const t = useT();
  const requestState = useRequestState();
  const format = useProjectFormat();
  const [state, setState] = useState<PriceRequestsState | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.priceRequests()); setError(""); } catch (cause) { setDenied(isDenied(cause)); setError(cause instanceof Error ? cause.message : t("The price requests didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);
  const rows = (state?.requests ?? []).filter((row) => !search.trim() || `${row.number} ${row.projects.join(" ")}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const columns: DataGridColumn<PriceRequestRow>[] = [
    { id: "number", header: t("Price request"), accessorFn: (row) => String(row.number), size: 160, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{t("Price request {number}", { number: row.number })}</span><small>{row.lines === 1 ? t("1 line") : t("{count} lines", { count: row.lines })}</small></span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => requestState(row.status, row.replied, row.suppliers).label, size: 160, meta: { renderCell: (row) => { const shown = requestState(row.status, row.replied, row.suppliers); return <Badge tone={shown.tone}>{shown.label}</Badge>; } } },
    { id: "replies", header: t("Replies"), accessorFn: (row) => row.replied, size: 120, meta: { renderCell: (row) => t("{replied} of {count}", { replied: row.replied, count: row.suppliers }) } },
    { id: "projects", header: t("For"), accessorFn: (row) => row.projects.join(", "), size: 160, meta: { mobileHidden: true } },
    { id: "needed", header: t("Needed by"), accessorFn: (row) => row.neededBy ?? "", size: 130, meta: { mobileHidden: true, renderCell: (row) => format.day(row.neededBy) } },
    { id: "by", header: t("Asked by"), accessorFn: (row) => row.createdByName, size: 140, meta: { mobileHidden: true } },
  ];
  if (error && !state) return denied ? <NoAccessState /> : <ErrorState description={error} onRetry={() => void load()} />;
  return <>
    <DataGrid<PriceRequestRow> ariaLabel={t("Price requests")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search price requests")} rowNumbers={false} selectable={false} wrapText
      emptyContent={search.trim() ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No price requests")} description={t("Ask suppliers for prices from what projects need to order.")} />} />
    {openId ? <PriceRequestSheet api={api} requestId={openId} onChanged={() => void load()} onClose={() => onOpen(null)} onOrder={onOrder} /> : null}
  </>;
}

/**
 * One price request: its lines against each supplier asked, the cheapest per line marked (after
 * discounts), each supplier's reply recorded as it comes, then each line awarded — with the reason
 * when it isn't the cheapest — into one draft order per supplier.
 */
function PriceRequestSheet({ api, requestId, onChanged, onClose, onOrder }: { api: PurchasingApi; requestId: string; onChanged: () => void; onClose: () => void; onOrder: (orderId: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const requestState = useRequestState();
  const [state, setState] = useState<PriceRequestState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [replying, setReplying] = useState<string | null>(null);
  const [award, setAward] = useState<Record<string, { vendorId: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  // Each line starts awarded to its cheapest supplier; a choice already made stays.
  const accept = useCallback((next: PriceRequestState) => {
    setState(next);
    setAward((current) => Object.fromEntries(next.lines.map((line) => [line.id, current[line.id]?.vendorId ? current[line.id] : { vendorId: next.cheapest[line.id] ?? "", reason: "" }])));
  }, []);
  const load = useCallback(async () => {
    try { accept(await api.priceRequest(requestId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The price request didn't load.")); }
  }, [api, requestId, accept, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const run = async (action: string, input: Record<string, unknown> = {}, inDialog = false) => {
    if (!state) return null;
    setNotice(""); setBusy(true);
    try { const next = await api.priceRequestCommand(requestId, state.request.version, action, input); accept(next); onChanged(); return next; }
    catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      if (inDialog) throw cause;
      setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return null;
    }
    finally { setBusy(false); }
  };
  const open = state?.request.status === "open" && state.canBuy;
  const quote = (lineId: string, vendorId: string) => state?.quotes.find((item) => item.lineId === lineId && item.vendorId === vendorId);
  const complete = state ? state.lines.every((line) => award[line.id]?.vendorId && (award[line.id].vendorId === state.cheapest[line.id] || award[line.id].reason.trim())) : false;
  const compareRows: CompareRow[] = state ? [...state.lines.map((line) => ({ id: line.id, line })), { id: "__total", line: null }] : [];
  const compareColumns: DataGridColumn<CompareRow>[] = !state ? [] : [
    { id: "item", header: t("Item"), size: 220, enableSorting: false, accessorFn: (row) => row.line?.description ?? "", meta: { renderCell: (row) => row.line
      ? <span className={styles.nameCell}><span>{row.line.description}</span><small>{[`${quantityText(row.line.quantity)} ${row.line.unit}`, row.line.projectReference].filter(Boolean).join(" · ")}</small></span>
      : <strong>{t("Total")}</strong> } },
    ...state.suppliers.map((supplier): DataGridColumn<CompareRow> => ({ id: `supplier-${supplier.vendorId}`, size: 190, enableSorting: false,
      header: () => <span className={styles.nameCell}><strong>{supplier.name}</strong>
        <small>{supplier.status === "replied" ? [supplier.leadTimeDays !== null ? t("{count} days", { count: supplier.leadTimeDays }) : "", supplier.validUntil ? t("valid to {date}", { date: format.day(supplier.validUntil) }) : ""].filter(Boolean).join(" · ") || t("Replied")
          : supplier.status === "declined" ? t("Declined") : t("Waiting")}</small>
        {open ? <span><Button size="compact" variant="quiet" onPress={() => setReplying(supplier.vendorId)}>{supplier.status === "replied" ? t("Change reply") : t("Record reply")}</Button></span> : null}</span>,
      meta: { interactive: true, renderCell: (row) => {
        if (!row.line) return <span className={styles.money}>{state.totals[supplier.vendorId]?.priced ? format.money(state.totals[supplier.vendorId].net, state.request.currency) : "—"}</span>;
        const line = row.line;
        const price = quote(line.id, supplier.vendorId);
        if (!price) return <span className={styles.muted}>—</span>;
        const cheapest = state.cheapest[line.id] === supplier.vendorId;
        const chosen = (state.request.status === "open" ? award[line.id]?.vendorId : line.awardedVendorId) === supplier.vendorId;
        return <span className={styles.nameCell}>
          <span><ToggleButton size="compact" variant={chosen ? "primary" : "secondary"} isSelected={chosen} isDisabled={!open}
            aria-label={t("Award {item} to {supplier}", { item: line.description, supplier: supplier.name })}
            onPress={() => setAward({ ...award, [line.id]: { vendorId: supplier.vendorId, reason: award[line.id]?.reason ?? "" } })}>
            {format.money(price.net, state.request.currency)}{cheapest ? ` · ${t("Cheapest")}` : ""}</ToggleButton></span>
          <small>{Number(price.discountPercent) ? t("{price} less {percent}%", { price: format.money(price.unitPrice, state.request.currency), percent: quantityText(price.discountPercent) })
            : format.money(price.unitPrice, state.request.currency)}</small>
        </span>;
      } } })),
  ];

  return <InspectorSheet isOpen size="lg" title={state ? t("Price request {number}", { number: state.request.number }) : t("Price request")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={open ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={!complete} onPress={async () => {
        const next = await run("award", { awards: Object.entries(award).map(([lineId, item]) => ({ lineId, vendorId: item.vendorId, reason: item.reason.trim() })) });
        if (next?.orders[0]) onOrder(next.orders[0].id);
      }}>{t("Award and create orders")}</Button></div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state ? <Skeleton lines={8} shape="rows" /> : <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {state.orders.length ? <InlineNotice tone="success" message={t("Orders: {orders}", { orders: state.orders.map((order) => order.number).join(", ") })} /> : null}
      <EditableFieldList>
        <FactRow label={t("Status")}>{(() => { const shown = requestState(state.request.status, state.suppliers.filter((item) => item.status !== "asked").length, state.suppliers.length); return <Badge tone={shown.tone}>{shown.label}</Badge>; })()}</FactRow>
        {state.request.companyName ? <FactRow label={t("Buying company")}>{state.request.companyName}</FactRow> : null}
        {state.request.neededBy ? <FactRow label={t("Needed by")}>{format.day(state.request.neededBy)}</FactRow> : null}
      </EditableFieldList>
      <DataGrid ariaLabel={t("Prices")} data={compareRows} getRowId={(row) => row.id} columns={compareColumns}
        showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} wrapText />
      {open ? state.lines.filter((line) => award[line.id]?.vendorId && award[line.id].vendorId !== state.cheapest[line.id]).map((line) =>
        <TextInput key={line.id} label={t("Why {item} isn't going to the cheapest", { item: line.description })} isRequired value={award[line.id].reason}
          onChange={(reason) => setAward({ ...award, [line.id]: { ...award[line.id], reason } })} />) : null}
      {state.request.status === "awarded" && state.lines.some((line) => line.awardReason) ? <EditableFieldList>
        {state.lines.filter((line) => line.awardReason).map((line) => <FactRow key={line.id} label={line.description}>{line.awardReason}</FactRow>)}
      </EditableFieldList> : null}
    </div>}
    {replying && state ? <ReplyDialog state={state} vendorId={replying} onClose={() => setReplying(null)}
      onDecline={async (note) => { if (await run("decline", { vendorId: replying, note })) setReplying(null); }}
      onSave={async (input) => { await run("record_reply", { vendorId: replying, ...input }, true); setReplying(null); }} /> : null}
  </InspectorSheet>;
}

/** A supplier's reply: a price (and discount) per line, how long delivery takes, and how long the prices hold. */
function ReplyDialog({ state, vendorId, onClose, onSave, onDecline }: {
  state: PriceRequestState; vendorId: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>; onDecline: (note: string) => Promise<void>;
}) {
  const t = useT();
  const supplier = state.suppliers.find((item) => item.vendorId === vendorId)!;
  const [prices, setPrices] = useState<Record<string, { unitPrice: string; discountPercent: string }>>(() => Object.fromEntries(state.lines.map((line) => {
    const quote = state.quotes.find((item) => item.lineId === line.id && item.vendorId === vendorId);
    return [line.id, { unitPrice: quote ? quantityText(quote.unitPrice) : "", discountPercent: quote && Number(quote.discountPercent) ? quantityText(quote.discountPercent) : "" }];
  })));
  const [lead, setLead] = useState(supplier.leadTimeDays !== null ? String(supplier.leadTimeDays) : "");
  const [valid, setValid] = useState<string | null>(supplier.validUntil);
  const [note, setNote] = useState(supplier.note);
  const [declining, setDeclining] = useState(false);
  const any = Object.values(prices).some((item) => Number(item.unitPrice) > 0);
  const setPrice = (lineId: string, patch: Partial<{ unitPrice: string; discountPercent: string }>) => setPrices((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }));
  const columns: DataGridColumn<RequestLine>[] = [
    { id: "item", header: t("Item"), size: 220, accessorFn: (line) => line.description, meta: { renderCell: (line) => <span className={styles.nameCell}><span>{line.description}</span>
      <small>{`${quantityText(line.quantity)} ${line.unit}`}</small></span> } },
    { id: "price", header: t("Price"), size: 160, accessorFn: (line) => prices[line.id].unitPrice, meta: { align: "end", renderCell: (line) =>
      <MoneyField label={<VisuallyHidden>{t("Price for {item}", { item: line.description })}</VisuallyHidden>} placeholder={t("Price")} currency={state.request.currency} value={prices[line.id].unitPrice}
        onChange={(unitPrice) => setPrice(line.id, { unitPrice })} /> } },
    { id: "discount", header: t("Discount %"), size: 120, accessorFn: (line) => prices[line.id].discountPercent, meta: { align: "end", renderCell: (line) =>
      <PercentageInput label={<VisuallyHidden>{t("Discount for {item}", { item: line.description })}</VisuallyHidden>} formatOptions={{ maximumFractionDigits: 2 }}
        value={fieldNumber(prices[line.id].discountPercent)} onChange={(value) => setPrice(line.id, { discountPercent: fieldText(value) })} /> } },
  ];
  return <FormDialog size="lg" title={supplier.name} onClose={onClose} isSubmitDisabled={!any} submitLabel={t("Save")} isDirty={any && !state.quotes.some((item) => item.vendorId === vendorId)}
    onSubmit={() => onSave({ prices: Object.entries(prices).map(([lineId, item]) => ({ lineId, unitPrice: item.unitPrice || null, discountPercent: item.discountPercent || null })), leadTimeDays: lead || null, validUntil: valid, note: note.trim() })}
    secondaryAction={<Button variant="quiet" isLoading={declining} onPress={async () => { setDeclining(true); try { await onDecline(note.trim()); } finally { setDeclining(false); } }}>{t("They declined")}</Button>}>
      <DataGrid ariaLabel={t("Prices")} data={state.lines} getRowId={(line) => line.id} columns={columns}
        showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} wrapText />
      <NumericInput label={t("Delivery in days")} minValue={0} maxValue={9999} formatOptions={{ maximumFractionDigits: 0 }} value={lead === "" ? Number.NaN : Number(lead)}
        onChange={(value) => setLead(Number.isFinite(value) ? String(Math.round(value)) : "")} />
      <DateField label={t("Prices valid until")} value={valid ? parseDate(valid) : null} onChange={(value) => setValid(value ? value.toString() : null)} />
      <TextAreaField label={t("Note")} value={note} onChange={setNote} />
  </FormDialog>;
}
