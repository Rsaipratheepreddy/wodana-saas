"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import { Checkbox } from "@/design-system";
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
        <button
          type="button"
          onClick={() => {
            close();
            setSource("catalog");
            setRole("material");
            setAdding(true);
          }}
        >
          <Plus size={14} />
          {t("Add material")}</button>
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
            <button
              type="button"
              aria-label={t("Replace material {name}", { name: c.snapshot.name })}
              title={t("Replace material")}
              onClick={() => {
                setCustom(null);
                setRole(c.role as MaterialRole);
                setReplacing(c.recordId);
                setSource("catalog");
                setAdding(true);
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              aria-label={t("Remove {title}", { title: c.snapshot.name })}
              title={t("Remove material")}
              onClick={() => {
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
              <X size={14} />
            </button>
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
            <button
              type="button"
              aria-label={t("Edit custom material {name}", { name: m.name })}
              title={t("Edit material")}
              onClick={() => {
                setReplacing(null);
                setAdding(true);
                setSource("custom");
                setCustom({ ...m });
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              aria-label={t("Remove custom material {name}", { name: m.name })}
              title={t("Remove material")}
              onClick={() => {
                onChange({
                  ...item,
                  customMaterials: materials.filter((x) => x.id !== m.id),
                });
                if (custom?.id === m.id) close();
              }}
            >
              <X size={14} />
            </button>
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
            <button
              type="button"
              aria-label={t("Cancel material editing")}
              onClick={close}
            >
              <X size={15} />
            </button>
          </div>
          {!replacing && !materials.some((m) => m.id === custom?.id) && (
            <div
              className={d.sourceTabs}
              role="group"
              aria-label={t("Material source")}
            >
              <button
                type="button"
                aria-pressed={source === "catalog"}
                onClick={() => {
                  setSource("catalog");
                  setCustom(null);
                }}
              >
                {t("Catalog")}</button>
              <button
                type="button"
                aria-pressed={source === "custom"}
                onClick={() => {
                  setSource("custom");
                  newCustom();
                }}
              >
                {t("Custom material")}</button>
              {!!library.length && (
                <button
                  type="button"
                  aria-pressed={source === "reuse"}
                  onClick={() => {
                    setSource("reuse");
                    setCustom(null);
                  }}
                >
                  {t("From quotation")}</button>
              )}
            </div>
          )}
          {source === "catalog" && (
            <>
              {!replacing && (
                <label>
                  {t("Type")}<select
                    aria-label={t("Material catalog type")}
                    value={role}
                    onChange={(e) => setRole(e.target.value as MaterialRole)}
                  >
                    <option value="material">{t("Material / hardware")}</option>
                    <option value="finish">{t("Finish")}</option>
                  </select>
                </label>
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
              <label>
                {t("Material name")}<input
                  autoFocus
                  aria-label={t("Material name")}
                  value={custom.name}
                  maxLength={240}
                  onChange={(e) =>
                    setCustom({ ...custom, name: e.target.value })
                  }
                />
              </label>
              <label>
                {t("Specification")}<textarea
                  aria-label={t("Material specification")}
                  rows={2}
                  value={custom.specification}
                  maxLength={3000}
                  placeholder={t("Colour, thickness, size or finish")}
                  onChange={(e) =>
                    setCustom({ ...custom, specification: e.target.value })
                  }
                />
              </label>
              <section className={d.optionalFields}>
                <h3>{t("Brand, code & supply")}</h3>
                <label>
                  {t("Brand / manufacturer")}<input
                    value={custom.brand}
                    maxLength={160}
                    onChange={(e) =>
                      setCustom({ ...custom, brand: e.target.value })
                    }
                  />
                </label>
                <label>
                  {t("Product / finish code")}<input
                    value={custom.code}
                    maxLength={80}
                    onChange={(e) =>
                      setCustom({ ...custom, code: e.target.value })
                    }
                  />
                </label>
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
              <button
                type="button"
                className={d.confirmMaterial}
                disabled={
                  !custom.name.trim() ||
                  (materials.length >= 20 &&
                    !materials.some((m) => m.id === custom.id))
                }
                onClick={() => {
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
                {t("Save material")}</button>
            </div>
          )}
          {source === "reuse" && (
            <label>
              {t("Material from this quotation")}<select
                aria-label={t("Reuse quotation material")}
                value=""
                disabled={materials.length >= 20}
                onChange={(e) => {
                  const m = library.find((m) => m.id === e.target.value);
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
              >
                <option value="">{t("Choose material…")}</option>
                {library.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
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
          <label key={r}>
            {t(r === "material"
              ? "Material specification / notes"
              : "Finish / hardware notes")}
            <textarea
              rows={2}
              value={materialNotes(item, r)}
              onChange={(e) =>
                onChange(
                  updateMaterials(
                    item,
                    r,
                    materialSelections(item, r),
                    e.target.value,
                  ),
                )
              }
            />
          </label>
        ))}
      </section>
    </section>
  );
}
