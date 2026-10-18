"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import { Button, Checkbox, IconButton, SegmentedControl, TextAreaField, TextInput } from "@/design-system";
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
  const t = useT();
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
          {line.material || t("No material selected")}
        </span>
      )}
      {finishes.length ? (
        <span className={q.finishText}>
          {t("Finish · {names}", { names: finishes.map((selection) => selection.snapshot.name).join(", ") })}
        </span>
      ) : (
        line.finish && <span className={q.finishText}>{line.finish}</span>
      )}
      {selections.length > 0 && (
        <span className={q.linked}>
          <Link2 size={11} />
          {t(selections.length === 1 ? "{count} catalog material" : "{count} catalog materials", { count: selections.length })}
        </span>
      )}
      {selections.length > 0 && materialNotes(line, "material") && (
        <section className={q.materialNote}>
          <h3>{t("Specification notes")}</h3>
          <p>{materialNotes(line, "material")}</p>
        </section>
      )}
      <CustomMaterialSummary materials={line.customMaterials} />
      {onEdit && (
        <Button size="compact" variant="quiet" className={q.materialAction}
          aria-label={t("Edit material for {title}", { title: line.title })}
          onPress={onEdit}
        >
          <Pencil size={12} />
          {t(line.material || selections.length
            ? "Edit materials"
            : "Select materials")}
        </Button>
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
  const t = useT();
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
        t(role === "material" ? "Selected materials" : "Selected finishes")
      }
    >
      <div className={q.sectionHeading}>
        <div>
          <h3>{t(role === "material" ? "Materials & hardware" : "Finishes")}</h3>
          <span>
            {t(role === "material"
              ? "Select the actual products for this item."
              : "Choose the finish your client will receive.")}
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
              {selection.snapshot.catalogName || t("Workspace catalog")}
            </span>
            <small>
              <Check size={11} /> {t("Catalog linked · v{version}", { version: selection.version })}
            </small>
          </div>
          <IconButton size="compact"
            aria-label={t("Remove {title}", { title: selection.snapshot.name })}
            onPress={() =>
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
            <X aria-hidden="true" size={15} />
          </IconButton>
        </div>
      ))}
      {(adding || !selections.length) && !atLimit ? (
        <div className={q.searchArea}>
          {anchor && (
            <SegmentedControl
              label={t(role === "material" ? "material catalog source" : "finish catalog source")}
              value={related ? "linked" : "all"}
              onChange={(value) => setRelated(value === "linked")}
              options={[{ id: "all", label: t("All catalogs") }, { id: "linked", label: t("Linked to this item") }]}
            />
          )}
          <CommercialCatalogPicker
            workspaceId={workspaceId}
            caseId={caseId}
            kind={role}
            label={
              t(role === "material"
                ? "Material / SKU from catalog"
                : "Finish from catalog")
            }
            value={null}
            onChange={choose}
            linkedTo={related ? anchor?.recordId : undefined}
            excludeIds={selections.map((selection) => selection.recordId)}
          />
          {selections.length > 0 && (
            <Button size="compact" variant="quiet"
              onPress={() => setAdding(false)}
            >
              {t("Cancel selection")}</Button>
          )}
        </div>
      ) : (
        !atLimit && (
          <Button size="compact" variant="quiet"
            onPress={() => setAdding(true)}
          >
            <Plus size={14} />
            {t(role === "material" ? "Add material or hardware" : "Add finish")}
          </Button>
        )
      )}
      {atLimit && (
        <p className={q.muted}>
          {t("This item has reached its 12 catalog selections. Remove a selection to add another.")}</p>
      )}
      <TextAreaField
          label={t(role === "material"
            ? "Material specification / notes"
            : "Finish / hardware notes")}
          placeholder={
            t(role === "material"
              ? "Thickness, application, dimensions or a custom material…"
              : "Colour, finish code or installation detail…")
          }
          value={materialNotes(item, role)}
          onChange={(notes) => onChange(updateMaterials(item, role, selections, notes))}
        />
    </section>
  );
}

export function CustomMaterialSummary({
  materials,
}: {
  materials?: QuotationMaterial[];
}) {
  const t = useT();
  return (
    <>
      {materials?.map((m) => (
        <div className={q.customProduct} key={m.id}>
          <strong>{m.name}</strong>
          <small>{[m.brand, m.code].filter(Boolean).join(" · ")}</small>
          {m.specification && <p>{m.specification}</p>}
          <small>
            {t(m.suppliedByClient ? "Client supplied" : "Custom material")}
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
  const t = useT();
  const [custom, setCustom] = useState<QuotationMaterial | null>(null);
  const [reuse, setReuse] = useState(false);
  const materials = props.item.customMaterials ?? [];
  if (props.compact) return <QuotationItemMaterials {...props} />;
  return (
    <div className={q.materialEditor}>
      <MaterialSelectionSection {...props} role="material" />
      <MaterialSelectionSection {...props} role="finish" />
      <section className={q.selectionSection} aria-label={t("Custom materials")}>
        <div className={q.sectionHeading}>
          <div>
            <h3>{t("Custom materials")}</h3>
            <span>
              {t("Saved with this quotation. Your catalogs stay unchanged.")}</span>
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
                {t(m.suppliedByClient ? "Client supplied" : "Quotation only")}
              </small>
            </div>
            <IconButton size="compact"
              aria-label={t("Edit custom material {name}", { name: m.name })}
              onPress={() => setCustom({ ...m })}
            >
              <Pencil aria-hidden="true" size={14} />
            </IconButton>
            <IconButton size="compact"
              aria-label={t("Remove custom material {name}", { name: m.name })}
              onPress={() =>
                props.onChange({
                  ...props.item,
                  customMaterials: materials.filter((x) => x.id !== m.id),
                })
              }
            >
              <X aria-hidden="true" size={14} />
            </IconButton>
          </div>
        ))}
        {custom ? (
          <div className={q.customForm}>
            <TextInput label={t("Material name")} autoFocus value={custom.name} maxLength={240} onChange={(name) => setCustom({ ...custom, name })} />
            <TextInput label={t("Product / finish code")} value={custom.code} maxLength={80} onChange={(code) => setCustom({ ...custom, code })} />
            <TextInput label={t("Brand / manufacturer")} value={custom.brand} maxLength={160} onChange={(brand) => setCustom({ ...custom, brand })} />
            <TextAreaField label={t("Material specification")} value={custom.specification} maxLength={3000} placeholder={t("Dimensions, thickness, colour, finish…")} onChange={(specification) => setCustom({ ...custom, specification })} />
            <Checkbox
              isSelected={custom.suppliedByClient}
              onChange={(suppliedByClient) =>
                setCustom({ ...custom, suppliedByClient })
              }
            >
              {t("Supplied by the client")}
            </Checkbox>
            <div className={q.customActions}>
              <Button size="compact"
                variant="primary"
                isDisabled={!custom.name.trim()}
                onPress={() => {
                  props.onChange({
                    ...props.item,
                    customMaterials: materials.some((m) => m.id === custom.id)
                      ? materials.map((m) => (m.id === custom.id ? custom : m))
                      : [...materials, custom],
                  });
                  setCustom(null);
                }}
              >
                {t("Save material")}</Button>
              <Button size="compact" onPress={() => setCustom(null)}>
                {t("Cancel")}</Button>
            </div>
          </div>
        ) : (
          materials.length < 20 && (
            <Button size="compact" variant="quiet"
              onPress={() =>
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
              {t("Add custom material")}</Button>
          )
        )}
        {!!props.library?.length && (
          <>
            <Button size="compact" variant="quiet"
              onPress={() => setReuse(!reuse)}
            >
              {t("Reuse from this quotation")}</Button>
            {reuse &&
              props.library
                .filter((m) => !materials.some((x) => x.id === m.id))
                .map((m) => (
                  <Button size="compact"
                    key={m.id}
                    variant="quiet"
                    isDisabled={materials.length >= 20}
                    onPress={() => {
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
                  </Button>
                ))}
          </>
        )}
      </section>
      <section className={q.clientPreview}>
        <h3>{t("Client-facing specification")}</h3>
        <div>
          <strong>{t("Materials")}</strong>
          <p>{props.item.material || t("No material selected")}</p>
          {props.item.finish && (
            <>
              <strong>{t("Finishes")}</strong>
              <p>{props.item.finish}</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
