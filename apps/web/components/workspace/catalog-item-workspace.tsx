"use client";
import { useState } from "react";
import { Button } from "@/design-system";
import {
  blankCatalogRecord,
  type CatalogPageData,
  type CatalogRecord,
} from "@/lib/workspace/catalog";
import { CatalogSheet } from "./catalog-sheet";
import { CatalogRecipePreview } from "./catalog-recipe-preview";
import styles from "./catalog-settings-page.module.css";

export function CatalogItemWorkspace({
  data,
  item,
  onSave,
  onSaved,
  onEdit,
  onDirtyChange,
}: {
  data: CatalogPageData;
  item: CatalogRecord;
  onSave: (record: CatalogRecord) => Promise<CatalogRecord>;
  onSaved: (record: CatalogRecord) => void;
  onEdit: (record: CatalogRecord) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [view, setView] = useState("components");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const recipe = data.items.find(
    (r) =>
      r.kind === "construction" &&
      !r.archived &&
      r.configuration?.recordRole === "template" &&
      r.links.some((l) => l.relation === "work" && l.targetId === item.id),
  );
  const children = recipe
    ? data.items.filter(
        (r) =>
          !r.archived &&
          r.kind === "construction" &&
          r.links.some(
            (l) => l.relation === "parent" && l.targetId === recipe.id,
          ),
      )
    : [];
  const rows = children.filter((r) =>
    view === "components"
      ? r.configuration?.recordRole === "component"
      : ["operation", "charge"].includes(String(r.configuration?.recordRole)),
  );
  const variant = recipe
    ? data.items.find(
        (r) =>
          r.kind === "variant_rule" &&
          r.configuration?.operation === "group" &&
          r.links.some(
            (l) => l.relation === "construction" && l.targetId === recipe.id,
          ) &&
          String(r.configuration?.variant).toLowerCase() ===
            (item.code === "SLIDING_WARDROBE"
              ? "sliding"
              : item.code === "HINGED_WARDROBE"
                ? "openable"
                : ""),
      )
    : undefined;
  const createRecipe = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await onSave({
        ...blankCatalogRecord("construction"),
        catalogId: item.catalogId,
        name: `${item.name} recipe`,
        code: `RECIPE_${item.code}`.slice(0, 80),
        configuration: { recordRole: "template", sellingBasis: "manual" },
        links: [
          { relation: "work", targetId: item.id },
          ...item.links.filter((l) => l.relation === "unit"),
        ],
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the recipe.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Item configuration">
      <div className={styles.itemHeading}>
        <div>
          <h2>{item.name}</h2>
          <p>
            {item.links
              .filter((l) => l.relation === "room")
              .map((l) => data.items.find((r) => r.id === l.targetId)?.name)
              .filter(Boolean)
              .join(" · ") || "All rooms"}
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            size="compact"
            isDisabled={dirty}
            onPress={() => onEdit(item)}
          >
            Item details
          </Button>
          {recipe && (
            <Button
              size="compact"
              isDisabled={dirty}
              onPress={() => onEdit(recipe)}
            >
              Measurement & recipe
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!recipe ? (
        <div className={styles.body}>
          <p className={styles.notice}>
            Set up this item once, then reuse its components, processes and
            pricing inputs in quotations.
          </p>
          {data.canManage && (
            <Button variant="primary" isLoading={busy} onPress={createRecipe}>
              Create item recipe
            </Button>
          )}
        </div>
      ) : (
        <>
          <div
            className={styles.workspaceTabs}
            role="group"
            aria-label="Item configuration sections"
          >
            {[
              ["components", "Materials & components"],
              ["work", "Factory & on-site"],
              ["price", "Preview price"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={view === id}
                onClick={() => {
                  if (
                    dirty &&
                    !window.confirm("Discard unsaved sheet changes?")
                  )
                    return;
                  setDirty(false);
                  onDirtyChange(false);
                  setView(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "price" ? (
            <CatalogRecipePreview
              key={recipe.id}
              data={data}
              initialTemplateId={recipe.id}
              initialVariantId={variant?.id}
              onEdit={onEdit}
            />
          ) : (
            <div className={styles.body}>
              <CatalogSheet
                key={`${recipe.id}:${view}`}
                kind="construction"
                items={data.items}
                rows={rows}
                canManage={data.canManage}
                initialColumns={
                  view === "components"
                    ? [
                        "name",
                        "link:material",
                        "link:sku",
                        "link:hardware",
                        "config:quantityBasis",
                        "config:quantityInput",
                        "link:unit",
                      ]
                    : [
                        "name",
                        "link:factory_process",
                        "link:site_process",
                        "link:execution",
                        "config:quantityBasis",
                        "link:unit",
                        "config:workLocation",
                      ]
                }
                createRow={() => ({
                  ...blankCatalogRecord("construction"),
                  catalogId: item.catalogId,
                  configuration: {
                    recordRole:
                      view === "components" ? "component" : "operation",
                    required: "required",
                    quantityBasis: "manual",
                    factor: 1,
                  },
                  links: [{ relation: "parent", targetId: recipe.id }],
                })}
                onDirtyChange={(value) => {
                  setDirty(value);
                  onDirtyChange(value);
                }}
                onSave={onSave}
                onSaved={onSaved}
                onOpen={(record) => {
                  if (dirty) {
                    setError(
                      "Save or undo the sheet changes before opening details.",
                    );
                    return;
                  }
                  onEdit(record);
                }}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
