"use client";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  Copy,
  ImagePlus,
  Layers3,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  Quote,
  QuoteLine,
  QuotationMaterialRow,
} from "@/lib/commercial/types";
import {
  money,
  newLine,
  quoteTotals,
  roundMoney,
} from "@/lib/commercial/client";
import {
  catalogItem,
  roomNames,
  selection,
  selectVariant,
} from "@/lib/commercial/room-builder";
import {
  quotationLineVariant,
  quotationDescription,
} from "@/lib/commercial/presentation";
import {
  quotationMaterialRows,
  pricedLine,
  quotationPhoto,
} from "@/lib/commercial/quotation-table";
import {
  Button,
  ControlledModalDialog,
  SelectField,
  TextInput,
} from "@/design-system";
import {
  CommercialCatalogPicker,
  type CommercialCatalogChoice,
} from "./catalog-picker";
import { QuotationNumberInput } from "./quotation-number-input";
import { QuotationUnitPicker } from "./quotation-unit-picker";
import { PaymentScheduleEditor } from "./payment-schedule-editor";
import { QuotationMaterialBreakdown } from "./quotation-material-breakdown";
import s from "./quotation-sheet.module.css";

import { QuotationTextCell as Cell } from "./quotation-text-cell";

type Props = {
  quote: Quote;
  onChange: (quote: Quote) => void;
  readOnly: boolean;
  workspaceId: string;
  caseId: string;
  search?: string;
};
export function QuotationSheet({
  quote,
  onChange,
  readOnly,
  workspaceId,
  caseId,
  search = "",
}: Props) {
  const [materialDraft, setMaterialDraft] = useState<QuoteLine | null>(null);
  const [roomDraft, setRoomDraft] = useState<{
    original: string | null;
    name: string;
    catalog: CommercialCatalogChoice | null;
  } | null>(null);
  const [picker, setPicker] = useState<{
    kind: "work" | "variant" | "material" | "finish";
    room: string;
    lineId?: string;
  } | null>(null);
  const [error, setError] = useState(""),
    [uploading, setUploading] = useState<string | null>(null);
  const [variantDraft, setVariantDraft] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(
    () => new Set(),
  );
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const latest = useRef(quote);
  const startingLine = useRef<QuoteLine | null>(null);
  const editTarget = useRef({ readOnly, onChange });
  useLayoutEffect(() => {
    latest.current = quote;
    editTarget.current = { readOnly, onChange };
  }, [quote, readOnly, onChange]);
  const rooms = roomNames(quote),
    totals = quoteTotals(quote);
  const patchLine = (id: string, patch: Partial<QuoteLine>) => {
    if (editTarget.current.readOnly) return;
    const current = latest.current,
      next = current.lines.map((line) =>
        line.id === id ? pricedLine({ ...line, ...patch }) : line,
      );
    if (next.some((line) => line.rate > 1e8)) {
      setError(
        "The calculated item rate cannot exceed 100,000,000. Reduce the material amounts.",
      );
      return;
    }
    editTarget.current.onChange({ ...current, lines: next });
  };
  const changeMaterials = (patch: Partial<QuoteLine>) => {
    if (readOnly) return;
    setMaterialDraft((current) => {
      if (!current) return current;
      const next = pricedLine({ ...current, ...patch });
      if (next.rate > 1e8) {
        setError("The calculated item rate cannot exceed 100,000,000.");
        return current;
      }
      setError("");
      return next;
    });
  };
  const rowsChange = (_line: QuoteLine, rows: QuotationMaterialRow[]) =>
    changeMaterials({ materialRows: rows });
  const addRow = (line: QuoteLine) => {
    rowsChange(line, [
      ...quotationMaterialRows(line),
      {
        id: crypto.randomUUID(),
        name: "New material",
        type: "material",
        specification: "",
        quantity: 1,
        unit: "nos",
        rate: 0,
        suppliedByClient: false,
      },
    ]);
  };
  const addItem = (room: string) => {
    const line = newLine(room);
    setCollapsedRooms((current) => {
      const next = new Set(current);
      next.delete(room);
      return next;
    });
    setFocusLineId(line.id);
    onChange({ ...quote, lines: [...quote.lines, line] });
  };
  const choose = (record: CommercialCatalogChoice | null) => {
    if (!record || !picker) return;
    const line =
      materialDraft?.id === picker.lineId &&
      ["material", "finish"].includes(picker.kind)
        ? materialDraft
        : quote.lines.find((line) => line.id === picker.lineId);
    if (picker.kind === "work")
      onChange({
        ...quote,
        lines: [...quote.lines, catalogItem(picker.room, record)],
      });
    else if (line && picker.kind === "variant")
      patchLine(line.id, {
        ...selectVariant(line, record),
        materialRows: line.materialRows ?? quotationMaterialRows(line),
        variant: undefined,
      });
    else if (line) {
      const unit = record.links?.find((link) => link.role === "unit")?.snapshot;
      rowsChange(line, [
        ...quotationMaterialRows(line),
        {
          id: crypto.randomUUID(),
          name: record.name,
          type: picker.kind === "finish" ? "finish" : "material",
          specification: (record.description ?? "").slice(0, 3000),
          quantity: 1,
          unit: String(
            unit?.configuration?.symbol ?? unit?.code ?? "nos",
          ).slice(0, 20),
          rate: 0,
          suppliedByClient: false,
        },
      ]);
    }
    setPicker(null);
  };
  const move = (room: string, offset: number) => {
    const order = [...rooms],
      index = order.indexOf(room);
    [order[index], order[index + offset]] = [
      order[index + offset],
      order[index],
    ];
    onChange({
      ...quote,
      rooms: order.map(
        (name) =>
          quote.rooms?.find((room) => room.name === name) ?? {
            id: crypto.randomUUID(),
            name,
          },
      ),
    });
  };
  const visible = rooms.filter((room) =>
    `${room} ${quote.lines
      .filter((l) => l.room === room)
      .map((l) =>
        [
          l.title,
          quotationLineVariant(l),
          quotationDescription(l),
          ...quotationMaterialRows(l).map((m) => m.name),
        ].join(" "),
      )
      .join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className={s.sheet}>
      <div className={s.toolbar}>
        <span>
          Build by area · Edit every outlined field · Totals update
          automatically
        </span>
        {!readOnly && quote.direction !== "deduction" && (
          <button
            className={s.addArea}
            onClick={() => {
              setError("");
              setRoomDraft({ original: null, name: "", catalog: null });
            }}
            disabled={rooms.length >= 100}
            aria-label="Add room / section"
          >
            <Plus size={15} />
            Add area
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </p>
      )}
      {!visible.length && (
        <p className={s.empty}>
          {search
            ? "No matching rooms, items or materials."
            : "Add a room or section to start your quotation."}
        </p>
      )}
      <div
        className={s.scroll}
        tabIndex={0}
        role="region"
        aria-label="Editable quotation table"
      >
        <table className={s.table}>
          <colgroup>
            <col style={{ width: "6%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "3%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Photo</th>
              <th scope="col">Item</th>
              <th scope="col">Description</th>
              <th scope="col">Materials</th>
              <th scope="col">Variant</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th className={s.amount}>Rate · {quote.currency}</th>
              <th className={s.amount}>Amount · {quote.currency}</th>
              <th>
                <span className={s.sr}>Actions</span>
              </th>
            </tr>
          </thead>
          {visible.map((room) => {
            const index = rooms.indexOf(room),
              lines = quote.lines.filter((l) => l.room === room),
              expanded = Boolean(search.trim()) || !collapsedRooms.has(room),
              areaTotal = roundMoney(
                lines.reduce(
                  (sum, line) => sum + roundMoney(line.quantity * line.rate),
                  0,
                ),
              );
            return (
              <tbody key={room} data-expanded={expanded || undefined}>
                <tr className={s.room}>
                  <th colSpan={10}>
                    <div className={s.roomBar}>
                      <button
                        className={s.roomToggle}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${room}`}
                        aria-expanded={expanded}
                        onClick={() =>
                          setCollapsedRooms((current) => {
                            const next = new Set(current);
                            if (next.has(room)) next.delete(room);
                            else next.add(room);
                            return next;
                          })
                        }
                      >
                        {expanded ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                        <span className={s.roomIndex}>
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <strong>{room}</strong>
                      </button>
                      <span className={s.roomMeta}>
                        {lines.length} {lines.length === 1 ? "item" : "items"}
                      </span>
                      <strong className={s.roomAmount}>
                        {money(areaTotal, quote.currency)}
                      </strong>
                      {!readOnly && quote.direction !== "deduction" && (
                        <div className={s.areaAddActions}>
                          <button
                            className={s.addItemPrimary}
                            disabled={quote.lines.length >= 300}
                            onClick={() => addItem(room)}
                            aria-label={`Add item to ${room}`}
                          >
                            <Plus size={14} />
                            Add item
                          </button>
                          <button
                            className={s.catalogAction}
                            disabled={quote.lines.length >= 300}
                            onClick={() => setPicker({ kind: "work", room })}
                            aria-label={`Select item for ${room}`}
                          >
                            From library
                          </button>
                        </div>
                      )}
                      {!readOnly && (
                        <div className={s.areaActions}>
                          <button
                            aria-label={`Rename ${room}`}
                            title="Edit area"
                            onClick={() => {
                              setError("");
                              setRoomDraft({
                                original: room,
                                name: room,
                                catalog:
                                  quote.rooms?.find((r) => r.name === room)
                                    ?.catalog?.snapshot ?? null,
                              });
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            aria-label={`Move ${room} up`}
                            title="Move area up"
                            disabled={index === 0}
                            onClick={() => move(room, -1)}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            aria-label={`Move ${room} down`}
                            title="Move area down"
                            disabled={index === rooms.length - 1}
                            onClick={() => move(room, 1)}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            aria-label={`Remove ${room}`}
                            title="Remove area"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Remove ${room} and its ${lines.length} items? You can undo this change.`,
                                )
                              )
                                return;
                              onChange({
                                ...quote,
                                rooms: quote.rooms?.filter(
                                  (r) => r.name !== room,
                                ),
                                lines: quote.lines.filter(
                                  (l) => l.room !== room,
                                ),
                              });
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </th>
                </tr>
                {expanded &&
                  lines.map((line, lineIndex) => {
                    const rows = quotationMaterialRows(line);
                    return (
                      <tr className={s.item} key={line.id}>
                        <td data-label="Photo">
                          <div className={s.photo}>
                            <span className={s.lineNumber}>
                              {index + 1}.{lineIndex + 1}
                            </span>
                            {line.photo && (
                              <a
                                href={line.photo}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`View photo for ${line.title}`}
                              >
                                <img src={line.photo} alt={line.title} />
                              </a>
                            )}
                            {!readOnly && (
                              <>
                                <label
                                  title={`Upload photo for ${line.title}`}
                                  className={s.upload}
                                >
                                  {uploading === line.id ? (
                                    "…"
                                  ) : (
                                    <ImagePlus size={16} />
                                  )}
                                  <input
                                    type="file"
                                    aria-label={`Upload photo for ${line.title}`}
                                    accept="image/png,image/jpeg,image/webp"
                                    disabled={uploading !== null}
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      e.target.value = "";
                                      if (!file) return;
                                      setUploading(line.id);
                                      setError("");
                                      try {
                                        const photo =
                                          await quotationPhoto(file);
                                        if (
                                          latest.current.lines.reduce(
                                            (sum, l) =>
                                              sum +
                                              (l.id === line.id
                                                ? photo.length
                                                : (l.photo?.length ?? 0)),
                                            0,
                                          ) > 600000
                                        )
                                          throw new Error(
                                            "Photo limit reached. Remove a photo or upload smaller images.",
                                          );
                                        patchLine(line.id, { photo });
                                      } catch (e) {
                                        setError((e as Error).message);
                                      } finally {
                                        setUploading(null);
                                      }
                                    }}
                                  />
                                </label>
                                {line.photo && (
                                  <button
                                    aria-label={`Remove photo for ${line.title}`}
                                    onClick={() =>
                                      patchLine(line.id, { photo: "" })
                                    }
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                )}
                              </>
                            )}
                            {!line.photo && readOnly && "—"}
                          </div>
                        </td>
                        <td className={s.itemName} data-label="Item">
                          <Cell
                            label={`Item name ${line.id}`}
                            value={line.title}
                            required
                            readOnly={readOnly}
                            autoFocus={focusLineId === line.id}
                            onEditStart={() => {
                              if (focusLineId === line.id) setFocusLineId(null);
                            }}
                            onChange={(title) => patchLine(line.id, { title })}
                          />
                        </td>
                        <td
                          className={s.descriptionCell}
                          data-label="Description"
                        >
                          <p
                            aria-label={`Description for ${line.title}`}
                            title={quotationDescription(line)}
                          >
                            {quotationDescription(line) ||
                              "Add materials or item notes."}
                          </p>
                        </td>
                        <td data-label="Materials">
                          <Button
                            variant="quiet"
                            size="compact"
                            className={s.materialLink}
                            aria-label={`Materials for ${line.title}`}
                            aria-haspopup="dialog"
                            onPress={() => {
                              setError("");
                              setMaterialDraft({
                                ...structuredClone(line),
                                materialRows: quotationMaterialRows(line),
                              });
                            }}
                          >
                            <Layers3 size={14} />
                            <span>
                              {rows.length
                                ? `${rows.length}`
                                : readOnly
                                  ? "View"
                                  : "Add"}
                            </span>
                          </Button>
                        </td>
                        <td data-label="Variant">
                          {readOnly ? (
                            <span>{quotationLineVariant(line) || "—"}</span>
                          ) : (
                            <Button
                              variant="quiet"
                              size="compact"
                              className={s.variantButton}
                              aria-label={`Choose variant for ${line.title}`}
                              onPress={() => {
                                setVariantDraft(
                                  quotationLineVariant(line) || "",
                                );
                                setPicker({
                                  kind: "variant",
                                  room,
                                  lineId: line.id,
                                });
                              }}
                            >
                              <span>
                                {quotationLineVariant(line) || "Choose variant"}
                              </span>
                              <ChevronDown size={14} />
                            </Button>
                          )}
                        </td>
                        <td data-label="Quantity">
                          {readOnly ? (
                            line.quantity
                          ) : (
                            <QuotationNumberInput
                              label={`Quantity for ${line.title}`}
                              value={line.quantity}
                              min={0.0001}
                              max={1e6}
                              onChange={(quantity) =>
                                patchLine(line.id, { quantity })
                              }
                            />
                          )}
                        </td>
                        <td data-label="Unit">
                          <QuotationUnitPicker
                            label={`Unit for ${line.title}`}
                            value={line.unit}
                            workspaceId={workspaceId}
                            caseId={caseId}
                            readOnly={readOnly}
                            onEditStart={() => {
                              startingLine.current = line;
                            }}
                            onCancel={() => {
                              const previous = startingLine.current;
                              if (previous?.id === line.id)
                                patchLine(line.id, {
                                  unit: previous.unit,
                                  catalogLinks: previous.catalogLinks,
                                });
                            }}
                            onChange={(unit) =>
                              patchLine(line.id, {
                                unit,
                                catalogLinks: line.catalogLinks?.filter(
                                  (link) => link.role !== "unit",
                                ),
                              })
                            }
                          />
                        </td>
                        <td
                          className={s.amount}
                          data-label={`Rate · ${quote.currency}`}
                        >
                          {readOnly ? (
                            line.rate.toFixed(2)
                          ) : (
                            <QuotationNumberInput
                              label={`Rate for ${line.title}`}
                              value={line.rate}
                              money
                              onEditStart={() => {
                                startingLine.current = line;
                              }}
                              onCancel={() => {
                                const previous = startingLine.current;
                                if (previous?.id === line.id)
                                  patchLine(line.id, {
                                    rate: previous.rate,
                                    pricingMode: previous.pricingMode,
                                  });
                              }}
                              onChange={(rate) =>
                                rate !== line.rate &&
                                patchLine(line.id, {
                                  rate,
                                  pricingMode: "item",
                                })
                              }
                            />
                          )}
                        </td>
                        <td
                          className={s.amount}
                          data-label={`Amount · ${quote.currency}`}
                        >
                          <strong>
                            {roundMoney(
                              line.quantity * line.rate,
                            ).toLocaleString("en", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </strong>
                        </td>
                        <td data-label="Actions">
                          {!readOnly && (
                            <div className={s.actions}>
                              <button
                                aria-label={`Duplicate ${line.title}`}
                                disabled={quote.lines.length >= 300}
                                onClick={() =>
                                  onChange({
                                    ...quote,
                                    lines: [
                                      ...quote.lines,
                                      {
                                        ...structuredClone(line),
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
                                aria-label={`Remove item ${line.title}`}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Remove ${line.title}? You can undo this change.`,
                                    )
                                  )
                                    onChange({
                                      ...quote,
                                      lines: quote.lines.filter(
                                        (l) => l.id !== line.id,
                                      ),
                                    });
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                {expanded && !lines.length && (
                  <tr className={s.emptyArea}>
                    <td colSpan={10}>
                      <span>No items in this area yet.</span>
                      {!readOnly && quote.direction !== "deduction" && (
                        <button onClick={() => addItem(room)}>
                          <Plus size={14} /> Add the first item
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
      <section className={s.bottom} aria-label="Quotation pricing and terms">
        <div className={s.termsPanel}>
          <button
            className={s.sectionToggle}
            aria-expanded={termsOpen}
            onClick={() => setTermsOpen((open) => !open)}
          >
            <span>
              <strong>Scope & terms</strong>
              <small>Inclusions, exclusions and conditions</small>
            </span>
            {termsOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          </button>
          {termsOpen && (
            <div className={s.terms}>
              {(
                [
                  ["Included", "inclusions", 6000],
                  ["Not included", "exclusions", 6000],
                  ["Terms & conditions", "terms", 10000],
                ] as const
              ).map(([label, key, max]) => (
                <label key={key}>
                  {label}
                  <Cell
                    label={label}
                    value={quote[key] ?? ""}
                    max={max}
                    multiline
                    readOnly={readOnly}
                    onChange={(value) => onChange({ ...quote, [key]: value })}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
        <div className={s.summary}>
          <h3>Pricing summary</h3>
          <dl>
            <div>
              <dt>Items subtotal</dt>
              <dd>{money(totals.subtotal, quote.currency)}</dd>
            </div>
            <div>
              <dt>Discount · {quote.currency}</dt>
              <dd>
                {readOnly ? (
                  money(quote.discount, quote.currency)
                ) : (
                  <QuotationNumberInput
                    label="Quotation discount"
                    value={quote.discount}
                    money
                    max={totals.subtotal}
                    onChange={(discount) => onChange({ ...quote, discount })}
                  />
                )}
              </dd>
            </div>
            <div>
              <dt>Tax rate %</dt>
              <dd>
                {readOnly ? (
                  quote.taxRate
                ) : (
                  <QuotationNumberInput
                    label="Tax percentage"
                    value={quote.taxRate}
                    max={100}
                    onChange={(taxRate) => onChange({ ...quote, taxRate })}
                  />
                )}
              </dd>
            </div>
            <div>
              <dt>Taxable amount</dt>
              <dd>{money(totals.net, quote.currency)}</dd>
            </div>
            <div>
              <dt>{quote.cover?.taxLabel || "Tax"}</dt>
              <dd>{money(totals.tax, quote.currency)}</dd>
            </div>
            <div className={s.grand}>
              <dt>
                {quote.direction === "deduction"
                  ? "Client credit"
                  : "Quotation total"}
              </dt>
              <dd>{money(totals.total, quote.currency)}</dd>
            </div>
          </dl>
          {quote.discount > totals.subtotal && (
            <p role="alert" className={s.error}>
              Reduce the discount: it exceeds the current subtotal.
            </p>
          )}
          <p>
            Use another section for installation, delivery or other charges.
            These rows are included in the subtotal.
          </p>
        </div>
      </section>
      <section className={s.payments} aria-label="Payment schedule">
        <button
          className={s.sectionToggle}
          aria-expanded={paymentsOpen}
          onClick={() => setPaymentsOpen((open) => !open)}
        >
          <span>
            <strong>Payment schedule</strong>
            <small>
              {quote.paymentTerms.length
                ? `${quote.paymentTerms.length} milestones · ${quote.paymentTerms.reduce((sum, term) => sum + term.percent, 0)}% allocated`
                : "Add milestones for the agreement"}
            </small>
          </span>
          {paymentsOpen ? (
            <ChevronDown size={17} />
          ) : (
            <ChevronRight size={17} />
          )}
        </button>
        {paymentsOpen && (
          <div className={s.paymentEditor}>
            <PaymentScheduleEditor
              quote={quote}
              onChange={onChange}
              workspaceId={workspaceId}
              readOnly={readOnly}
            />
          </div>
        )}
      </section>
      <ControlledModalDialog
        title="Materials"
        description={
          materialDraft
            ? `${materialDraft.room} · ${materialDraft.title}`
            : undefined
        }
        size="xl"
        isOpen={Boolean(materialDraft)}
        onOpenChange={(open) => {
          if (!open) {
            setMaterialDraft(null);
            setError("");
          }
        }}
        footer={
          <div className="wd-dialog-actions">
            <Button
              onPress={() => {
                setMaterialDraft(null);
                setError("");
              }}
            >
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button
                variant="primary"
                isDisabled={Boolean(error)}
                onPress={() => {
                  if (!materialDraft) return;
                  patchLine(materialDraft.id, {
                    materialRows: materialDraft.materialRows,
                    pricingMode: materialDraft.pricingMode,
                    specification: materialDraft.specification,
                  });
                  setMaterialDraft(null);
                }}
              >
                Apply materials
              </Button>
            )}
          </div>
        }
      >
        {materialDraft && (
          <>
            <QuotationMaterialBreakdown
              line={materialDraft}
              rows={quotationMaterialRows(materialDraft)}
              currency={quote.currency}
              readOnly={readOnly}
              workspaceId={workspaceId}
              caseId={caseId}
              onChange={changeMaterials}
              onAdd={() => addRow(materialDraft)}
              onCatalog={() =>
                setPicker({
                  kind: "material",
                  room: materialDraft.room,
                  lineId: materialDraft.id,
                })
              }
            />
            {error && (
              <p role="alert" className={s.error}>
                {error}
              </p>
            )}
          </>
        )}
      </ControlledModalDialog>
      <ControlledModalDialog
        title={
          roomDraft?.original ? "Rename room / section" : "Add room / section"
        }
        isOpen={Boolean(roomDraft)}
        onOpenChange={(open) => {
          if (!open) setRoomDraft(null);
        }}
        footer={
          roomDraft && (
            <div className={s.dialogActions}>
              <button onClick={() => setRoomDraft(null)}>Cancel</button>
              <button
                aria-label="Save section"
                onClick={() => {
                  const name = roomDraft.name.trim();
                  if (
                    !name ||
                    rooms.some(
                      (room) =>
                        room !== roomDraft.original &&
                        room.toLowerCase() === name.toLowerCase(),
                    )
                  ) {
                    setError("Enter a unique room or section name.");
                    return;
                  }
                  const old = quote.rooms?.find(
                      (r) => r.name === roomDraft.original,
                    ),
                    nextRoom = {
                      id: old?.id ?? crypto.randomUUID(),
                      name,
                      ...(roomDraft.catalog
                        ? { catalog: selection("room", roomDraft.catalog) }
                        : {}),
                    };
                  onChange({
                    ...quote,
                    rooms: roomDraft.original
                      ? rooms.map((room) =>
                          room === roomDraft.original
                            ? nextRoom
                            : (quote.rooms?.find((r) => r.name === room) ?? {
                                id: crypto.randomUUID(),
                                name: room,
                              }),
                        )
                      : [
                          ...(quote.rooms ??
                            rooms.map((name) => ({
                              id: crypto.randomUUID(),
                              name,
                            }))),
                          nextRoom,
                        ],
                    lines: quote.lines.map((line) =>
                      line.room === roomDraft.original
                        ? { ...line, room: name }
                        : line,
                    ),
                  });
                  setRoomDraft(null);
                  setError("");
                }}
              >
                {roomDraft.original ? "Save area" : "Add area"}
              </button>
            </div>
          )
        }
      >
        {roomDraft && (
          <div className={s.dialog}>
            <TextInput
              label="Area / room name"
              maxLength={120}
              value={roomDraft.name}
              onChange={(name) =>
                setRoomDraft({
                  ...roomDraft,
                  name,
                  catalog: null,
                })
              }
              autoFocus
              placeholder="e.g. Kitchen, Reception, Delivery"
            />
            {!roomDraft.original && (
              <CommercialCatalogPicker
                workspaceId={workspaceId}
                caseId={caseId}
                kind="room"
                label="Or start from the area library (optional)"
                value={roomDraft.catalog}
                onChange={(catalog) =>
                  setRoomDraft({
                    ...roomDraft,
                    catalog,
                    name: catalog?.name ?? roomDraft.name,
                  })
                }
              />
            )}
            {error && (
              <p role="alert" className={s.error}>
                {error}
              </p>
            )}
          </div>
        )}
      </ControlledModalDialog>
      <ControlledModalDialog
        title={
          picker?.kind === "work"
            ? "Select item"
            : picker?.kind === "variant"
              ? "Select variant"
              : "Select material"
        }
        isOpen={Boolean(picker)}
        onOpenChange={(open) => {
          if (!open) setPicker(null);
        }}
      >
        {picker && (
          <div className={s.dialog}>
            {["material", "finish"].includes(picker.kind) && (
              <SelectField
                label="Type"
                accent="neutral"
                aria-label="Catalog material type"
                selectedKey={picker.kind}
                items={[
                  { id: "material", label: "Material" },
                  { id: "finish", label: "Finish" },
                ]}
                onSelectionChange={(key) =>
                  setPicker({
                    ...picker,
                    kind: key as "material" | "finish",
                  })
                }
              />
            )}
            {(picker.kind !== "variant" ||
              quote.lines
                .find((line) => line.id === picker.lineId)
                ?.catalogLinks?.some((link) => link.role === "work")) && (
              <CommercialCatalogPicker
                workspaceId={workspaceId}
                caseId={caseId}
                kind={picker.kind}
                label="Search catalog"
                value={null}
                onChange={choose}
                linkedTo={
                  picker.kind === "variant"
                    ? quote.lines
                        .find((l) => l.id === picker.lineId)
                        ?.catalogLinks?.find((c) => c.role === "work")?.recordId
                    : undefined
                }
              />
            )}
            {picker.kind === "variant" ? (
              <>
                <TextInput
                  label="Custom variant"
                  aria-label="Custom variant"
                  value={variantDraft}
                  maxLength={240}
                  placeholder="e.g. Premium finish"
                  onChange={setVariantDraft}
                />
                <p>
                  Choose a linked catalog variant or enter your own. Existing
                  materials and prices are kept; review them when changing the
                  variant.
                </p>
                <div className={s.dialogActions}>
                  <button onClick={() => setPicker(null)}>Cancel</button>
                  <button
                    onClick={() => {
                      const line = quote.lines.find(
                        (line) => line.id === picker.lineId,
                      );
                      if (line)
                        patchLine(line.id, {
                          variant: variantDraft.trim(),
                          catalogLinks: line.catalogLinks?.filter(
                            (link) => link.role !== "variant",
                          ),
                        });
                      setPicker(null);
                    }}
                  >
                    Apply variant
                  </button>
                </div>
              </>
            ) : (
              <p>
                Selected names and specifications can be edited in this
                quotation. Enter the agreed selling rate in {quote.currency};
                catalog reference prices are not applied automatically.
              </p>
            )}
          </div>
        )}
      </ControlledModalDialog>
    </div>
  );
}
