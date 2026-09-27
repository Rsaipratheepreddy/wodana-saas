"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { Plus, Trash2 } from "lucide-react";
import type { QuoteLine, QuotationMaterialRow } from "@/lib/commercial/types";
import { money } from "@/lib/commercial/client";
import {
  Button,
  Checkbox,
  IconButton,
  SelectField,
  TextAreaField,
  useDesignSystem,
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
  const t = useT();
  const { locale } = useDesignSystem();
  return (
    <section
      className={s.itemMaterials}
      id={`materials-${line.id}`}
      aria-label={t("{title} materials and notes", { title: line.title })}
    >
      <header className={s.materialsHeader}>
        <div>
          <p>{t("Quantities and costs below are per 1 {unit}.", { unit: line.unit })}</p>
        </div>
        <div className={s.pricingPicker}>
          <SelectField
            label={t("Item rate")}
            accent="neutral"
            aria-label={t("Pricing method for {title}", { title: line.title })}
            isDisabled={readOnly}
            selectedKey={line.pricingMode ?? "item"}
            items={[
              { id: "item", label: t("Manual item rate") },
              { id: "materials", label: t("Calculate from materials") },
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
            aria-label={t("Add material to {title}", { title: line.title })}
          >
            <Plus size={13} />
            {t("Add material")}</Button>
          <Button
            size="compact"
            variant="quiet"
            isDisabled={rows.length >= 40}
            onPress={onCatalog}
            aria-label={t("Select material for {title}", { title: line.title })}
          >
            {t("Select from catalog")}</Button>
        </div>
      )}
      <div className={s.materialScroll}>
        <table
          className={`${s.table} ${s.materialTable}`}
          aria-label={t("Materials belonging to {title}", { title: line.title })}
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
              <th scope="col">{t("Material")}</th>
              <th scope="col">{t("Specification")}</th>
              <th scope="col">{t("Type")}</th>
              <th scope="col">{t("Qty")}</th>
              <th scope="col">{t("Unit")}</th>
              <th scope="col" className={s.amount}>
                {t("Rate · {currency}", { currency })}
              </th>
              <th scope="col" className={s.amount}>
                {t("Amount")}</th>
              <th scope="col">
                <span className={s.sr}>{t("Actions")}</span>
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
                  <td data-label={t("Material")}>
                    <Cell
                      label={t("Material name {id}", { id: `${line.id}-${index + 1}` })}
                      value={row.name}
                      required
                      multiline
                      readOnly={readOnly}
                      onChange={(name) => edit({ name })}
                    />
                  </td>
                  <td data-label={t("Specification")}>
                    <Cell
                      label={t("Specification for {name}", { name: row.name })}
                      value={row.specification}
                      max={64000}
                      multiline
                      readOnly={readOnly}
                      placeholder={t("Material specification")}
                      onChange={(specification) => edit({ specification })}
                    />
                  </td>
                  <td data-label={t("Type")}>
                    <div className={s.cellPicker}>
                      <SelectField
                        label={t("Type for {name}", { name: row.name })}
                        accent="neutral"
                        aria-label={t("Type for {name}", { name: row.name })}
                        selectedKey={row.type}
                        isDisabled={readOnly}
                        items={[
                          { id: "material", label: t("Material") },
                          { id: "finish", label: t("Finish") },
                          { id: "labour", label: t("Labour") },
                          { id: "other", label: t("Other") },
                        ]}
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
                        {t("Client supplied")}</Checkbox>
                    </div>
                  </td>
                  <td data-label={t("Quantity")}>
                    {readOnly ? (
                      row.quantity
                    ) : (
                      <QuotationNumberInput
                        label={t("Quantity for material {name}", { name: row.name })}
                        value={row.quantity}
                        max={1e6}
                        onChange={(quantity) => edit({ quantity })}
                      />
                    )}
                  </td>
                  <td data-label={t("Unit")}>
                    <QuotationUnitPicker
                      label={t("Unit for material {name}", { name: row.name })}
                      value={row.unit}
                      workspaceId={workspaceId}
                      caseId={caseId}
                      readOnly={readOnly}
                      onChange={(unit) => edit({ unit })}
                    />
                  </td>
                  <td className={s.amount} data-label={t("Rate · {currency}", { currency })}>
                    {readOnly ? (
                      row.rate.toFixed(2)
                    ) : (
                      <QuotationNumberInput
                        label={t("Rate for material {name}", { name: row.name })}
                        value={row.rate}
                        money
                        onChange={(rate) => edit({ rate })}
                      />
                    )}
                  </td>
                  <td className={s.amount} data-label={t("Amount")}>
                    {materialAmount(row).toLocaleString(locale, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    {row.suppliedByClient && (
                      <small>{t("Client supplied · no charge")}</small>
                    )}
                  </td>
                  <td data-label={t("Actions")}>
                    {!readOnly && (
                      <IconButton
                        aria-label={t("Remove material {name}", { name: row.name })}
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
                  {!rows.length && <span>{t("No materials yet.")}</span>}
                  <span className={s.materialSubtotal}>
                    {t("Materials / 1 {unit}", { unit: line.unit })}
                  </span>
                </div>
              </td>
              <td className={s.amount}>
                <strong>{money(materialsRate(rows), currency, locale)}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className={s.itemNotes}>
        <TextAreaField
          label={t("Additional item notes")}
          aria-label={t("Item notes for {title}", { title: line.title })}
          value={line.specification}
          maxLength={32000}
          isReadOnly={readOnly}
          placeholder={t("Optional scope or installation notes")}
          onChange={(specification) => onChange({ specification })}
        />
      </div>
    </section>
  );
}
