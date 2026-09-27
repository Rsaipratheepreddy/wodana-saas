"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Button, DataGrid, EmptyState, ErrorState, NoAccessState, MenuButton, NoResultsState, SegmentedControl, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { formatPhoneForDisplay } from "@/lib/phone";
import { isDenied, type PurchasingApi } from "@/lib/purchasing/client";
import type { Approval, Supplier, SupplierState } from "@/lib/purchasing/types";
import { useSupplierLabels } from "./supplier-labels";
import { SupplierImport } from "./supplier-import";
import { SupplierSheet } from "./supplier-sheet";
import styles from "./purchasing.module.css";

type Show = "active" | "archived";

/**
 * The supplier register: who supplies what, whether they're approved, on what terms, and who to call.
 * A row opens the supplier; suppliers already kept in a spreadsheet can be imported.
 */
export function Suppliers({ api, adding, onAddingChange }: { api: PurchasingApi; adding: boolean; onAddingChange: (adding: boolean) => void }) {
  const t = useT();
  const labels = useSupplierLabels();
  const [state, setState] = useState<SupplierState | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<Show>("active");
  const [category, setCategory] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try { setState(await api.suppliers()); setError(""); } catch (cause) { setDenied(isDenied(cause)); setError(cause instanceof Error ? cause.message : t("The suppliers didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const companies = useMemo(() => new Map((state?.entities ?? []).map((entity) => [entity.id, entity])), [state]);
  const rows = useMemo(() => (state?.suppliers ?? []).filter((supplier) => (show === "archived" ? supplier.status === "archived" : supplier.status !== "archived")
    && (!category || supplier.categories.includes(category)) && (!approval || supplier.approval === approval) && (!company || supplier.entityIds.includes(company))
    && (!search.trim() || `${supplier.name} ${supplier.categories.join(" ")} ${supplier.contactName ?? ""} ${supplier.locality ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))),
  [state, show, category, approval, company, search]);

  const columns = useMemo<DataGridColumn<Supplier>[]>(() => [
    { id: "name", header: t("Supplier"), accessorFn: (row) => row.name, size: 260, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.name}</span>{row.categories.length ? <small>{row.categories.join(", ")}</small> : null}</span> } },
    { id: "approval", header: t("Approval"), accessorFn: (row) => labels.approval[row.approval], size: 170, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.approval} data-approval={row.approval}>{labels.approval[row.approval]}</span>
      {row.preferredFor.length ? <small>{t("Preferred for {categories}", { categories: row.preferredFor.join(", ") })}</small> : null}</span> } },
    { id: "terms", header: t("Payment"), accessorFn: (row) => labels.termsText(row), size: 170 },
    { id: "deal", header: t("Deal"), accessorFn: (row) => labels.dealText(row), size: 140, meta: { mobileHidden: true } },
    { id: "contact", header: t("Contact"), accessorFn: (row) => `${row.contactName ?? ""} ${row.phone ?? ""}`, size: 190, meta: { mobileHidden: true, renderCell: (row) => row.contactName || row.phone
      ? <span className={styles.nameCell}><span>{row.contactName ?? formatPhoneForDisplay(row.phone)}</span>{row.contactName && row.phone ? <small>{formatPhoneForDisplay(row.phone)}</small> : null}</span> : null } },
    { id: "companies", header: t("Buys"), accessorFn: (row) => row.entityIds.map((id) => companies.get(id)?.code ?? "").join(", "), size: 110, meta: { mobileHidden: true } },
  ], [t, labels, companies]);

  if (error && !state) return denied ? <NoAccessState /> : <ErrorState description={error} onRetry={() => void load()} />;
  const filtered = category || approval || company;
  const current = state?.suppliers.find((item) => item.id === open) ?? null;

  return <>
    <DataGrid<Supplier>
      appearance="flush"
      ariaLabel={t("Suppliers")}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      isLoading={!state}
      onRowAction={(row) => setOpen(row.id)}
      onSearchChange={setSearch}
      searchValue={search}
      searchLabel={t("Search suppliers")}
      toolbarLeading={<div className={styles.filters}>
        <SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "active", label: t("In use") }, { id: "archived", label: t("Archived") }]} />
        {state?.categories.length ? <MenuButton size="compact" label={category ?? t("All categories")} onAction={(id) => setCategory(id === "all" ? null : id)}
          items={[{ id: "all", label: t("All categories") }, ...state.categories.map((item) => ({ id: item, label: item }))]} /> : null}
        <MenuButton size="compact" label={approval ? labels.approval[approval] : t("Any approval")} onAction={(id) => setApproval(id === "any" ? null : id as Approval)}
          items={[{ id: "any", label: t("Any approval") }, ...(["approved", "pending", "on_hold", "not_approved"] as const).map((id) => ({ id, label: labels.approval[id] }))]} />
        {(state?.entities.length ?? 0) > 1 ? <MenuButton size="compact" label={company ? companies.get(company)?.name ?? "" : t("All companies")} onAction={(id) => setCompany(id === "all" ? null : id)}
          items={[{ id: "all", label: t("All companies") }, ...(state?.entities ?? []).map((entity) => ({ id: entity.id, label: entity.name }))]} /> : null}
      </div>}
      toolbarActions={state?.canManage ? <Button size="compact" onPress={() => setImporting(true)}><Upload aria-hidden="true" size={14} />{t("Import")}</Button> : null}
      emptyContent={search.trim() || filtered ? <NoResultsState onClear={() => { setSearch(""); setCategory(null); setApproval(null); setCompany(null); }} />
        : <EmptyState title={show === "archived" ? t("No archived suppliers") : t("No suppliers yet")}
            description={show === "archived" ? undefined : t("Add the suppliers you buy from, or import the list you already keep.")}
            action={show === "active" && state?.canManage ? <Button variant="primary" onPress={() => setImporting(true)}>{t("Import a supplier list")}</Button> : null} />}
      rowNumbers={false}
      selectable={false}
      wrapText
    />
    {state && (current || (adding && state.canManage)) ? <SupplierSheet api={api} state={state} supplier={adding ? null : current} onState={setState}
      onClose={() => { setOpen(null); onAddingChange(false); }} /> : null}
    {importing && state ? <SupplierImport api={api} state={state} onClose={() => setImporting(false)} onImported={(next) => { setState(next); setImporting(false); }} /> : null}
  </>;
}
