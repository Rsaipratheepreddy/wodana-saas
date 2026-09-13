"use client";
import { useState } from "react";
import {
  Button,
  ControlledModalDialog,
  SelectField,
  TextInput,
} from "@/design-system";
import { useCatalogOptions } from "./catalog-options-cache";
import s from "./quotation-sheet.module.css";

const commonUnits = [
  "nos",
  "pcs",
  "set",
  "m",
  "m²",
  "m³",
  "mm",
  "cm",
  "ft",
  "ft²",
  "kg",
  "litre",
  "job",
  "lot",
  "hr",
];
const CUSTOM_UNIT = "__custom_unit__";

export function QuotationUnitPicker({
  label,
  value,
  readOnly,
  workspaceId,
  caseId,
  onChange,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  workspaceId: string;
  caseId: string;
  onChange: (unit: string) => void;
  onEditStart?: () => void;
  onCancel?: () => void;
}) {
  const [custom, setCustom] = useState<string | null>(null);
  const catalog = useCatalogOptions(
    workspaceId,
    caseId,
    "unit",
    "",
    undefined,
    undefined,
    !readOnly,
  );
  const options = [
    ...new Set([
      value,
      ...catalog.items.map((unit) =>
        String(unit.configuration?.symbol ?? unit.code),
      ),
      ...commonUnits,
    ]),
  ].filter((unit) => unit.trim() && unit.length <= 20);
  if (readOnly) return <span aria-label={label}>{value}</span>;
  return (
    <>
      <div className={s.cellPicker}>
        <SelectField
          label={label}
          aria-label={label}
          accent="neutral"
          selectedKey={value}
          items={[
            ...options.map((unit) => ({ id: unit, label: unit })),
            { id: CUSTOM_UNIT, label: "Custom unit…" },
          ]}
          onSelectionChange={(key) => {
            if (key === CUSTOM_UNIT) setCustom(value);
            else if (key !== null) onChange(String(key));
          }}
        />
      </div>
      <ControlledModalDialog
        title="Custom unit"
        isOpen={custom !== null}
        onOpenChange={(open) => {
          if (!open) setCustom(null);
        }}
        footer={
          <div className="wd-dialog-actions">
            <Button onPress={() => setCustom(null)}>Cancel</Button>
            <Button
              variant="primary"
              isDisabled={!custom?.trim()}
              onPress={() => {
                if (custom?.trim()) onChange(custom.trim());
                setCustom(null);
              }}
            >
              Apply unit
            </Button>
          </div>
        }
      >
        <TextInput
          label="Unit name"
          value={custom ?? ""}
          onChange={setCustom}
          maxLength={20}
          autoFocus
          placeholder="e.g. box or panel"
        />
      </ControlledModalDialog>
    </>
  );
}
