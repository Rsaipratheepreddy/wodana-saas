"use client";
import { useState } from "react";
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
      aria-label="Item materials"
      data-item-materials={item.id}
    >
      <div className={d.materialsHeading}>
        <strong>
          Materials <span>{selections.length + materials.length}</span>
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
          Add material
        </button>
      </div>
      {!selections.length &&
        !materials.length &&
        !item.material &&
        !item.finish &&
        !adding && (
          <p className={d.materialEmpty}>
            Add materials or finishes for this item.
          </p>
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
                  c.role === "finish" ? "Finish" : "Catalog material",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </div>
            <button
              type="button"
              aria-label={`Replace material ${c.snapshot.name}`}
              title="Replace material"
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
              aria-label={`Remove ${c.snapshot.name}`}
              title="Remove material"
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
                  m.suppliedByClient ? "Client supplied" : "Quotation only",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
              {m.specification && <p>{m.specification}</p>}
            </div>
            <button
              type="button"
              aria-label={`Edit custom material ${m.name}`}
              title="Edit material"
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
              aria-label={`Remove custom material ${m.name}`}
              title="Remove material"
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
              {replacing
                ? "Replace material"
                : custom && materials.some((m) => m.id === custom.id)
                  ? "Edit material"
                  : "Add material"}
            </strong>
            <button
              type="button"
              aria-label="Cancel material editing"
              onClick={close}
            >
              <X size={15} />
            </button>
          </div>
          {!replacing && !materials.some((m) => m.id === custom?.id) && (
            <div
              className={d.sourceTabs}
              role="group"
              aria-label="Material source"
            >
              <button
                type="button"
                aria-pressed={source === "catalog"}
                onClick={() => {
                  setSource("catalog");
                  setCustom(null);
                }}
              >
                Catalog
              </button>
              <button
                type="button"
                aria-pressed={source === "custom"}
                onClick={() => {
                  setSource("custom");
                  newCustom();
                }}
              >
                Custom material
              </button>
              {!!library.length && (
                <button
                  type="button"
                  aria-pressed={source === "reuse"}
                  onClick={() => {
                    setSource("reuse");
                    setCustom(null);
                  }}
                >
                  From quotation
                </button>
              )}
            </div>
          )}
          {source === "catalog" && (
            <>
              {!replacing && (
                <label>
                  Type
                  <select
                    aria-label="Material catalog type"
                    value={role}
                    onChange={(e) => setRole(e.target.value as MaterialRole)}
                  >
                    <option value="material">Material / hardware</option>
                    <option value="finish">Finish</option>
                  </select>
                </label>
              )}
              {atLimit ? (
                <p className={d.hint}>
                  Remove a catalog selection before adding another. This item
                  allows 12 catalog links.
                </p>
              ) : (
                <CommercialCatalogPicker
                  key={`${role}:${replacing}`}
                  workspaceId={workspaceId}
                  caseId={caseId}
                  kind={role}
                  label={
                    role === "material"
                      ? "Material / SKU from catalog"
                      : "Finish from catalog"
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
                Material name
                <input
                  autoFocus
                  aria-label="Material name"
                  value={custom.name}
                  maxLength={240}
                  onChange={(e) =>
                    setCustom({ ...custom, name: e.target.value })
                  }
                />
              </label>
              <label>
                Specification
                <textarea
                  aria-label="Material specification"
                  rows={2}
                  value={custom.specification}
                  maxLength={3000}
                  placeholder="Colour, thickness, size or finish"
                  onChange={(e) =>
                    setCustom({ ...custom, specification: e.target.value })
                  }
                />
              </label>
              <details className={d.optionalFields}>
                <summary>Brand, code & supply</summary>
                <label>
                  Brand / manufacturer
                  <input
                    value={custom.brand}
                    maxLength={160}
                    onChange={(e) =>
                      setCustom({ ...custom, brand: e.target.value })
                    }
                  />
                </label>
                <label>
                  Product / finish code
                  <input
                    value={custom.code}
                    maxLength={80}
                    onChange={(e) =>
                      setCustom({ ...custom, code: e.target.value })
                    }
                  />
                </label>
                <label className={d.check}>
                  <input
                    type="checkbox"
                    checked={custom.suppliedByClient}
                    onChange={(e) =>
                      setCustom({
                        ...custom,
                        suppliedByClient: e.target.checked,
                      })
                    }
                  />
                  Supplied by the client
                </label>
              </details>
              <p className={d.hint}>Saved in this quotation only.</p>
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
                Save material
              </button>
            </div>
          )}
          {source === "reuse" && (
            <label>
              Material from this quotation
              <select
                aria-label="Reuse quotation material"
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
                <option value="">Choose material…</option>
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
      <details className={d.optionalFields}>
        <summary>
          Material & finish notes
          {materialNotes(item, "material") || materialNotes(item, "finish")
            ? " · added"
            : ""}
        </summary>
        {(["material", "finish"] as const).map((r) => (
          <label key={r}>
            {r === "material"
              ? "Material specification / notes"
              : "Finish / hardware notes"}
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
      </details>
    </section>
  );
}
