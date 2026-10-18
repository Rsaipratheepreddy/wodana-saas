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
import { parseDate } from "@internationalized/date";
import { Button, Checkbox, ComboboxField, DataGrid, ControlledModalDialog, DateField, EmptyState, IconButton, InlineNotice, MoneyField, PercentageInput, SegmentedControl, SelectField, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import type { Quote, QuoteLine, ChangeRequest } from "@/lib/commercial/types";
import { money, newLine, quoteCurrencyChoices, quoteTotals } from "@/lib/commercial/client";
import { catalogPriceInput, usesCatalogPricing } from "@/lib/commercial/catalog-price";
import { QuotationCatalogPrice } from "./quotation-catalog-price";
import s from "./commercial.module.css";
import colors from "../crm/crm-workspace-colors.module.css";
/** The quotation's validity date as a calendar day, or nothing when it is blank or not a date. */
function calendarDay(value: string) {
  try { return value ? parseDate(value) : null; } catch { return null; }
}

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
  const { locale, currency: workspaceCurrency } = useDesignSystem();
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
        <QuotationNumberInput
          label={t("Rate for {title}", { title: l.title })}
          value={l.rate}
          money
          prefix={quote.currency}
          onChange={(rate) => line(l.id, { rate })}
        />
      )}
    </div>
  );
  return (
    <>
      <div className={`${s.toolbar} ${q.itemToolbar}`}>
        <div className={s.actions}>
          <SelectField
            aria-label={t("Filter quotation by room")}
            label={<span className="wd-visually-hidden">{t("Filter quotation by room")}</span>}
            items={[{ id: "All rooms", label: t("All rooms") }, ...rooms.map((r) => ({ id: r, label: r }))]}
            selectedKey={room}
            onSelectionChange={(key) => key !== null && setRoom(String(key))}
          />
          <span className={s.muted}>
            {t(costing ? "{count} items · Internal costing" : "{count} items", { count: quote.lines.length })}
          </span>
        </div>
        {!readOnly && (
          <div className={s.actions}>
            <Button
              size="compact"
              intent="write"
              onPress={() => {
                setNewRoom("");
                setRoomSource(null);
                setEditingRoom(null);
              }}
            >
              <Plus aria-hidden="true" size={14} />
              {t("Add room")}</Button>
            <Button
              size="compact"
              intent="write"
              onPress={() => {
                const next = newLine(
                  room === "All rooms" ? (rooms.at(-1) ?? t("General")) : room,
                );
                openItem(next);
              }}
            >
              <Plus aria-hidden="true" size={14} />
              {t("Add item")}</Button>
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
                              <IconButton
                                size="compact"
                                intent="write"
                                aria-label={t("Edit room {room}", { room: r })}
                                onPress={() => {
                                  setEditingRoom(r);
                                  setNewRoom(r);
                                  setRoomSource(
                                    quote.rooms?.find((x) => x.name === r)
                                      ?.catalog?.snapshot ?? null,
                                  );
                                }}
                              >
                                <Pencil aria-hidden="true" size={12} />
                              </IconButton>
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
                              <Button
                                size="compact"
                                intent="write"
                                aria-label={t("Add item to {room}", { room: r })}
                                onPress={() => openItem(newLine(r))}
                              >
                                <Plus aria-hidden="true" size={14} />{t("Add item")}</Button>
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
                            {readOnly ? <strong>{l.title}</strong> : <Button className={q.itemTitle} size="compact" variant="quiet" aria-label={t("Edit details for {title}", { title: l.title })} onPress={() => openItem(l)}><strong>{l.title}</strong><Pencil aria-hidden="true" size={12} /></Button>}
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
                                {!costing && <Button size="compact" variant="quiet" aria-label={t("Change unit for {title}", { title: l.title })} onPress={() => openItem(l)}>{l.unit}<Pencil aria-hidden="true" size={12} /></Button>}
                              </>}
                            </div>
                          </>}},
...(costing?[{id:"unit",header:t("Unit"),size:110,accessorFn:(l:QuoteLine)=>l.unit,meta:{renderCell:(l:QuoteLine)=><>{readOnly ? l.unit : <Button size="compact" variant="quiet" aria-label={t("Change unit for {title}", { title: l.title })} onPress={() => openItem(l)}>{l.unit}<Pencil aria-hidden="true" size={12} /></Button>}</>}}]:[]),
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
                                <IconButton
                                  size="compact"
                                  intent="write"
                                  aria-label={t("Duplicate {title}", { title: l.title })}
                                  onPress={() =>
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
                                  <Copy aria-hidden="true" size={14} />
                                </IconButton>
                                <IconButton
                                  size="compact"
                                  intent="write"
                                  aria-label={t("Remove {title}", { title: l.title })}
                                  onPress={() =>
                                    patch({
                                      lines: quote.lines.filter(
                                        (x) => x.id !== l.id,
                                      ),
                                    })
                                  }
                                >
                                  <Trash2 aria-hidden="true" size={14} />
                                </IconButton>
                              </div>
                            </>}}]:[])]}/></section>)}</div>
      )}
      {!itemsOnly && (
        <>
          <div className={s.bottom}>
            <div className={`${colors.theme} ${s.form}`}>
              <TextInput
                label={t("Quotation title")}
                value={quote.title}
                isDisabled={readOnly}
                onChange={(title) => patch({ title })}
              />
              <div className={s.grid}>
                <DateField
                  label={t("Valid until")}
                  value={calendarDay(quote.validUntil)}
                  isDisabled={readOnly}
                  onChange={(day) => patch({ validUntil: day ? day.toString() : "" })}
                />
                <SelectField
                  label={t("Currency")}
                  items={quoteCurrencyChoices(workspaceCurrency).map((c) => ({ id: c, label: c }))}
                  selectedKey={quote.currency}
                  isDisabled={readOnly}
                  onSelectionChange={(key) => key !== null && patch({ currency: String(key) })}
                />
              </div>
              <section>
                <h3>{t("Terms, exclusions & linked requests")}</h3>
                <div className={`${colors.theme} ${s.form}`}>
                  <TextAreaField
                    label={t("Terms & payment expectations")}
                    value={quote.terms}
                    isDisabled={readOnly}
                    onChange={(terms) => patch({ terms })}
                  />
                  <TextAreaField
                    label={t("Exclusions")}
                    value={quote.exclusions}
                    isDisabled={readOnly}
                    onChange={(exclusions) => patch({ exclusions })}
                  />
                  {requests
                    .filter(
                      (r) =>
                        !["resolved", "declined", "withdrawn"].includes(
                          r.status,
                        ) || quote.requestIds.includes(r.id),
                    )
                    .map((r) => (
                      <Checkbox key={r.id}
                        isDisabled={readOnly}
                        isSelected={quote.requestIds.includes(r.id)}
                        onChange={(addresses) =>
                          patch({
                            requestIds: addresses
                              ? [...quote.requestIds, r.id]
                              : quote.requestIds.filter((id) => id !== r.id),
                          })
                        }
                      >
                        {t("Addresses CR-{number} · {title}", { number: String(r.number).padStart(3, "0"), title: r.title })}
                      </Checkbox>
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
                    <MoneyField
                      aria-label={t("Quotation discount")}
                      label={<span className="wd-visually-hidden">{t("Quotation discount")}</span>}
                      currency={quote.currency}
                      min="0"
                      value={String(quote.discount)}
                      onChange={(amount) => patch({ discount: Number(amount) })}
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
                    <PercentageInput
                      aria-label={t("Tax percentage")}
                      label={<span className="wd-visually-hidden">{t("Tax percentage")}</span>}
                      formatOptions={{ maximumFractionDigits: 2 }}
                      value={quote.taxRate}
                      onChange={(taxRate) => patch({ taxRate: Number.isFinite(taxRate) ? taxRate : 0 })}
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
                    <dd>{totals.margin === null ? t("Cost missing") : `${totals.margin.toFixed(1)}%`}</dd>
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
          <TextInput
            label={t("Room name")}
            autoFocus
            isRequired
            maxLength={120}
            placeholder={t("e.g. Master bedroom")}
            value={newRoom ?? ""}
            onChange={setNewRoom}
          />
          <p className={s.muted}>
            {t("Choose your room catalog, then name this space. For repeat rooms, use names like Bedroom 1 and Bedroom 2.")}</p>
          {rooms.some(
            (r) =>
              r !== editingRoom &&
              r.toLowerCase() === newRoom?.trim().toLowerCase(),
          ) && (
            <InlineNotice tone="error" message={t("A room with this name already exists.")} />
          )}
          <Button
            type="submit"
            variant="primary"
            isDisabled={
              !newRoom?.trim() ||
              rooms.some(
                (r) =>
                  r !== editingRoom &&
                  r.toLowerCase() === newRoom.trim().toLowerCase(),
              )
            }
          >
            {t(editingRoom ? "Save room" : "Add room")}
          </Button>
          {editingRoom && !quote.lines.some((l) => l.room === editingRoom) && (
            <Button
              intent="write"
              onPress={() => {
                patch({
                  rooms: quote.rooms?.filter((r) => r.name !== editingRoom),
                });
                setRoom("All rooms");
                setNewRoom(null);
              }}
            >
              {t("Remove empty room")}</Button>
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
                <Button
                  intent="write"
                  onPress={() => {
                    patch({
                      lines: quote.lines.filter((l) => l.id !== item.id),
                    });
                    setItem(null);
                  }}
                >
                  <Trash2 aria-hidden="true" size={14} />
                  {t("Remove item")}</Button>
                <Button
                  intent="write"
                  onPress={() => {
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
                  <Copy aria-hidden="true" size={14} />
                  {t("Duplicate")}</Button>
              </>
            )}
            <Button onPress={() => setItem(null)}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              isDisabled={
                !item?.title.trim() ||
                !item.room.trim() ||
                !item.unit.trim() ||
                item.quantity <= 0 || !Number.isFinite(item.quantity) || item.quantity > 1e6 || item.rate < 0 || (item.unitCost ?? 0) < 0 || !Number.isFinite(item.rate) || !Number.isFinite(item.unitCost) || item.rate > 1e8 || (item.unitCost ?? 0) > 1e8 || (item.catalogLinks?.length ?? 0) > 12
              }
              onPress={() => {
                if (item) {
                  if (quote.lines.some((l) => l.id === item.id))
                    line(item.id, item);
                  else patch({ lines: [...quote.lines, item] });
                  setItem(null);
                }
              }}
            >
              {t("Apply to quotation")}</Button>
          </div>
        }
      >
        {item && (
          <div className={`${colors.theme} ${s.form} ${q.itemDialog}`}>
            <p className={s.itemContext}><strong>{item.title}</strong><span>{item.room}</span></p>
            <SegmentedControl
              label={t("Item editor")}
              value={itemMode}
              onChange={(mode) => setItemMode(mode as "details" | "materials")}
              options={[{ id: "materials", label: t("Materials & finishes") }, { id: "details", label: t("Item & pricing") }]}
            />
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
            {itemMode === "details" && <Checkbox isSelected={roomFilter} onChange={setRoomFilter}>
              {t("Show items linked to this room and variants linked to the selected item")}</Checkbox>}
            <p className={s.muted}>
              {t("Catalog selections keep their source links. Quantities and selling rates are set for this quotation.")}</p>
            {itemMode === "details" && <><div className={s.grid}>
              <ComboboxField
                label={t("Room")}
                allowsCustomValue
                items={rooms.map((r) => ({ id: r, label: r }))}
                inputValue={item.room}
                onInputChange={(room) => setItem({ ...item, room })}
                placeholder=""
              />
              <TextInput
                label={t("Item")}
                value={item.title}
                onChange={(title) => setItem({ ...item, title })}
              />
            </div>
            <TextAreaField
              label={t("Specification")}
              placeholder={t("Dimensions, construction and what is included…")}
              value={item.specification}
              onChange={(specification) => setItem({ ...item, specification })}
            />
            </>}
            {itemMode === "details" && <div className={s.grid}>
              <QuotationNumberInput showLabel label={t("Quantity")} value={item.quantity} min={0.0001} max={1e6} onChange={(quantity) => setItem({ ...item, quantity })} />
              <TextInput
                label={t("Unit")}
                value={item.unit}
                onChange={(unit) => setItem(customUnit(item, unit))}
              />
              {costing ? readOnly || !canEditCosts ? <div className="wd-field"><span className="wd-field-label">{t("Internal unit cost")}</span><span>{money(item.unitCost ?? 0, quote.currency, locale)}</span></div>
                : <QuotationNumberInput showLabel label={t("Internal unit cost")} value={item.unitCost ?? 0} min={0} max={1e8} money prefix={quote.currency} onChange={(unitCost) => setItem({ ...item, unitCost })} /> : null}
              <QuotationNumberInput showLabel label={t("Selling rate")} value={item.rate} min={0} max={1e8} money prefix={quote.currency} onChange={(rate) => setItem({ ...item, rate })} />
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
