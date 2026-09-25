"use client";
import { useState } from "react";
import { QuotationItemMaterials } from "./quotation-item-materials";
import { Check, Link2, Package, Pencil, Plus, X } from "lucide-react";
import {
  CommercialCatalogPicker,
  type CommercialCatalogChoice,
} from "./catalog-picker";
import type {
  CatalogSelection,
  QuoteLine,
  QuotationMaterial,
} from "@/lib/commercial/types";
import {
  materialNotes,
  materialSelections,
  updateMaterials,
  type MaterialRole,
} from "@/lib/commercial/materials";
import q from "./quotation-line-fields.module.css";

export function QuotationMaterialsSummary({
  line,
  onEdit,
}: {
  line: QuoteLine;
  onEdit?: () => void;
}) {
  const selections = materialSelections(line, "material"),
    finishes = materialSelections(line, "finish");
  const variant = line.catalogLinks?.find((link) => link.role === "variant");
  return (
    <div className={q.materialSummary}>
      {variant && <span className={q.variant}>{variant.snapshot.name}</span>}
      {selections.length ? (
        <ul>
          {selections.map((selection) => (
            <li key={selection.recordId}>
              <span className={q.materialName}>{selection.snapshot.name}</span>
              <span className={q.materialCode}>{selection.snapshot.code}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className={line.material ? q.customText : q.placeholder}>
          {line.material || "No material selected"}
        </span>
      )}
      {finishes.length ? (
        <span className={q.finishText}>
          Finish ·{" "}
          {finishes.map((selection) => selection.snapshot.name).join(", ")}
        </span>
      ) : (
        line.finish && <span className={q.finishText}>{line.finish}</span>
      )}
      {selections.length > 0 && (
        <span className={q.linked}>
          <Link2 size={11} />
          {selections.length} catalog{" "}
          {selections.length === 1 ? "material" : "materials"}
        </span>
      )}
      {selections.length > 0 && materialNotes(line, "material") && (
        <section className={q.materialNote}>
          <h3>Specification notes</h3>
          <p>{materialNotes(line, "material")}</p>
        </section>
      )}
      <CustomMaterialSummary materials={line.customMaterials} />
      {onEdit && (
        <button
          className={q.materialAction}
          aria-label={`Edit material for ${line.title}`}
          onClick={onEdit}
        >
          <Pencil size={12} />
          {line.material || selections.length
            ? "Edit materials"
            : "Select materials"}
        </button>
      )}
    </div>
  );
}

function MaterialSelectionSection({
  role,
  item,
  onChange,
  workspaceId,
  caseId,
}: {
  role: MaterialRole;
  item: QuoteLine;
  onChange: (line: QuoteLine) => void;
  workspaceId: string;
  caseId: string;
}) {
  const selections = materialSelections(item, role);
  const [adding, setAdding] = useState(!selections.length);
  const [related, setRelated] = useState(false);
  const anchor =
    item.catalogLinks?.find((link) => link.role === "variant") ??
    item.catalogLinks?.find((link) => link.role === "work");
  const atLimit = (item.catalogLinks?.length ?? 0) >= 12;
  const choose = (value: CommercialCatalogChoice | null) => {
    if (
      !value ||
      atLimit ||
      selections.some((selection) => selection.recordId === value.id)
    )
      return;
    const selection: CatalogSelection = {
      role,
      recordId: value.id,
      version: value.version,
      snapshot: value,
    };
    onChange(updateMaterials(item, role, [...selections, selection]));
    setAdding(false);
  };
  return (
    <section
      className={q.selectionSection}
      aria-label={
        role === "material" ? "Selected materials" : "Selected finishes"
      }
    >
      <div className={q.sectionHeading}>
        <div>
          <h3>{role === "material" ? "Materials & hardware" : "Finishes"}</h3>
          <span>
            {role === "material"
              ? "Select the actual products for this item."
              : "Choose the finish your client will receive."}
          </span>
        </div>
        <span className={q.count}>{selections.length}</span>
      </div>
      {selections.map((selection) => (
        <div className={q.selection} key={selection.recordId}>
          <span className={q.selectionIcon}>
            <Package size={17} />
          </span>
          <div>
            <strong>{selection.snapshot.name}</strong>
            <span>
              {selection.snapshot.code} ·{" "}
              {selection.snapshot.catalogName || "Workspace catalog"}
            </span>
            <small>
              <Check size={11} /> Catalog linked · v{selection.version}
            </small>
          </div>
          <button
            type="button"
            className={q.removeSelection}
            aria-label={`Remove ${selection.snapshot.name}`}
            onClick={() =>
              onChange(
                updateMaterials(
                  item,
                  role,
                  selections.filter(
                    (entry) => entry.recordId !== selection.recordId,
                  ),
                ),
              )
            }
          >
            <X size={15} />
          </button>
        </div>
      ))}
      {(adding || !selections.length) && !atLimit ? (
        <div className={q.searchArea}>
          {anchor && (
            <div
              className={q.sourceOptions}
              role="group"
              aria-label={`${role} catalog source`}
            >
              <button
                type="button"
                aria-pressed={!related}
                onClick={() => setRelated(false)}
              >
                All catalogs
              </button>
              <button
                type="button"
                aria-pressed={related}
                onClick={() => setRelated(true)}
              >
                Linked to this item
              </button>
            </div>
          )}
          <CommercialCatalogPicker
            workspaceId={workspaceId}
            caseId={caseId}
            kind={role}
            label={
              role === "material"
                ? "Material / SKU from catalog"
                : "Finish from catalog"
            }
            value={null}
            onChange={choose}
            linkedTo={related ? anchor?.recordId : undefined}
            excludeIds={selections.map((selection) => selection.recordId)}
          />
          {selections.length > 0 && (
            <button
              type="button"
              className={q.textButton}
              onClick={() => setAdding(false)}
            >
              Cancel selection
            </button>
          )}
        </div>
      ) : (
        !atLimit && (
          <button
            type="button"
            className={q.addSelection}
            onClick={() => setAdding(true)}
          >
            <Plus size={14} />
            {role === "material" ? "Add material or hardware" : "Add finish"}
          </button>
        )
      )}
      {atLimit && (
        <p className={q.muted}>
          This item has reached its 12 catalog selections. Remove a selection to
          add another.
        </p>
      )}
      <label className={q.notesField}>
        {role === "material"
          ? "Material specification / notes"
          : "Finish / hardware notes"}
        <textarea
          rows={2}
          placeholder={
            role === "material"
              ? "Thickness, application, dimensions or a custom material…"
              : "Colour, finish code or installation detail…"
          }
          value={materialNotes(item, role)}
          onChange={(event) =>
            onChange(
              updateMaterials(item, role, selections, event.target.value),
            )
          }
        />
      </label>
    </section>
  );
}

export function CustomMaterialSummary({
  materials,
}: {
  materials?: QuotationMaterial[];
}) {
  return (
    <>
      {materials?.map((m) => (
        <div className={q.customProduct} key={m.id}>
          <strong>{m.name}</strong>
          <small>{[m.brand, m.code].filter(Boolean).join(" · ")}</small>
          {m.specification && <p>{m.specification}</p>}
          <small>
            {m.suppliedByClient ? "Client supplied" : "Custom material"}
          </small>
        </div>
      ))}
    </>
  );
}

export function QuotationMaterialsEditor(props: {
  item: QuoteLine;
  onChange: (line: QuoteLine) => void;
  workspaceId: string;
  caseId: string;
  library?: QuotationMaterial[];
  compact?: boolean;
}) {
  const [custom, setCustom] = useState<QuotationMaterial | null>(null);
  const [reuse, setReuse] = useState(false);
  const materials = props.item.customMaterials ?? [];
  if (props.compact) return <QuotationItemMaterials {...props} />;
  return (
    <div className={q.materialEditor}>
      <MaterialSelectionSection {...props} role="material" />
      <MaterialSelectionSection {...props} role="finish" />
      <section className={q.selectionSection} aria-label="Custom materials">
        <div className={q.sectionHeading}>
          <div>
            <h3>Custom materials</h3>
            <span>
              Saved with this quotation. Your catalogs stay unchanged.
            </span>
          </div>
          <span className={q.count}>{materials.length}</span>
        </div>
        {materials.map((m) => (
          <div key={m.id} className={q.selection}>
            <span className={q.selectionIcon}>
              <Package size={17} />
            </span>
            <div>
              <strong>{m.name}</strong>
              <span>{[m.brand, m.code].filter(Boolean).join(" · ")}</span>
              <span>{m.specification}</span>
              <small>
                {m.suppliedByClient ? "Client supplied" : "Quotation only"}
              </small>
            </div>
            <button
              type="button"
              className={q.removeSelection}
              aria-label={`Edit custom material ${m.name}`}
              onClick={() => setCustom({ ...m })}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className={q.removeSelection}
              aria-label={`Remove custom material ${m.name}`}
              onClick={() =>
                props.onChange({
                  ...props.item,
                  customMaterials: materials.filter((x) => x.id !== m.id),
                })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {custom ? (
          <div className={q.customForm}>
            <label>
              Material name
              <input
                autoFocus
                value={custom.name}
                maxLength={240}
                onChange={(e) => setCustom({ ...custom, name: e.target.value })}
              />
            </label>
            <label>
              Product / finish code
              <input
                value={custom.code}
                maxLength={80}
                onChange={(e) => setCustom({ ...custom, code: e.target.value })}
              />
            </label>
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
              Material specification
              <textarea
                rows={3}
                value={custom.specification}
                maxLength={3000}
                placeholder="Dimensions, thickness, colour, finish…"
                onChange={(e) =>
                  setCustom({ ...custom, specification: e.target.value })
                }
              />
            </label>
            <label className={q.check}>
              <input
                type="checkbox"
                checked={custom.suppliedByClient}
                onChange={(e) =>
                  setCustom({ ...custom, suppliedByClient: e.target.checked })
                }
              />
              Supplied by the client
            </label>
            <div className={q.sourceOptions}>
              <button
                type="button"
                disabled={!custom.name.trim()}
                onClick={() => {
                  props.onChange({
                    ...props.item,
                    customMaterials: materials.some((m) => m.id === custom.id)
                      ? materials.map((m) => (m.id === custom.id ? custom : m))
                      : [...materials, custom],
                  });
                  setCustom(null);
                }}
              >
                Save material
              </button>
              <button type="button" onClick={() => setCustom(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          materials.length < 20 && (
            <button
              type="button"
              className={q.addSelection}
              onClick={() =>
                setCustom({
                  id: crypto.randomUUID(),
                  name: "",
                  code: "",
                  brand: "",
                  specification: "",
                  suppliedByClient: false,
                })
              }
            >
              <Plus size={14} />
              Add custom material
            </button>
          )
        )}
        {!!props.library?.length && (
          <>
            <button
              type="button"
              className={q.textButton}
              onClick={() => setReuse(!reuse)}
            >
              Reuse from this quotation
            </button>
            {reuse &&
              props.library
                .filter((m) => !materials.some((x) => x.id === m.id))
                .map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    className={q.addSelection}
                    disabled={materials.length >= 20}
                    onClick={() => {
                      props.onChange({
                        ...props.item,
                        customMaterials: [
                          ...materials,
                          { ...m, id: crypto.randomUUID() },
                        ],
                      });
                      setReuse(false);
                    }}
                  >
                    <Plus size={13} />
                    {m.name}
                  </button>
                ))}
          </>
        )}
      </section>
      <section className={q.clientPreview}>
        <h3>Client-facing specification</h3>
        <div>
          <strong>Materials</strong>
          <p>{props.item.material || "No material selected"}</p>
          {props.item.finish && (
            <>
              <strong>Finishes</strong>
              <p>{props.item.finish}</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
