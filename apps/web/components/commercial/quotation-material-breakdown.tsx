"use client";
import { Plus, Trash2 } from "lucide-react";
import type { QuoteLine, QuotationMaterialRow } from "@/lib/commercial/types";
import { money } from "@/lib/commercial/client";
import {
  Button,
  Checkbox,
  IconButton,
  SelectField,
  TextAreaField,
} from "@/design-system";
import {
  materialAmount,
  materialsRate,
} from "@/lib/commercial/quotation-table";
import { QuotationTextCell as Cell } from "./quotation-text-cell";
import { QuotationNumberInput } from "./quotation-number-input";
import { QuotationUnitPicker } from "./quotation-unit-picker";
import s from "./quotation-sheet.module.css";

export function QuotationMaterialBreakdown({
  line,
  rows,
  currency,
  readOnly,
  workspaceId,
  caseId,
  onChange,
  onAdd,
  onCatalog,
}: {
  line: QuoteLine;
  rows: QuotationMaterialRow[];
  currency: string;
  readOnly: boolean;
  workspaceId: string;
  caseId: string;
  onChange: (patch: Partial<QuoteLine>) => void;
  onAdd: () => void;
  onCatalog: () => void;
}) {
  return (
    <section
      className={s.itemMaterials}
      id={`materials-${line.id}`}
      aria-label={`${line.title} materials and notes`}
    >
      <header className={s.materialsHeader}>
        <div>
          <p>Quantities and costs below are per 1 {line.unit}.</p>
        </div>
        <div className={s.pricingPicker}>
          <SelectField
            label="Item rate"
            accent="neutral"
            aria-label={`Pricing method for ${line.title}`}
            isDisabled={readOnly}
            selectedKey={line.pricingMode ?? "item"}
            items={[
              { id: "item", label: "Manual item rate" },
              { id: "materials", label: "Calculate from materials" },
            ]}
            onSelectionChange={(key) =>
              onChange({
                pricingMode: key as "item" | "materials",
                materialRows: rows,
              })
            }
          />
        </div>
      </header>
      {!readOnly && (
        <div className={s.materialActions}>
          <Button
            size="compact"
            isDisabled={rows.length >= 40}
            onPress={onAdd}
            aria-label={`Add material to ${line.title}`}
          >
            <Plus size={13} />
            Add material
          </Button>
          <Button
            size="compact"
            variant="quiet"
            isDisabled={rows.length >= 40}
            onPress={onCatalog}
            aria-label={`Select material for ${line.title}`}
          >
            Select from catalog
          </Button>
        </div>
      )}
      <div className={s.materialScroll}>
        <table
          className={`${s.table} ${s.materialTable}`}
          aria-label={`Materials belonging to ${line.title}`}
        >
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: 115 }} />
            <col style={{ width: 65 }} />
            <col style={{ width: 76 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 104 }} />
            <col style={{ width: 34 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Material</th>
              <th scope="col">Specification</th>
              <th scope="col">Type</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit</th>
              <th scope="col" className={s.amount}>
                Rate · {currency}
              </th>
              <th scope="col" className={s.amount}>
                Amount
              </th>
              <th scope="col">
                <span className={s.sr}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const edit = (patch: Partial<QuotationMaterialRow>) =>
                onChange({
                  materialRows: rows.map((current) =>
                    current.id === row.id ? { ...current, ...patch } : current,
                  ),
                });
              return (
                <tr key={row.id}>
                  <td data-label="Material">
                    <Cell
                      label={`Material name ${line.id}-${index + 1}`}
                      value={row.name}
                      required
                      multiline
                      readOnly={readOnly}
                      onChange={(name) => edit({ name })}
                    />
                  </td>
                  <td data-label="Specification">
                    <Cell
                      label={`Specification for ${row.name}`}
                      value={row.specification}
                      max={64000}
                      multiline
                      readOnly={readOnly}
                      placeholder="Material specification"
                      onChange={(specification) => edit({ specification })}
                    />
                  </td>
                  <td data-label="Type">
                    <div className={s.cellPicker}>
                      <SelectField
                        label={`Type for ${row.name}`}
                        accent="neutral"
                        aria-label={`Type for ${row.name}`}
                        selectedKey={row.type}
                        isDisabled={readOnly}
                        items={["material", "finish", "labour", "other"].map(
                          (type) => ({
                            id: type,
                            label: type[0].toUpperCase() + type.slice(1),
                          }),
                        )}
                        onSelectionChange={(key) =>
                          edit({
                            type: key as QuotationMaterialRow["type"],
                          })
                        }
                      />
                    </div>
                    <div className={s.clientSupply}>
                      <Checkbox
                        isSelected={row.suppliedByClient}
                        isDisabled={readOnly}
                        onChange={(suppliedByClient) =>
                          edit({ suppliedByClient })
                        }
                      >
                        Client supplied
                      </Checkbox>
                    </div>
                  </td>
                  <td data-label="Quantity">
                    {readOnly ? (
                      row.quantity
                    ) : (
                      <QuotationNumberInput
                        label={`Quantity for material ${row.name}`}
                        value={row.quantity}
                        max={1e6}
                        onChange={(quantity) => edit({ quantity })}
                      />
                    )}
                  </td>
                  <td data-label="Unit">
                    <QuotationUnitPicker
                      label={`Unit for material ${row.name}`}
                      value={row.unit}
                      workspaceId={workspaceId}
                      caseId={caseId}
                      readOnly={readOnly}
                      onChange={(unit) => edit({ unit })}
                    />
                  </td>
                  <td className={s.amount} data-label={`Rate · ${currency}`}>
                    {readOnly ? (
                      row.rate.toFixed(2)
                    ) : (
                      <QuotationNumberInput
                        label={`Rate for material ${row.name}`}
                        value={row.rate}
                        money
                        onChange={(rate) => edit({ rate })}
                      />
                    )}
                  </td>
                  <td className={s.amount} data-label="Amount">
                    {materialAmount(row).toLocaleString("en", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    {row.suppliedByClient && (
                      <small>Client supplied · no charge</small>
                    )}
                  </td>
                  <td data-label="Actions">
                    {!readOnly && (
                      <IconButton
                        aria-label={`Remove material ${row.name}`}
                        onPress={() =>
                          onChange({
                            materialRows: rows.filter(
                              (current) => current.id !== row.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>
                <div>
                  {!rows.length && <span>No materials yet.</span>}
                  <span className={s.materialSubtotal}>
                    Materials / 1 {line.unit}
                  </span>
                </div>
              </td>
              <td className={s.amount}>
                <strong>{money(materialsRate(rows), currency)}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className={s.itemNotes}>
        <TextAreaField
          label="Additional item notes"
          aria-label={`Item notes for ${line.title}`}
          value={line.specification}
          maxLength={32000}
          isReadOnly={readOnly}
          placeholder="Optional scope or installation notes"
          onChange={(specification) => onChange({ specification })}
        />
      </div>
    </section>
  );
}
