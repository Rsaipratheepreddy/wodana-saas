"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import { Button, Checkbox, IconButton, SegmentedControl, SelectField, TextAreaField, TextInput } from "@/design-system";
import { Pencil, Plus, X } from "lucide-react";
import type { QuoteLine, QuotationMaterial } from "@/lib/commercial/types";
import {
  materialNotes,
  materialSelections,
  updateMaterials,
  type MaterialRole,
} from "@/lib/commercial/materials";
import {
  CommercialCatalogPicker,
  type CommercialCatalogChoice,
} from "./catalog-picker";
import d from "./quotation-studio.module.css";

type Props = {
  item: QuoteLine;
  onChange: (line: QuoteLine) => void;
  workspaceId: string;
  caseId: string;
  library?: QuotationMaterial[];
};
export function QuotationItemMaterials({
  item,
  onChange,
  workspaceId,
  caseId,
  library = [],
}: Props) {
  const t = useT();
  const [adding, setAdding] = useState(false),
    [source, setSource] = useState("catalog");
  const [role, setRole] = useState<MaterialRole>("material");
  const [replacing, setReplacing] = useState<string | null>(null);
  const [custom, setCustom] = useState<QuotationMaterial | null>(null);
  const materials = item.customMaterials ?? [];
  const selections = (item.catalogLinks ?? []).filter(
    (c) => c.role === "material" || c.role === "finish",
  );
  const atLimit = !replacing && (item.catalogLinks?.length ?? 0) >= 12;
  const close = () => {
    setAdding(false);
    setReplacing(null);
    setCustom(null);
  };
  const choose = (value: CommercialCatalogChoice | null) => {
    if (!value || atLimit) return;
    const current = materialSelections(item, role);
    if (
      current.some((c) => c.recordId === value.id && c.recordId !== replacing)
    )
      return;
    const next = {
      role,
      recordId: value.id,
      version: value.version,
      snapshot: value,
    };
    onChange(
      updateMaterials(
        item,
        role,
        replacing
          ? current.map((c) => (c.recordId === replacing ? next : c))
          : [...current, next],
      ),
    );
    close();
  };
  const newCustom = () =>
    setCustom({
      id: crypto.randomUUID(),
      name: "",
      code: "",
      brand: "",
      specification: "",
      suppliedByClient: false,
    });
  return (
    <section
      className={d.materialsSection}
      aria-label={t("Item materials")}
      data-item-materials={item.id}
    >
      <div className={d.materialsHeading}>
        <strong>
          {t("Materials")}{" "}<span>{selections.length + materials.length}</span>
        </strong>
        <Button size="compact" variant="quiet"
          onPress={() => {
            close();
            setSource("catalog");
            setRole("material");
            setAdding(true);
          }}
        >
          <Plus size={14} />
          {t("Add material")}</Button>
      </div>
      {!selections.length &&
        !materials.length &&
        !item.material &&
        !item.finish &&
        !adding && (
          <p className={d.materialEmpty}>
            {t("Add materials or finishes for this item.")}</p>
        )}
      <ul className={d.materialList}>
        {selections.map((c) => (
          <li key={`${c.role}:${c.recordId}`}>
            <div>
              <strong>{c.snapshot.name}</strong>
              <small>
                {[
                  c.snapshot.code,
                  c.snapshot.catalogName,
                  t(c.role === "finish" ? "Finish" : "Catalog material"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </div>
            <IconButton size="compact"
              aria-label={t("Replace material {name}", { name: c.snapshot.name })}
              onPress={() => {
                setCustom(null);
                setRole(c.role as MaterialRole);
                setReplacing(c.recordId);
                setSource("catalog");
                setAdding(true);
              }}
            >
              <Pencil aria-hidden="true" size={14} />
            </IconButton>
            <IconButton size="compact"
              aria-label={t("Remove {title}", { title: c.snapshot.name })}
              onPress={() => {
                onChange(
                  updateMaterials(
                    item,
                    c.role as MaterialRole,
                    materialSelections(item, c.role as MaterialRole).filter(
                      (x) => x.recordId !== c.recordId,
                    ),
                  ),
                );
                if (replacing === c.recordId) close();
              }}
            >
              <X aria-hidden="true" size={14} />
            </IconButton>
          </li>
        ))}
        {materials.map((m) => (
          <li key={m.id}>
            <div>
              <strong>{m.name}</strong>
              <small>
                {[
                  m.brand,
                  m.code,
                  t(m.suppliedByClient ? "Client supplied" : "Quotation only"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              {m.specification && <p>{m.specification}</p>}
            </div>
            <IconButton size="compact"
              aria-label={t("Edit custom material {name}", { name: m.name })}
              onPress={() => {
                setReplacing(null);
                setAdding(true);
                setSource("custom");
                setCustom({ ...m });
              }}
            >
              <Pencil aria-hidden="true" size={14} />
            </IconButton>
            <IconButton size="compact"
              aria-label={t("Remove custom material {name}", { name: m.name })}
              onPress={() => {
                onChange({
                  ...item,
                  customMaterials: materials.filter((x) => x.id !== m.id),
                });
                if (custom?.id === m.id) close();
              }}
            >
              <X aria-hidden="true" size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      {adding && (
        <div className={d.materialComposer}>
          <div className={d.materialsHeading}>
            <strong>
              {t(replacing
                ? "Replace material"
                : custom && materials.some((m) => m.id === custom.id)
                  ? "Edit material"
                  : "Add material")}
            </strong>
            <IconButton size="compact"
              aria-label={t("Cancel material editing")}
              onPress={close}
            >
              <X aria-hidden="true" size={15} />
            </IconButton>
          </div>
          {!replacing && !materials.some((m) => m.id === custom?.id) && (
            <SegmentedControl
              label={t("Material source")}
              value={source}
              onChange={(next) => {
                if (next === "custom") { setSource("custom"); newCustom(); return; }
                setSource(next as typeof source);
                setCustom(null);
              }}
              options={[
                { id: "catalog", label: t("Catalog") },
                { id: "custom", label: t("Custom material") },
                ...(library.length ? [{ id: "reuse", label: t("From quotation") }] : []),
              ]}
            />
          )}
          {source === "catalog" && (
            <>
              {!replacing && (
                <SelectField
                  label={t("Type")}
                  aria-label={t("Material catalog type")}
                  items={[{ id: "material", label: t("Material / hardware") }, { id: "finish", label: t("Finish") }]}
                  selectedKey={role}
                  onSelectionChange={(key) => key !== null && setRole(String(key) as MaterialRole)}
                />
              )}
              {atLimit ? (
                <p className={d.hint}>
                  {t("Remove a catalog selection before adding another. This item allows 12 catalog links.")}</p>
              ) : (
                <CommercialCatalogPicker
                  key={`${role}:${replacing}`}
                  workspaceId={workspaceId}
                  caseId={caseId}
                  kind={role}
                  label={
                    t(role === "material"
                      ? "Material / SKU from catalog"
                      : "Finish from catalog")
                  }
                  value={null}
                  excludeIds={materialSelections(item, role).map(
                    (c) => c.recordId,
                  )}
                  onChange={choose}
                />
              )}
            </>
          )}
          {source === "custom" && custom && (
            <div className={d.fields}>
              <TextInput
                label={t("Material name")}
                autoFocus
                value={custom.name}
                maxLength={240}
                onChange={(name) => setCustom({ ...custom, name })}
              />
              <TextAreaField
                label={t("Specification")}
                aria-label={t("Material specification")}
                value={custom.specification}
                maxLength={3000}
                placeholder={t("Colour, thickness, size or finish")}
                onChange={(specification) => setCustom({ ...custom, specification })}
              />
              <section className={d.optionalFields}>
                <h3>{t("Brand, code & supply")}</h3>
                <TextInput
                  label={t("Brand / manufacturer")}
                  value={custom.brand}
                  maxLength={160}
                  onChange={(brand) => setCustom({ ...custom, brand })}
                />
                <TextInput
                  label={t("Product / finish code")}
                  value={custom.code}
                  maxLength={80}
                  onChange={(code) => setCustom({ ...custom, code })}
                />
                <Checkbox
                  isSelected={custom.suppliedByClient}
                  onChange={(suppliedByClient) =>
                    setCustom({ ...custom, suppliedByClient })
                  }
                >
                  {t("Supplied by the client")}
                </Checkbox>
              </section>
              <p className={d.hint}>{t("Saved in this quotation only.")}</p>
              <Button
                className={d.confirmMaterial}
                variant="primary"
                isDisabled={
                  !custom.name.trim() ||
                  (materials.length >= 20 &&
                    !materials.some((m) => m.id === custom.id))
                }
                onPress={() => {
                  const saved = { ...custom, name: custom.name.trim() };
                  onChange({
                    ...item,
                    customMaterials: materials.some((m) => m.id === custom.id)
                      ? materials.map((m) => (m.id === custom.id ? saved : m))
                      : [...materials, saved],
                  });
                  close();
                }}
              >
                {t("Save material")}</Button>
            </div>
          )}
          {source === "reuse" && (
            <SelectField
              label={t("Material from this quotation")}
              aria-label={t("Reuse quotation material")}
              placeholder={t("Choose material…")}
              items={library.map((m) => ({ id: m.id, label: m.name }))}
              selectedKey={null}
              isDisabled={materials.length >= 20}
              onSelectionChange={(key) => {
                  const m = library.find((m) => m.id === key);
                  if (m) {
                    onChange({
                      ...item,
                      customMaterials: [
                        ...materials,
                        { ...m, id: crypto.randomUUID() },
                      ],
                    });
                    close();
                  }
                }}
            />
          )}
        </div>
      )}
      <section className={d.optionalFields}>
        <h3>
          {t(materialNotes(item, "material") || materialNotes(item, "finish")
            ? "Material & finish notes · added"
            : "Material & finish notes")}
        </h3>
        {(["material", "finish"] as const).map((r) => (
          <TextAreaField
            key={r}
            label={t(r === "material"
              ? "Material specification / notes"
              : "Finish / hardware notes")}
            value={materialNotes(item, r)}
            onChange={(notes) => onChange(updateMaterials(item, r, materialSelections(item, r), notes))}
          />
        ))}
      </section>
    </section>
  );
}
