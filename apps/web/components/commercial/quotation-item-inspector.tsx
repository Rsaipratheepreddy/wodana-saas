"use client";
import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import type { Quote, QuoteLine } from "@/lib/commercial/types";
import { money, roundMoney } from "@/lib/commercial/client";
import { customUnit, selectUnit } from "@/lib/commercial/materials";
import { CommercialCatalogPicker } from "./catalog-picker";
import { QuotationNumberInput } from "./quotation-number-input";
import { QuotationMaterialsEditor } from "./quotation-materials";
import d from "./quotation-studio.module.css";

/** One item editor, nested inside its room. Materials are always part of the item. */
export function QuotationItemInspector({
  quote,
  item,
  onChange,
  onDuplicate,
  onRemove,
  workspaceId,
  caseId,
}: {
  quote: Quote;
  item: QuoteLine;
  onChange: (line: QuoteLine) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  workspaceId: string;
  caseId: string;
}) {
  const [catalogOpen, setCatalogOpen] = useState(item.title === "New item");
  const patch = (value: Partial<QuoteLine>) => onChange({ ...item, ...value });
  const rooms = [
    ...new Set([
      ...(quote.rooms ?? []).map((r) => r.name),
      ...quote.lines.map((l) => l.room),
    ]),
  ];
  const work = item.catalogLinks?.find((c) => c.role === "work");
  const library = [
    ...new Map(
      quote.lines
        .filter((l) => l.id !== item.id)
        .flatMap((l) => l.customMaterials ?? [])
        .map((m) => [m.id, m]),
    ).values(),
  ];
  return (
    <div className={d.itemEditor} aria-label={`Item editor for ${item.title}`}>
      <div className={d.fields}>
        {quote.direction !== "deduction" && (
          <details
            className={d.optionalFields}
            open={catalogOpen}
            onToggle={(e) => setCatalogOpen(e.currentTarget.open)}
          >
            <summary>
              {work ? "Change catalog item" : "Choose item from catalog"}
            </summary>
            <CommercialCatalogPicker
              workspaceId={workspaceId}
              caseId={caseId}
              kind="work"
              label="Item from catalog"
              value={work?.snapshot ?? null}
              onChange={(value) => {
                let next: QuoteLine = {
                  ...item,
                  catalogLinks: (item.catalogLinks ?? []).filter(
                    (c) => !["work", "variant"].includes(c.role),
                  ),
                };
                if (value) {
                  next.catalogLinks!.push({
                    role: "work",
                    recordId: value.id,
                    version: value.version,
                    snapshot: value,
                  });
                  next.title = value.name;
                  next.specification = value.description ?? item.specification;
                  const unit = value.links?.find(
                    (link) => link.role === "unit",
                  )?.snapshot;
                  if (unit)
                    next = selectUnit(next, {
                      role: "unit",
                      recordId: unit.id,
                      version: unit.version,
                      snapshot: unit,
                    });
                }
                onChange(next);
                if (value) setCatalogOpen(false);
              }}
            />
          </details>
        )}
        <label>
          Item name
          <input
            aria-label="Item title"
            value={item.title}
            maxLength={240}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>
        <div className={d.quantityRow}>
          <label>
            Quantity
            <QuotationNumberInput
              label={`Quantity for ${item.title}`}
              value={item.quantity}
              min={0.0001}
              max={1e6}
              onChange={(quantity) => patch({ quantity })}
            />
          </label>
          <label>
            Unit
            <input
              aria-label="Item unit"
              value={item.unit}
              maxLength={20}
              onChange={(e) => onChange(customUnit(item, e.target.value))}
            />
          </label>
        </div>
        <label>
          Unit price · {quote.currency}
          <QuotationNumberInput
            label={`Rate for ${item.title}`}
            value={item.rate}
            money
            onChange={(rate) => patch({ rate })}
          />
        </label>
        <div className={d.itemTotal}>
          <span>Item total</span>
          <strong>
            {money(roundMoney(item.quantity * item.rate), quote.currency)}
          </strong>
        </div>
        <QuotationMaterialsEditor
          item={item}
          onChange={onChange}
          workspaceId={workspaceId}
          caseId={caseId}
          library={library}
          compact
        />
        <details className={d.optionalFields}>
          <summary>More item details</summary>
          <label>
            Description / specification
            <textarea
              aria-label="Item specification"
              rows={3}
              value={item.specification}
              maxLength={32000}
              onChange={(e) => patch({ specification: e.target.value })}
            />
          </label>
          {work && (
            <CommercialCatalogPicker
              workspaceId={workspaceId}
              caseId={caseId}
              kind="variant"
              label="Variant from catalog"
              value={
                item.catalogLinks?.find((c) => c.role === "variant")
                  ?.snapshot ?? null
              }
              linkedTo={work.recordId}
              onChange={(value) =>
                patch({
                  catalogLinks: [
                    ...(item.catalogLinks ?? []).filter(
                      (c) => c.role !== "variant",
                    ),
                    ...(value
                      ? [
                          {
                            role: "variant",
                            recordId: value.id,
                            version: value.version,
                            snapshot: value,
                          },
                        ]
                      : []),
                  ],
                })
              }
            />
          )}
          <CommercialCatalogPicker
            workspaceId={workspaceId}
            caseId={caseId}
            kind="unit"
            label="Unit from catalog"
            value={
              item.catalogLinks?.find((c) => c.role === "unit")?.snapshot ??
              null
            }
            onChange={(value) =>
              onChange(
                selectUnit(
                  item,
                  value
                    ? {
                        role: "unit",
                        recordId: value.id,
                        version: value.version,
                        snapshot: value,
                      }
                    : null,
                ),
              )
            }
          />
          <label>
            Move to room
            <select
              aria-label="Move item to room"
              value={item.room}
              onChange={(e) => patch({ room: e.target.value })}
            >
              {rooms.map((room) => (
                <option key={room}>{room}</option>
              ))}
            </select>
          </label>
        </details>
        <div className={d.itemActions}>
          <button type="button" onClick={onDuplicate}>
            <Copy size={14} />
            Duplicate item
          </button>
          <button type="button" onClick={onRemove}>
            <Trash2 size={14} />
            Remove item
          </button>
        </div>
      </div>
    </div>
  );
}
