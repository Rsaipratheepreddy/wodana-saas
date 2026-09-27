"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useLayoutEffect, useRef, useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import {
  CommercialCatalogPicker,
  type CommercialCatalogChoice,
} from "./catalog-picker";
import { QuotationNumberInput } from "./quotation-number-input";
import { QuotationMaterialsEditor, QuotationMaterialsSummary } from "./quotation-materials";
import { customUnit, selectUnit } from "@/lib/commercial/materials";
import q from "./quotation-line-fields.module.css";
import { PaymentScheduleEditor } from "./payment-schedule-editor";
import { DataGrid, ControlledModalDialog, EmptyState, useDesignSystem } from "@/design-system";
import type { Quote, QuoteLine, ChangeRequest } from "@/lib/commercial/types";
import { money, newLine, quoteTotals } from "@/lib/commercial/client";
import { catalogPriceInput, usesCatalogPricing } from "@/lib/commercial/catalog-price";
import { QuotationCatalogPrice } from "./quotation-catalog-price";
import s from "./commercial.module.css";
import colors from "../crm/crm-workspace-colors.module.css";
export function QuotationEditor({
  quote,
  onChange,
  costing,
  readOnly,
  requests,
  workspaceId,
  caseId,
  itemsOnly = false,
  canOverridePrice = false,
  canEditCosts = false,
}: {
  workspaceId: string;
  caseId: string;
  quote: Quote;
  onChange: (q: Quote) => void;
  costing: boolean;
  itemsOnly?: boolean;
  readOnly: boolean;
  requests: ChangeRequest[];
  canOverridePrice?: boolean;
  canEditCosts?: boolean;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const latest = useRef(quote);
  useLayoutEffect(() => { latest.current = quote; }, [quote]);
  const [item, setItem] = useState<QuoteLine | null>(null),
    [itemMode, setItemMode] = useState<"details" | "materials">("details"),
    [room, setRoom] = useState("All rooms"),
    [newRoom, setNewRoom] = useState<string | null>(null),
    [roomSource, setRoomSource] = useState<CommercialCatalogChoice | null>(
      null,
    ),
    [roomFilter, setRoomFilter] = useState(true),
    [editingRoom, setEditingRoom] = useState<string | null>(null);
  const openItem = (value: QuoteLine, mode: "details" | "materials" = "details") => { setItemMode(mode); setItem(value); };
  const patch = (v: Partial<Quote>) => onChange({ ...quote, ...v });
  const line = (id: string, v: Partial<QuoteLine>) =>
    patch({
      lines: quote.lines.map((l) => (l.id === id ? { ...l, ...v } : l)),
    });
  const applyCatalogPrice = (basis: QuoteLine, currency: string, taxRate: number, update: Partial<QuoteLine>) => {
    const current = latest.current;
    const selected = current.lines.find((item) => item.id === basis.id);
    if (!selected || current.currency !== currency || current.taxRate !== taxRate ||
      JSON.stringify(catalogPriceInput(selected, currency, taxRate)) !== JSON.stringify(catalogPriceInput(basis, currency, taxRate))) return false;
    onChange({ ...current, lines: current.lines.map((item) => item.id === basis.id ? { ...item, ...update } : item) });
    return true;
  };
  const totals = quoteTotals(quote),
    rooms = [
      ...new Set([
        ...(quote.rooms ?? []).map((r) => r.name),
        ...quote.lines.map((l) => l.room),
      ]),
    ];
  const rateCell = (l: QuoteLine) => (
    <div className={s.rateCell}>
      {usesCatalogPricing(l) ? <QuotationCatalogPrice line={l} currency={quote.currency} taxRate={quote.taxRate} workspaceId={workspaceId} caseId={caseId} readOnly={readOnly} canOverride={canOverridePrice} onApply={applyCatalogPrice} /> : readOnly ? (
        money(l.rate, quote.currency, locale)
      ) : (
        <div className={q.moneyControl}><span>{quote.currency}</span><QuotationNumberInput
          label={t("Rate for {title}", { title: l.title })}
          value={l.rate}
          money
          onChange={(rate) => line(l.id, { rate })}
        /></div>
      )}
    </div>
  );
  return (
    <>
      <div className={`${s.toolbar} ${q.itemToolbar}`}>
        <div className={s.actions}>
          <select
            aria-label={t("Filter quotation by room")}
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          >
            <option value="All rooms">{t("All rooms")}</option>
            {rooms.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <span className={s.muted}>
            {t(costing ? "{count} items · Internal costing" : "{count} items", { count: quote.lines.length })}
          </span>
        </div>
        {!readOnly && (
          <div className={s.actions}>
            <button
              className={s.button}
              onClick={() => {
                setNewRoom("");
                setRoomSource(null);
                setEditingRoom(null);
              }}
            >
              <Plus size={15} />
              {t("Add room")}</button>
            <button
              className={s.button}
              onClick={() => {
                const next = newLine(
                  room === "All rooms" ? (rooms.at(-1) ?? t("General")) : room,
                );
                openItem(next);
              }}
            >
              <Plus size={15} />
              {t("Add item")}</button>
          </div>
        )}
      </div>
      {!rooms.length ? (
        <EmptyState title={t("Build your quotation, one item at a time")} description={t("Import the included scope from the brief, or add an item.")} />
      ) : (
        <div className={s.form}>{rooms.filter(r=>room==="All rooms"||room===r).map(r=><section key={r}><div className={`${s.roomHeading} ${q.roomHeader}`}>
                          <span>
                            <strong>{r}</strong>
                            {!readOnly && (
                              <button
                                className={s.icon}
                                aria-label={t("Edit room {room}", { room: r })}
                                onClick={() => {
                                  setEditingRoom(r);
                                  setNewRoom(r);
                                  setRoomSource(
                                    quote.rooms?.find((x) => x.name === r)
                                      ?.catalog?.snapshot ?? null,
                                  );
                                }}
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                            <small>
                              {t(quote.lines.filter((l) => l.room === r)
                                .length === 1
                                ? "{count} item"
                                : "{count} items", { count: quote.lines.filter((l) => l.room === r).length })}
                            </small>
                          </span>
                          <div>
                            {!readOnly && (
                              <button
                                className={s.button}
                                aria-label={t("Add item to {room}", { room: r })}
                                onClick={() => openItem(newLine(r))}
                              >
                                <Plus size={13} /> {t("Add item")}</button>
                            )}
                            <strong>
                              {money(
                                quote.lines
                                  .filter((l) => l.room === r)
                                  .reduce((n, l) => n + l.quantity * l.rate, 0),
                                quote.currency,
                                locale,
                              )}
                            </strong>
                          </div>
                        </div><DataGrid ariaLabel={t("Quotation items · {room}", { room: r })} data={quote.lines.filter(l=>l.room===r)} getRowId={l=>l.id} selectable={false} searchLabel={t("Search items in {room}", { room: r })} exportFileName="quotation-items.csv" columns={[{id:"title",header:t("Item"),size:290,accessorFn:(l:QuoteLine)=>l.title,meta:{renderCell:(l:QuoteLine)=><>
                            {readOnly ? <strong>{l.title}</strong> : <button className={q.itemTitle} aria-label={t("Edit details for {title}", { title: l.title })} onClick={() => openItem(l)}><strong>{l.title}</strong><Pencil size={12} /></button>}
                            {l.specification && (
                              <small
                                className={s.detail}
                                style={{ whiteSpace: "pre-wrap" }}
                              >
                                {l.specification}
                              </small>
                            )}
                          </>}},
{id:"materials",header:t("Materials & finishes"),size:270,accessorFn:(l:QuoteLine)=>l.material,meta:{renderCell:(l:QuoteLine)=><><QuotationMaterialsSummary line={l} onEdit={readOnly ? undefined : () => openItem(l, "materials")} /></>}},
{id:"rate",header:t("Unit price"),size:160,accessorFn:(l:QuoteLine)=>l.rate,meta:{renderCell:rateCell}},
{id:"quantity",header:t("Quantity / unit"),size:150,accessorFn:(l:QuoteLine)=>l.quantity,meta:{renderCell:(l:QuoteLine)=><>
                            <div className={q.quantityControl}>
                              {readOnly ? <span>{l.quantity} {!costing && l.unit}</span> : <>
                                <QuotationNumberInput label={t("Quantity for {title}", { title: l.title })} value={l.quantity} min={0.0001} max={1e6} onChange={(quantity) => line(l.id, { quantity })} />
                                {!costing && <button className={q.unitButton} aria-label={t("Change unit for {title}", { title: l.title })} title={t("Change unit in item details")} onClick={() => openItem(l)}>{l.unit}<Pencil size={10} /></button>}
                              </>}
                            </div>
                          </>}},
...(costing?[{id:"unit",header:t("Unit"),size:110,accessorFn:(l:QuoteLine)=>l.unit,meta:{renderCell:(l:QuoteLine)=><>{readOnly ? l.unit : <button className={q.unitButton} aria-label={t("Change unit for {title}", { title: l.title })} onClick={() => openItem(l)}>{l.unit}<Pencil size={10} /></button>}</>}}]:[]),
...(costing?[{id:"cost",header:t("Unit cost"),size:150,accessorFn:(l:QuoteLine)=>l.unitCost,meta:{renderCell:(l:QuoteLine)=><>
                              {readOnly || !canEditCosts ? (
                                money(l.unitCost ?? 0, quote.currency, locale)
                              ) : (
                                <QuotationNumberInput label={t("Cost for {title}", { title: l.title })} value={l.unitCost ?? 0} money onChange={(unitCost) => line(l.id, { unitCost })} />
                              )}
                            </>}}]:[]),
{id:"total",header:t("Amount"),size:160,accessorFn:(l:QuoteLine)=>l.quantity*l.rate,meta:{renderCell:(l:QuoteLine)=><>
                            {money(l.quantity * l.rate, quote.currency, locale)}
                          </>}},
...(!readOnly && costing?[{id:"action",header:t("Action"),size:110,enableSorting:false,enableColumnFilter:false,meta:{renderCell:(l:QuoteLine)=><>
                              <div className={s.rowAction}>
                                <button
                                  className={s.icon}
                                  aria-label={t("Duplicate {title}", { title: l.title })}
                                  onClick={() =>
                                    patch({
                                      lines: [
                                        ...quote.lines,
                                        {
                                          ...l,
                                          id: crypto.randomUUID(),
                                          scopeId: undefined,
                                          scopeVersion: undefined,
                                          specificationVersion: undefined,
                                        },
                                      ],
                                    })
                                  }
                                >
                                  <Copy size={14} />
                                </button>
                                <button
                                  className={s.icon}
                                  aria-label={t("Remove {title}", { title: l.title })}
                                  onClick={() =>
                                    patch({
                                      lines: quote.lines.filter(
                                        (x) => x.id !== l.id,
                                      ),
                                    })
                                  }
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </>}}]:[])]}/></section>)}</div>
      )}
      {!itemsOnly && (
        <>
          <div className={s.bottom}>
            <div className={`${colors.theme} ${s.form}`}>
              <label>
                {t("Quotation title")}<input
                  value={quote.title}
                  disabled={readOnly}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
              <div className={s.grid}>
                <label>
                  {t("Valid until")}<input
                    type="date"
                    value={quote.validUntil}
                    disabled={readOnly}
                    onChange={(e) => patch({ validUntil: e.target.value })}
                  />
                </label>
                <label>
                  {t("Currency")}<select
                    value={quote.currency}
                    disabled={readOnly}
                    onChange={(e) => patch({ currency: e.target.value })}
                  >
                    {["AED", "INR", "USD", "EUR", "GBP", "SAR", "QAR"].map(
                      (c) => (
                        <option key={c}>{c}</option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <section>
                <h3>{t("Terms, exclusions & linked requests")}</h3>
                <div className={`${colors.theme} ${s.form}`}>
                  <label>
                    {t("Terms & payment expectations")}
                    <textarea
                      value={quote.terms}
                      disabled={readOnly}
                      onChange={(e) => patch({ terms: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("Exclusions")}<textarea
                      value={quote.exclusions}
                      disabled={readOnly}
                      onChange={(e) => patch({ exclusions: e.target.value })}
                    />
                  </label>
                  {requests
                    .filter(
                      (r) =>
                        !["resolved", "declined", "withdrawn"].includes(
                          r.status,
                        ) || quote.requestIds.includes(r.id),
                    )
                    .map((r) => (
                      <label className={s.check} key={r.id}>
                        <input
                          type="checkbox"
                          disabled={readOnly}
                          checked={quote.requestIds.includes(r.id)}
                          onChange={(e) =>
                            patch({
                              requestIds: e.target.checked
                                ? [...quote.requestIds, r.id]
                                : quote.requestIds.filter((id) => id !== r.id),
                            })
                          }
                        />
                        {t("Addresses CR-{number} · {title}", { number: String(r.number).padStart(3, "0"), title: r.title })}
                      </label>
                    ))}
                </div>
              </section>
            </div>
            <dl className={s.summary}>
              <div>
                <dt>{t("Subtotal")}</dt>
                <dd>{money(totals.subtotal, quote.currency, locale)}</dd>
              </div>
              <div>
                <dt>{t("Discount")}</dt>
                <dd>
                  {readOnly ? (
                    money(quote.discount, quote.currency, locale)
                  ) : (
                    <input
                      aria-label={t("Quotation discount")}
                      type="number"
                      min={0}
                      step=".01"
                      value={quote.discount}
                      onChange={(e) =>
                        patch({ discount: Number(e.target.value) })
                      }
                    />
                  )}
                </dd>
              </div>
              <div>
                <dt>{t(readOnly ? "Tax ({rate}%)" : "Tax %", { rate: quote.taxRate })}</dt>
                <dd>
                  {readOnly ? (
                    money(totals.tax, quote.currency, locale)
                  ) : (
                    <input
                      aria-label={t("Tax percentage")}
                      type="number"
                      min={0}
                      max={100}
                      step=".01"
                      value={quote.taxRate}
                      onChange={(e) =>
                        patch({ taxRate: Number(e.target.value) })
                      }
                    />
                  )}
                </dd>
              </div>
              <div className={s.total}>
                <dt>{t("Total")}</dt>
                <dd>{money(totals.total, quote.currency, locale)}</dd>
              </div>
              {costing && (
                <>
                  <div>
                    <dt>{t("Estimated cost")}</dt>
                    <dd>{money(totals.cost, quote.currency, locale)}</dd>
                  </div>
                  <div>
                    <dt>{t("Gross margin")}</dt>
                    <dd>{totals.margin.toFixed(1)}%</dd>
                  </div>
                  <p className={s.muted}>
                    {t("Costs and margin are visible to your team only.")}</p>
                </>
              )}
            </dl>
          </div>
          <PaymentScheduleEditor
            quote={quote}
            onChange={onChange}
            workspaceId={workspaceId}
            readOnly={readOnly}
          />
        </>
      )}
      <ControlledModalDialog
        isOpen={newRoom !== null}
        onOpenChange={(open) => !open && setNewRoom(null)}
        title={t(editingRoom ? "Edit room" : "Add room")}
      >
        <form
          className={`${colors.theme} ${s.form}`}
          onSubmit={(e) => {
            e.preventDefault();
            const name = newRoom?.trim() || roomSource?.name || t("General");
            if (
              rooms.some(
                (r) =>
                  r !== editingRoom && r.toLowerCase() === name.toLowerCase(),
              )
            )
              return;
            const previous = quote.rooms?.find((r) => r.name === editingRoom);
            const next = {
              id: previous?.id ?? crypto.randomUUID(),
              name,
              ...(roomSource
                ? {
                    catalog: {
                      role: "room",
                      recordId: roomSource.id,
                      version: roomSource.version,
                      snapshot: roomSource,
                    },
                  }
                : {}),
            };
            patch({
              rooms: [
                ...(quote.rooms ?? []).filter((r) => r.name !== editingRoom),
                next,
              ],
              lines: quote.lines.map((l) =>
                editingRoom && l.room === editingRoom
                  ? { ...l, room: name }
                  : l,
              ),
            });
            setRoom(name);
            setNewRoom(null);
          }}
        >
          <CommercialCatalogPicker
            workspaceId={workspaceId}
            caseId={caseId}
            kind="room"
            label={t("Room type from catalog")}
            value={roomSource}
            onChange={(value) => {
              setRoomSource(value);
              if (value) setNewRoom(value.name);
            }}
          />
          <label>
            {t("Room name")}<input
              autoFocus
              required
              maxLength={120}
              placeholder={t("e.g. Master bedroom")}
              value={newRoom ?? ""}
              onChange={(e) => setNewRoom(e.target.value)}
            />
          </label>
          <p className={s.muted}>
            {t("Choose your room catalog, then name this space. For repeat rooms, use names like Bedroom 1 and Bedroom 2.")}</p>
          {rooms.some(
            (r) =>
              r !== editingRoom &&
              r.toLowerCase() === newRoom?.trim().toLowerCase(),
          ) && (
            <p role="alert" className={s.error}>
              {t("A room with this name already exists.")}</p>
          )}
          <button
            className={s.primary}
            disabled={
              !newRoom?.trim() ||
              rooms.some(
                (r) =>
                  r !== editingRoom &&
                  r.toLowerCase() === newRoom.trim().toLowerCase(),
              )
            }
          >
            {t(editingRoom ? "Save room" : "Add room")}
          </button>
          {editingRoom && !quote.lines.some((l) => l.room === editingRoom) && (
            <button
              type="button"
              className={s.button}
              onClick={() => {
                patch({
                  rooms: quote.rooms?.filter((r) => r.name !== editingRoom),
                });
                setRoom("All rooms");
                setNewRoom(null);
              }}
            >
              {t("Remove empty room")}</button>
          )}
        </form>
      </ControlledModalDialog>
      <ControlledModalDialog
        isOpen={Boolean(item)}
        onOpenChange={(open) => !open && setItem(null)}
        title={t(itemMode === "materials" ? "Materials & finishes" : "Item details")}
        size="lg"
        footer={
          <div className={s.actions}>
            {itemMode === "details" && item && quote.lines.some((l) => l.id === item.id) && (
              <>
                <button
                  className={s.button}
                  onClick={() => {
                    patch({
                      lines: quote.lines.filter((l) => l.id !== item.id),
                    });
                    setItem(null);
                  }}
                >
                  <Trash2 size={14} />
                  {t("Remove item")}</button>
                <button
                  className={s.button}
                  onClick={() => {
                    patch({
                      lines: [
                        ...quote.lines,
                        {
                          ...item,
                          id: crypto.randomUUID(),
                          scopeId: undefined,
                          scopeVersion: undefined,
                          specificationVersion: undefined,
                        },
                      ],
                    });
                    setItem(null);
                  }}
                >
                  <Copy size={14} />
                  {t("Duplicate")}</button>
              </>
            )}
            <button className={s.button} onClick={() => setItem(null)}>{t("Cancel")}</button>
            <button
              className={s.primary}
              disabled={
                !item?.title.trim() ||
                !item.room.trim() ||
                !item.unit.trim() ||
                item.quantity <= 0 || !Number.isFinite(item.quantity) || item.quantity > 1e6 || item.rate < 0 || (item.unitCost ?? 0) < 0 || !Number.isFinite(item.rate) || !Number.isFinite(item.unitCost) || item.rate > 1e8 || (item.unitCost ?? 0) > 1e8 || (item.catalogLinks?.length ?? 0) > 12
              }
              onClick={() => {
                if (item) {
                  if (quote.lines.some((l) => l.id === item.id))
                    line(item.id, item);
                  else patch({ lines: [...quote.lines, item] });
                  setItem(null);
                }
              }}
            >
              {t("Apply to quotation")}</button>
          </div>
        }
      >
        {item && (
          <div className={`${colors.theme} ${s.form} ${q.itemDialog}`}>
            <p className={s.itemContext}><strong>{item.title}</strong><span>{item.room}</span></p>
            <div className={s.editorTabs} role="group" aria-label={t("Item editor")}>
              <button aria-pressed={itemMode === "materials"} onClick={() => setItemMode("materials")}>{t("Materials & finishes")}</button>
              <button aria-pressed={itemMode === "details"} onClick={() => setItemMode("details")}>{t("Item & pricing")}</button>
            </div>
            {itemMode === "materials" ? <QuotationMaterialsEditor item={item} onChange={setItem} workspaceId={workspaceId} caseId={caseId} /> : <>
            <div className={s.grid}>
              {(["work", "variant", "unit"] as const).map(
                (role) => (
                  <CommercialCatalogPicker
                    key={role}
                    workspaceId={workspaceId}
                    caseId={caseId}
                    kind={role}
                    disabled={
                      role === "variant" &&
                      !item.catalogLinks?.some((c) => c.role === "work")
                    }
                    linkedTo={
                      roomFilter
                        ? role === "work"
                          ? quote.rooms?.find((r) => r.name === item.room)
                              ?.catalog?.recordId
                          : role === "variant"
                            ? item.catalogLinks?.find((c) => c.role === "work")
                                ?.recordId
                            : undefined
                        : undefined
                    }
                    label={t(role === "work" ? "Item from catalog" : role === "variant" ? "Variant from catalog" : "Unit from catalog")}
                    value={
                      item.catalogLinks?.find((c) => c.role === role)
                        ?.snapshot ?? null
                    }
                    onChange={(value) => {
                      const links = (item.catalogLinks ?? []).filter(
                        (c) =>
                          c.role !== role &&
                          !(role === "work" && c.role === "variant"),
                      );
                      if (value)
                        links.push({
                          role,
                          recordId: value.id,
                          version: value.version,
                          snapshot: value,
                        });
                      let next: QuoteLine = { ...item, catalogLinks: links };
                      if (role === "work" && value) {
                        next = { ...next, title: value.name, specification: value.description ?? item.specification };
                        const unit = value.links?.find((link) => link.role === "unit")?.snapshot;
                        if (unit) next = selectUnit(next, { role: "unit", recordId: unit.id, version: unit.version, snapshot: unit });
                      }
                      if (role === "unit") next = selectUnit(next, value ? { role, recordId: value.id, version: value.version, snapshot: value } : null);
                      setItem(next);
                    }}
                  />
                ),
              )}
            </div>
            {itemMode === "details" && <label className={s.check}>
              <input
                type="checkbox"
                checked={roomFilter}
                onChange={(e) => setRoomFilter(e.target.checked)}
              />{" "}
              {t("Show items linked to this room and variants linked to the selected item")}</label>}
            <p className={s.muted}>
              {t("Catalog selections keep their source links. Quantities and selling rates are set for this quotation.")}</p>
            {itemMode === "details" && <><div className={s.grid}>
              <label>
                {t("Room")}<input
                  list="quote-rooms"
                  value={item.room}
                  onChange={(e) => setItem({ ...item, room: e.target.value })}
                />
                <datalist id="quote-rooms">
                  {rooms.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </label>
              <label>
                {t("Item")}<input
                  value={item.title}
                  onChange={(e) => setItem({ ...item, title: e.target.value })}
                />
              </label>
            </div>
            <label>
              {t("Specification")}<textarea
                placeholder={t("Dimensions, construction and what is included…")}
                value={item.specification}
                onChange={(e) =>
                  setItem({ ...item, specification: e.target.value })
                }
              />
            </label>
            </>}
            {itemMode === "details" && <div className={s.grid}>
              <label>
                {t("Quantity")}<QuotationNumberInput label={t("Quantity")} value={item.quantity} min={0.0001} max={1e6}  onChange={(quantity) => setItem({ ...item, quantity })} />
              </label>
              <label>
                {t("Unit")}<input
                  value={item.unit}
                  onChange={(e) => setItem(customUnit(item, e.target.value))}
                />
              </label>
              {costing ? <label>
                {t("Internal unit cost")}{readOnly || !canEditCosts ? <span>{money(item.unitCost ?? 0, quote.currency, locale)}</span> : <QuotationNumberInput label={t("Internal unit cost")} value={item.unitCost ?? 0} min={0} max={1e8} money onChange={(unitCost) => setItem({ ...item, unitCost })} />}
              </label> : null}
              <label>
                {t("Selling rate")}<QuotationNumberInput label={t("Selling rate")} value={item.rate} min={0} max={1e8} money onChange={(rate) => setItem({ ...item, rate })} />
              </label>
            </div>
            }
            </>}
            {item.scopeId && (
              <p className={s.muted}>
                {t("Linked to Requirement gathering scope v{version}. These commercial edits preserve the source record.", { version: item.scopeVersion ?? "" })}</p>
            )}
          </div>
        )}
      </ControlledModalDialog>
    </>
  );
}
