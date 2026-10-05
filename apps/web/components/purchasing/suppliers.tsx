"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Badge, Button, DataGrid, EmptyState, ErrorState, NoAccessState, NoResultsState, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { formatPhoneForDisplay } from "@/lib/phone";
import { isDenied, type PurchasingApi } from "@/lib/purchasing/client";
import type { Approval, Supplier, SupplierState } from "@/lib/purchasing/types";
import { APPROVAL_TONE, useSupplierLabels } from "./supplier-labels";
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
    { id: "approval", header: t("Approval"), accessorFn: (row) => labels.approval[row.approval], size: 170, enableColumnFilter: false, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <Badge tone={APPROVAL_TONE[row.approval]}>{labels.approval[row.approval]}</Badge>
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
      ariaLabel={t("Suppliers")}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      isLoading={!state}
      onRowAction={(row) => setOpen(row.id)}
      onSearchChange={setSearch}
      searchValue={search}
      searchLabel={t("Search suppliers")}
      filters={[
        { id: "show", label: t("Show"), options: [{ id: "archived", label: t("Archived") }], value: show === "archived" ? "archived" : undefined, onChange: (value) => setShow(value === "archived" ? "archived" : "active") },
        ...(state?.categories.length ? [{ id: "category", label: t("Category"), options: state.categories.map((item) => ({ id: item, label: item })), value: category ?? undefined, onChange: (value: string | undefined) => setCategory(value ?? null) }] : []),
        { id: "approval", label: t("Approval"), options: (["approved", "pending", "on_hold", "not_approved"] as const).map((id) => ({ id, label: labels.approval[id] })), value: approval ?? undefined,
          onChange: (value) => setApproval((value as Approval | undefined) ?? null) },
        ...((state?.entities.length ?? 0) > 1 ? [{ id: "company", label: t("Company"), options: (state?.entities ?? []).map((entity) => ({ id: entity.id, label: entity.name })), value: company ?? undefined,
          onChange: (value: string | undefined) => setCompany(value ?? null) }] : []),
      ]}
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
