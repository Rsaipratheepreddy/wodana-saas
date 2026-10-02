"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileUp, Plus } from "lucide-react";
import {
  Button, DataGrid, EmptyState, ErrorState, FillWithWoddy, FormDialog, FormRow, MoreDetails, NoResultsState, PageHeader, SelectField, TextAreaField, TextInput, useFormDraft, useRememberedChoice,
  type DataGridColumn,
  TypeChip,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { catalogApi, type CatalogItemRow, type CatalogStructure, type CatalogSummary } from "@/lib/workspace/catalog-v2";
import { useAiReady } from "@/lib/workspace/ai-settings";
import { fillWithWoddy, imageForWoddy } from "@/lib/woddy/form-fill";
import { CatalogImportDialog } from "./catalog-import-dialog";
import { CatalogItemInspector } from "./catalog-item-inspector";
import { catalogImageUrl } from "@/lib/quotation/client";
import styles from "./catalog-page.module.css";

type T = ReturnType<typeof useT>;
const typeLabels = (t: T): Record<string, string> => ({ product: t("Product"), material: t("Material"), assembly: t("Assembly"), service: t("Service"), package: t("Package"), ready_made: t("Ready-made") });

export function CatalogPage({ workspaceId, canManage, canReview = false, currency, initialCatalogs, locale }: { workspaceId: string; canManage: boolean; canReview?: boolean; currency: string; initialCatalogs: CatalogSummary[]; locale?: string }) {
  const t = useT();
  const [catalogs, setCatalogs] = useState(initialCatalogs);
  const [catalogId, setCatalogId] = useState(initialCatalogs[0]?.id ?? "");
  const [structure, setStructure] = useState<CatalogStructure | null>(null);
  const [items, setItems] = useState<CatalogItemRow[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"import" | "item" | "catalog" | null>(null);
  const catalog = catalogs.find((entry) => entry.id === catalogId);

  const loadItems = useCallback(async () => {
    if (!catalogId) return;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ ...(categoryId ? { categoryId } : {}), ...(search.trim() ? { search: search.trim() } : {}), limit: "200" });
      const [nextStructure, page] = await Promise.all([
        catalogApi<CatalogStructure>(workspaceId, `${catalogId}/structure`),
        catalogApi<{ items: CatalogItemRow[] }>(workspaceId, `${catalogId}/items?${query}`),
      ]);
      setStructure(nextStructure); setItems(Array.isArray(page?.items) ? page.items : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setLoading(false); }
  }, [catalogId, categoryId, search, workspaceId]);
  useEffect(() => { const timer = window.setTimeout(() => void loadItems(), search ? 250 : 0); return () => window.clearTimeout(timer); }, [loadItems, search]);

  const money = useMemo(() => (value: string, currency: string) => {
    try { return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value)); } catch { return `${currency} ${value}`; }
  }, [locale]);
  // Catalog-wide attributes become columns (the first four), so each catalog shows what matters to it.
  const attributeColumns = (structure?.attributes ?? []).filter((attribute) => !attribute.categoryId).slice(0, 3);
  const columns = useMemo<DataGridColumn<CatalogItemRow>[]>(() => [
    { id: "image", header: t("Photo"), accessorFn: (row) => (row.image ? 1 : 0), size: 84, enableSorting: false, meta: { renderCell: (row) => row.image
      // eslint-disable-next-line @next/next/no-img-element -- the item's picture, streamed through the signed-in catalog route
      ? <img className={styles.thumb} src={catalogImageUrl(workspaceId, row.image.id, row.image.hasPreview)} alt="" loading="lazy" />
      : <span className={styles.thumb} data-empty="" aria-hidden="true" /> } },
    { id: "name", header: t("Item"), accessorFn: (row) => `${row.name} ${row.code}`, size: 260, meta: { primary: true, renderCell: (row) => <span className={styles.itemCell}><strong>{row.name}</strong><small><bdi dir="ltr">{row.code}</bdi> · {typeLabels(t)[row.itemType] ?? row.itemType}</small></span> } },
    { id: "category", header: t("Category"), accessorFn: (row) => row.categoryName ?? "", size: 150, cell: ({ row }) => <TypeChip>{row.original.categoryName}</TypeChip> },
    ...attributeColumns.map((attribute): DataGridColumn<CatalogItemRow> => ({ id: `attr-${attribute.code}`, header: attribute.label, accessorFn: (row) => row.values[attribute.code] ?? "", size: 120, meta: { mobileHidden: true } })),
    { id: "price", header: t("Price"), accessorFn: (row) => row.sellPrice?.price ?? row.sellPrice?.rate ?? "", size: 140, meta: { align: "end", renderCell: (row) => row.sellPrice && (row.sellPrice.price ?? row.sellPrice.rate)
      ? <span dir="ltr">{money(row.sellPrice.price ?? row.sellPrice.rate ?? "0", row.sellPrice.currency)}<span className={styles.muted}> / {row.unitCode}</span></span>
      : <span className={styles.muted}>{t("Price unavailable")}</span> } },
  ], [attributeColumns, money, t]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) if (item.categoryId) map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + 1);
    return map;
  }, [items]);

  if (!catalogs.length) {
    return <div className={styles.page}>
      <PageHeader title={t("Catalog")} />
      <EmptyState title={t("No catalogs yet")} description={t("A catalog holds the items, materials and prices you quote and buy.")}
        action={canManage ? <Button onPress={() => setDialog("catalog")} variant="primary"><Plus aria-hidden="true" size={15} />{t("Create catalog")}</Button> : null} />
      <NewCatalogDialog isOpen={dialog === "catalog"} onClose={() => setDialog(null)} onCreated={(created) => { setCatalogs([created]); setCatalogId(created.id); setDialog(null); }} workspaceId={workspaceId} />
    </div>;
  }

  return <div className={styles.page}>
    <PageHeader title={catalog?.name ?? t("Catalog")} actions={canManage ? <>
      <Button onPress={() => setDialog("import")}><FileUp aria-hidden="true" size={15} />{t("Import")}</Button>
      <Button onPress={() => setDialog("item")} variant="primary"><Plus aria-hidden="true" size={15} />{t("Add item")}</Button>
    </> : null} />
    <div className={styles.layout}>
      <nav aria-label={t("Categories")} className={styles.tree}>
        {catalogs.length > 1 ? <SelectField aria-label={t("Catalog")} items={catalogs.map((entry) => ({ id: entry.id, label: entry.name }))} label={t("Catalog")} onSelectionChange={(key) => { setCatalogId(String(key)); setCategoryId(null); }} selectedKey={catalogId} /> : null}
        <button aria-current={categoryId === null ? "true" : undefined} className={styles.treeItem} onClick={() => setCategoryId(null)} type="button"><span>{t("All items")}</span></button>
        {(structure?.categories ?? []).filter((category) => !category.parentId).map((category) => <button aria-current={categoryId === category.id ? "true" : undefined} className={styles.treeItem} key={category.id} onClick={() => setCategoryId(category.id)} type="button">
          <span>{category.name}</span>{!categoryId && counts.get(category.id) ? <small>{counts.get(category.id)}</small> : null}
        </button>)}
      </nav>
      <section className={styles.content} aria-label={t("Items")}>
        {error ? <ErrorState onRetry={() => void loadItems()} description={error} />
          : <DataGrid<CatalogItemRow>
              ariaLabel={t("Catalog items")}
              columns={columns}
              data={items}
              emptyContent={search.trim() ? <NoResultsState onClear={() => setSearch("")} />
                : <EmptyState title={t("No items yet")} description={t("Add items one by one or import your spreadsheet.")}
                    action={canManage ? <Button onPress={() => setDialog("import")} variant="primary"><FileUp aria-hidden="true" size={15} />{t("Import")}</Button> : null} />}
              getInspectorTitle={(row) => row.name}
              getRowId={(row) => row.id}
              isLoading={loading && !items.length}
              onSearchChange={setSearch}
              renderInspector={(row) => <CatalogItemInspector canManage={canManage} canReview={canReview} catalogId={catalogId} currency={currency} itemId={row.id} locale={locale} onChanged={() => void loadItems()} structure={structure} workspaceId={workspaceId} />}
              searchLabel={t("Search items")}
              searchValue={search}
              rowNumbers={false}
              selectable={false}
              wrapText
            />}
      </section>
    </div>
    <CatalogImportDialog catalogId={catalogId} isOpen={dialog === "import"} onClose={() => setDialog(null)} onImported={() => { setDialog(null); void loadItems(); }} workspaceId={workspaceId} />
    <NewItemDialog catalogId={catalogId} isOpen={dialog === "item"} onClose={() => setDialog(null)} onCreated={() => { setDialog(null); void loadItems(); }} structure={structure} workspaceId={workspaceId} />
  </div>;
}

function NewCatalogDialog({ isOpen, onClose, onCreated, workspaceId }: { isOpen: boolean; onClose: () => void; onCreated: (catalog: CatalogSummary) => void; workspaceId: string }) {
  const t = useT();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<CatalogSummary["purpose"]>("sell");
  const submit = async () => {
    const created = await catalogApi<{ id: string }>(workspaceId, "", { body: { name, purpose } });
    onCreated({ id: created.id, code: "", name, purpose, itemCount: 0, version: 1 });
  };
  return <FormDialog isDirty={Boolean(name.trim())} isOpen={isOpen} onClose={onClose} onSubmit={submit} submitLabel={t("Create catalog")} title={t("New catalog")}>
    <TextInput isRequired label={t("Name")} onChange={setName} value={name} />
    <SelectField isRequired items={[{ id: "sell", label: t("Items we sell") }, { id: "buy", label: t("Materials we buy") }, { id: "reference", label: t("Reference only") }]} label={t("Used for")} onSelectionChange={(key) => setPurpose(String(key) as typeof purpose)} selectedKey={purpose} />
  </FormDialog>;
}

function NewItemDialog({ isOpen, onClose, onCreated, structure, workspaceId, catalogId }: { isOpen: boolean; onClose: () => void; onCreated: () => void; structure: CatalogStructure | null; workspaceId: string; catalogId: string }) {
  const t = useT();
  const units = structure?.units ?? [];
  const categories = structure?.categories ?? [];
  const types = typeLabels(t);
  // The type, unit and category this person used last start the next item.
  const lastType = useRememberedChoice("catalog.item.type", (value) => value in types);
  const lastUnit = useRememberedChoice("catalog.item.unit", (value) => units.some((unit) => unit.code === value));
  const lastCategory = useRememberedChoice("catalog.item.category", (value) => categories.some((category) => category.id === value));
  const blank = () => ({ code: "", name: "", itemType: lastType.read() ?? "material", unitCode: lastUnit.read() ?? units[0]?.code ?? "pcs", categoryId: lastCategory.read() ?? "", description: "" });
  const [draft, setDraft] = useState(blank);
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = Boolean(draft.code || draft.name || draft.description);
  const saved = useFormDraft(isOpen ? `${workspaceId}/catalog/${catalogId}/new-item` : null, draft, { isDirty: dirty, restore: setDraft });
  const aiReady = useAiReady(isOpen ? workspaceId : null);
  const submit = async () => {
    await catalogApi(workspaceId, `${catalogId}/items`, { body: { ...draft, categoryId: draft.categoryId || undefined, description: draft.description.trim() || undefined } });
    lastType.remember(draft.itemType); lastUnit.remember(draft.unitCode); lastCategory.remember(draft.categoryId);
    setDraft(blank());
    onCreated();
  };
  const fill = (found: Record<string, string>) => setDraft((current) => ({ ...current, ...(found.name ? { name: found.name } : {}), ...(found.code ? { code: found.code } : {}),
    ...(found.description ? { description: found.description } : {}),
    ...(found.unit && units.some((unit) => unit.code.toLowerCase() === found.unit.toLowerCase()) ? { unitCode: units.find((unit) => unit.code.toLowerCase() === found.unit.toLowerCase())!.code } : {}) }));
  return <FormDialog draft={saved} isDirty={dirty} isOpen={isOpen} onClose={onClose} onSubmit={submit} submitLabel={t("Add item")} title={t("New item")}
    lead={aiReady ? <FillWithWoddy fields={[{ key: "name", label: t("Name") }, { key: "code", label: t("Code") }, { key: "unit", label: t("Unit") }, { key: "description", label: t("Description") }]}
      onApply={fill} onExtract={async ({ text, image }) => fillWithWoddy(workspaceId, "catalog_item", { ...(text ? { text } : {}), ...(image ? { image: await imageForWoddy(image) } : {}) })} /> : null}>
    <TextInput isRequired label={t("Name")} maxLength={200} onChange={set("name")} value={draft.name} />
    <FormRow>
      <TextInput isRequired label={t("Code")} maxLength={80} onChange={set("code")} value={draft.code} />
      <SelectField isRequired items={Object.entries(types).map(([id, label]) => ({ id, label }))} label={t("Type")} onSelectionChange={(key) => set("itemType")(String(key))} selectedKey={draft.itemType} />
    </FormRow>
    <FormRow>
      <SelectField isRequired items={units.map((unit) => ({ id: unit.code, label: `${unit.code} · ${unit.label}` }))} label={t("Unit")} onSelectionChange={(key) => set("unitCode")(String(key))} selectedKey={draft.unitCode} />
      <SelectField items={[{ id: "", label: t("No category") }, ...categories.map((category) => ({ id: category.id, label: category.name }))]} label={t("Category")} onSelectionChange={(key) => set("categoryId")(String(key ?? ""))} selectedKey={draft.categoryId} />
    </FormRow>
    <MoreDetails filled={draft.description ? 1 : 0}>
      <TextAreaField label={t("Description")} maxLength={4000} onChange={set("description")} value={draft.description} />
    </MoreDetails>
  </FormDialog>;
}

