"use client";
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
import { DataGrid, ControlledModalDialog, EmptyState } from "@/design-system";
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
        money(l.rate, quote.currency)
      ) : (
        <div className={q.moneyControl}><span>{quote.currency}</span><QuotationNumberInput
          label={`Rate for ${l.title}`}
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
            aria-label="Filter quotation by room"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          >
            <option>All rooms</option>
            {rooms.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <span className={s.muted}>
            {quote.lines.length} items{costing ? " · Internal costing" : ""}
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
              Add room
            </button>
            <button
              className={s.button}
              onClick={() => {
                const next = newLine(
                  room === "All rooms" ? (rooms.at(-1) ?? "General") : room,
                );
                openItem(next);
              }}
            >
              <Plus size={15} />
              Add item
            </button>
          </div>
        )}
      </div>
      {!rooms.length ? (
        <EmptyState title="Build your quotation, one item at a time" description="Import the included scope from the brief, or add an item." />
      ) : (
        <div className={s.form}>{rooms.filter(r=>room==="All rooms"||room===r).map(r=><section key={r}><div className={`${s.roomHeading} ${q.roomHeader}`}>
                          <span>
                            <strong>{r}</strong>
                            {!readOnly && (
                              <button
                                className={s.icon}
                                aria-label={`Edit room ${r}`}
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
                              {quote.lines.filter((l) => l.room === r).length}{" "}
                              {quote.lines.filter((l) => l.room === r)
                                .length === 1
                                ? "item"
                                : "items"}
                            </small>
                          </span>
                          <div>
                            {!readOnly && (
                              <button
                                className={s.button}
                                aria-label={`Add item to ${r}`}
                                onClick={() => openItem(newLine(r))}
                              >
                                <Plus size={13} /> Add item
                              </button>
                            )}
                            <strong>
                              {money(
                                quote.lines
                                  .filter((l) => l.room === r)
                                  .reduce((n, l) => n + l.quantity * l.rate, 0),
                                quote.currency,
                              )}
                            </strong>
                          </div>
                        </div><DataGrid ariaLabel={`Quotation items · ${r}`} data={quote.lines.filter(l=>l.room===r)} getRowId={l=>l.id} selectable={false} searchLabel={`Search items in ${r}`} exportFileName="quotation-items.csv" columns={[{id:"title",header:"Item",size:290,accessorFn:(l:QuoteLine)=>l.title,meta:{renderCell:(l:QuoteLine)=><>
                            {readOnly ? <strong>{l.title}</strong> : <button className={q.itemTitle} aria-label={`Edit details for ${l.title}`} onClick={() => openItem(l)}><strong>{l.title}</strong><Pencil size={12} /></button>}
                            {l.specification && (
                              <small
                                className={s.detail}
                                style={{ whiteSpace: "pre-wrap" }}
                              >
                                {l.specification}
                              </small>
                            )}
                          </>}},
{id:"materials",header:"Materials & finishes",size:270,accessorFn:(l:QuoteLine)=>l.material,meta:{renderCell:(l:QuoteLine)=><><QuotationMaterialsSummary line={l} onEdit={readOnly ? undefined : () => openItem(l, "materials")} /></>}},
{id:"rate",header:"Unit price",size:160,accessorFn:(l:QuoteLine)=>l.rate,meta:{renderCell:rateCell}},
{id:"quantity",header:"Quantity / unit",size:150,accessorFn:(l:QuoteLine)=>l.quantity,meta:{renderCell:(l:QuoteLine)=><>
                            <div className={q.quantityControl}>
                              {readOnly ? <span>{l.quantity} {!costing && l.unit}</span> : <>
                                <QuotationNumberInput label={`Quantity for ${l.title}`} value={l.quantity} min={0.0001} max={1e6} onChange={(quantity) => line(l.id, { quantity })} />
                                {!costing && <button className={q.unitButton} aria-label={`Change unit for ${l.title}`} title="Change unit in item details" onClick={() => openItem(l)}>{l.unit}<Pencil size={10} /></button>}
                              </>}
                            </div>
                          </>}},
...(costing?[{id:"unit",header:"Unit",size:110,accessorFn:(l:QuoteLine)=>l.unit,meta:{renderCell:(l:QuoteLine)=><>{readOnly ? l.unit : <button className={q.unitButton} aria-label={`Change unit for ${l.title}`} onClick={() => openItem(l)}>{l.unit}<Pencil size={10} /></button>}</>}}]:[]),
...(costing?[{id:"cost",header:"Unit cost",size:150,accessorFn:(l:QuoteLine)=>l.unitCost,meta:{renderCell:(l:QuoteLine)=><>
                              {readOnly || !canEditCosts ? (
                                money(l.unitCost ?? 0, quote.currency)
                              ) : (
                                <QuotationNumberInput label={`Cost for ${l.title}`} value={l.unitCost ?? 0} money onChange={(unitCost) => line(l.id, { unitCost })} />
                              )}
                            </>}}]:[]),
{id:"total",header:"Amount",size:160,accessorFn:(l:QuoteLine)=>l.quantity*l.rate,meta:{renderCell:(l:QuoteLine)=><>
                            {money(l.quantity * l.rate, quote.currency)}
                          </>}},
...(!readOnly && costing?[{id:"action",header:"Action",size:110,enableSorting:false,enableColumnFilter:false,meta:{renderCell:(l:QuoteLine)=><>
                              <div className={s.rowAction}>
                                <button
                                  className={s.icon}
                                  aria-label={`Duplicate ${l.title}`}
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
                                  aria-label={`Remove ${l.title}`}
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
                Quotation title
                <input
                  value={quote.title}
                  disabled={readOnly}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
              <div className={s.grid}>
                <label>
                  Valid until
                  <input
                    type="date"
                    value={quote.validUntil}
                    disabled={readOnly}
                    onChange={(e) => patch({ validUntil: e.target.value })}
                  />
                </label>
                <label>
                  Currency
                  <select
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
                <h3>Terms, exclusions & linked requests</h3>
                <div className={`${colors.theme} ${s.form}`}>
                  <label>
                    Terms & payment expectations
                    <textarea
                      value={quote.terms}
                      disabled={readOnly}
                      onChange={(e) => patch({ terms: e.target.value })}
                    />
                  </label>
                  <label>
                    Exclusions
                    <textarea
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
                        Addresses CR-{String(r.number).padStart(3, "0")} ·{" "}
                        {r.title}
                      </label>
                    ))}
                </div>
              </section>
            </div>
            <dl className={s.summary}>
              <div>
                <dt>Subtotal</dt>
                <dd>{money(totals.subtotal, quote.currency)}</dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>
                  {readOnly ? (
                    money(quote.discount, quote.currency)
                  ) : (
                    <input
                      aria-label="Quotation discount"
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
                <dt>Tax {readOnly ? `(${quote.taxRate}%)` : "%"}</dt>
                <dd>
                  {readOnly ? (
                    money(totals.tax, quote.currency)
                  ) : (
                    <input
                      aria-label="Tax percentage"
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
                <dt>Total</dt>
                <dd>{money(totals.total, quote.currency)}</dd>
              </div>
              {costing && (
                <>
                  <div>
                    <dt>Estimated cost</dt>
                    <dd>{money(totals.cost, quote.currency)}</dd>
                  </div>
                  <div>
                    <dt>Gross margin</dt>
                    <dd>{totals.margin.toFixed(1)}%</dd>
                  </div>
                  <p className={s.muted}>
                    Costs and margin are visible to your team only.
                  </p>
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
        title={editingRoom ? "Edit room" : "Add room"}
      >
        <form
          className={`${colors.theme} ${s.form}`}
          onSubmit={(e) => {
            e.preventDefault();
            const name = newRoom?.trim() || roomSource?.name || "General";
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
            label="Room type from catalog"
            value={roomSource}
            onChange={(value) => {
              setRoomSource(value);
              if (value) setNewRoom(value.name);
            }}
          />
          <label>
            Room name
            <input
              autoFocus
              required
              maxLength={120}
              placeholder="e.g. Master bedroom"
              value={newRoom ?? ""}
              onChange={(e) => setNewRoom(e.target.value)}
            />
          </label>
          <p className={s.muted}>
            Choose your room catalog, then name this space. For repeat rooms,
            use names like Bedroom 1 and Bedroom 2.
          </p>
          {rooms.some(
            (r) =>
              r !== editingRoom &&
              r.toLowerCase() === newRoom?.trim().toLowerCase(),
          ) && (
            <p role="alert" className={s.error}>
              A room with this name already exists.
            </p>
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
            {editingRoom ? "Save room" : "Add room"}
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
              Remove empty room
            </button>
          )}
        </form>
      </ControlledModalDialog>
      <ControlledModalDialog
        isOpen={Boolean(item)}
        onOpenChange={(open) => !open && setItem(null)}
        title={itemMode === "materials" ? "Materials & finishes" : "Item details"}
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
                  Remove item
                </button>
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
                  Duplicate
                </button>
              </>
            )}
            <button className={s.button} onClick={() => setItem(null)}>Cancel</button>
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
              Apply to quotation
            </button>
          </div>
        }
      >
        {item && (
          <div className={`${colors.theme} ${s.form} ${q.itemDialog}`}>
            <p className={s.itemContext}><strong>{item.title}</strong><span>{item.room}</span></p>
            <div className={s.editorTabs} role="group" aria-label="Item editor">
              <button aria-pressed={itemMode === "materials"} onClick={() => setItemMode("materials")}>Materials & finishes</button>
              <button aria-pressed={itemMode === "details"} onClick={() => setItemMode("details")}>Item & pricing</button>
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
                    label={role === "work" ? "Item from catalog" : role === "variant" ? "Variant from catalog" : "Unit from catalog"}
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
              Show items linked to this room and variants linked to the selected
              item
            </label>}
            <p className={s.muted}>
              Catalog selections keep their source links. Quantities and selling rates are set for this quotation.
            </p>
            {itemMode === "details" && <><div className={s.grid}>
              <label>
                Room
                <input
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
                Item
                <input
                  value={item.title}
                  onChange={(e) => setItem({ ...item, title: e.target.value })}
                />
              </label>
            </div>
            <label>
              Specification
              <textarea
                placeholder="Dimensions, construction and what is included…"
                value={item.specification}
                onChange={(e) =>
                  setItem({ ...item, specification: e.target.value })
                }
              />
            </label>
            </>}
            {itemMode === "details" && <div className={s.grid}>
              <label>
                Quantity
                <QuotationNumberInput label="Quantity" value={item.quantity} min={0.0001} max={1e6}  onChange={(quantity) => setItem({ ...item, quantity })} />
              </label>
              <label>
                Unit
                <input
                  value={item.unit}
                  onChange={(e) => setItem(customUnit(item, e.target.value))}
                />
              </label>
              {costing ? <label>
                Internal unit cost
                {readOnly || !canEditCosts ? <span>{money(item.unitCost ?? 0, quote.currency)}</span> : <QuotationNumberInput label="Internal unit cost" value={item.unitCost ?? 0} min={0} max={1e8} money onChange={(unitCost) => setItem({ ...item, unitCost })} />}
              </label> : null}
              <label>
                Selling rate
                <QuotationNumberInput label="Selling rate" value={item.rate} min={0} max={1e8} money onChange={(rate) => setItem({ ...item, rate })} />
              </label>
            </div>
            }
            </>}
            {item.scopeId && (
              <p className={s.muted}>
                Linked to Requirement gathering scope v{item.scopeVersion}. These
                commercial edits preserve the source record.
              </p>
            )}
          </div>
        )}
      </ControlledModalDialog>
    </>
  );
}
