"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileUp, Plus } from "lucide-react";
import {
  Button, Callout, ControlledModalDialog, DataGrid, EmptyState, ErrorState, NoResultsState, PageHeader, SelectField, TextInput,
  type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { catalogApi, type CatalogItemRow, type CatalogStructure, type CatalogSummary } from "@/lib/workspace/catalog-v2";
import { CatalogImportDialog } from "./catalog-import-dialog";
import { CatalogItemInspector } from "./catalog-item-inspector";
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
    { id: "name", header: t("Item"), accessorFn: (row) => `${row.name} ${row.code}`, size: 260, meta: { primary: true, renderCell: (row) => <span className={styles.itemCell}><strong>{row.name}</strong><small><bdi dir="ltr">{row.code}</bdi> · {typeLabels(t)[row.itemType] ?? row.itemType}</small></span> } },
    { id: "category", header: t("Category"), accessorFn: (row) => row.categoryName ?? "", size: 150 },
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
              appearance="flush"
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
              renderInspector={(row) => <CatalogItemInspector canManage={canManage} canReview={canReview} catalogId={catalogId} currency={currency} itemId={row.id} locale={locale} onChanged={() => void loadItems()} workspaceId={workspaceId} />}
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
  const [purpose, setPurpose] = useState<"sell" | "buy" | "reference">("sell");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const created = await catalogApi<{ id: string }>(workspaceId, "", { body: { name, purpose } });
      onCreated({ id: created.id, code: "", name, purpose, itemCount: 0, version: 1 });
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setSaving(false); }
  };
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button><Button form="new-catalog" isLoading={saving} type="submit" variant="primary">{t("Create catalog")}</Button></div>} isOpen={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title={t("New catalog")}>
    <form className={styles.form} id="new-catalog" onSubmit={submit}>
      {error ? <Callout title={t("Not saved")} tone="danger">{error}</Callout> : null}
      <TextInput autoFocus isRequired label={t("Name")} onChange={setName} value={name} />
      <SelectField items={[{ id: "sell", label: t("Items we sell") }, { id: "buy", label: t("Materials we buy") }, { id: "reference", label: t("Reference only") }]} label={t("Used for")} onSelectionChange={(key) => setPurpose(String(key) as typeof purpose)} selectedKey={purpose} />
    </form>
  </ControlledModalDialog>;
}

function NewItemDialog({ isOpen, onClose, onCreated, structure, workspaceId, catalogId }: { isOpen: boolean; onClose: () => void; onCreated: () => void; structure: CatalogStructure | null; workspaceId: string; catalogId: string }) {
  const t = useT();
  const [draft, setDraft] = useState({ code: "", name: "", itemType: "material", unitCode: "pcs", categoryId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      await catalogApi(workspaceId, `${catalogId}/items`, { body: { ...draft, categoryId: draft.categoryId || undefined } });
      setDraft({ code: "", name: "", itemType: "material", unitCode: "pcs", categoryId: "" });
      onCreated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setSaving(false); }
  };
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button><Button form="new-item" isLoading={saving} type="submit" variant="primary">{t("Add item")}</Button></div>} isOpen={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title={t("New item")}>
    <form className={styles.form} id="new-item" onSubmit={submit}>
      {error ? <Callout title={t("Not saved")} tone="danger">{error}</Callout> : null}
      <TextInput autoFocus isRequired label={t("Name")} onChange={set("name")} value={draft.name} />
      <div className={styles.formRow}>
        <TextInput isRequired label={t("Code")} onChange={set("code")} value={draft.code} />
        <SelectField isRequired items={Object.entries(typeLabels(t)).map(([id, label]) => ({ id, label }))} label={t("Type")} onSelectionChange={(key) => set("itemType")(String(key))} selectedKey={draft.itemType} />
      </div>
      <div className={styles.formRow}>
        <SelectField isRequired items={(structure?.units ?? []).map((unit) => ({ id: unit.code, label: `${unit.code} · ${unit.label}` }))} label={t("Unit")} onSelectionChange={(key) => set("unitCode")(String(key))} selectedKey={draft.unitCode} />
        <SelectField items={[{ id: "", label: t("No category") }, ...(structure?.categories ?? []).map((category) => ({ id: category.id, label: category.name }))]} label={t("Category")} onSelectionChange={(key) => set("categoryId")(String(key ?? ""))} selectedKey={draft.categoryId} />
      </div>
    </form>
  </ControlledModalDialog>;
}

