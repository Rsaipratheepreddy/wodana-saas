"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, DataGrid, EmptyState, ErrorState, FormDialog, InlineNotice, MenuButton, MoneyField, NoResultsState, Skeleton, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { CostEntry, CostSource, PackageMoney, ProjectMoney as Money } from "@/lib/project-core/types";
import { subtractExact } from "@/lib/purchasing/amounts";
import { ProjectHours } from "../hrms/project-hours";
import { RaiseFinanceRequest, useCanRaiseFinanceRequest } from "../finance-requests/raise-request";
import { useProjectFormat } from "./format";
import styles from "./project-money.module.css";

type View = "packages" | "entries" | "hours";
const plain = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value) || "0";

/**
 * Money › Costs, for people who see costs: each package's budget against what's spent and still committed,
 * or every cost entry by entry, or the studio's approved hours on it. The key figures and the P&L are on
 * Money › Summary.
 */
export function ProjectMoney({ workspaceId, projectId, switcher }: { workspaceId: string; projectId: string; /** The Money tab's views, shown first in the toolbar. */ switcher?: ReactNode }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<Money | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("packages");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PackageMoney | null>(null);
  const [askingFinance, setAskingFinance] = useState(false);
  const canAskFinance = useCanRaiseFinanceRequest(workspaceId);
  const load = useCallback(async () => {
    try { setState(await api.money(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Money didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const money = useCallback((value: string | null, currency?: string) => (value === null ? "—" : format.money(value, currency ?? state?.currency ?? "")), [format, state?.currency]);
  const sources = useMemo<Record<CostSource, string>>(() => ({ stock: t("Stock"), service: t("Service"), price_difference: t("Invoice price"), charge: t("Charge"), labour: t("Labour"),
    petty_cash: t("Petty cash") }), [t]);
  const packageName = useCallback((name: string | null) => name ?? t("Not in a package"), [t]);
  const canManage = Boolean(state?.canManage);
  const needle = search.trim().toLocaleLowerCase();

  const packageColumns = useMemo<DataGridColumn<PackageMoney>[]>(() => [
    { id: "package", header: t("Package"), accessorFn: (row) => row.name ?? "", size: 260, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{packageName(row.name)}</span>{row.budgetNote ? <small>{row.budgetNote}</small> : null}</span> } },
    { id: "budget", header: t("Budget"), accessorFn: (row) => Number(row.budget ?? 0), size: 150, meta: { renderCell: (row) => canManage
      ? <button type="button" className={styles.linkButton} onClick={() => setEditing(row)}>{row.budget === null ? t("Set budget") : money(row.budget)}</button>
      : <span className={styles.number}>{money(row.budget)}</span> } },
    { id: "spent", header: t("Spent"), accessorFn: (row) => Number(row.spent), size: 140, meta: { renderCell: (row) => <span className={styles.number}>{money(row.spent)}</span> } },
    { id: "committed", header: t("Committed"), accessorFn: (row) => Number(row.committed), size: 140, meta: { mobileHidden: true,
      renderCell: (row) => <span className={styles.number}>{money(row.committed)}</span> } },
    { id: "left", header: t("Left"), accessorFn: (row) => row.over ? -1 : 1, size: 150, meta: { renderCell: (row) => row.budget === null ? <span className={styles.muted}>—</span>
      : row.over ? <span className={`${styles.number} ${styles.over}`}>{t("{amount} over", { amount: money(subtractExact(row.forecast, row.budget)) })}</span>
      : <span className={styles.number}>{money(subtractExact(row.budget, row.forecast))}</span> } },
  ], [t, money, canManage, packageName]);
  const entryColumns = useMemo<DataGridColumn<CostEntry>[]>(() => [
    { id: "what", header: t("Cost"), accessorFn: (row) => row.description, size: 320, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.description}</span><small>{[format.day(row.on), row.reference, packageName(row.packageName)].filter(Boolean).join(" · ")}</small></span> } },
    { id: "source", header: t("From"), accessorFn: (row) => row.source, size: 140, meta: { mobileHidden: true, renderCell: (row) => <span>{sources[row.source]}</span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.amount), size: 150, meta: { renderCell: (row) => <span className={styles.number}>{money(row.amount)}</span> } },
  ], [t, format, money, packageName, sources]);

  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={8} shape="rows" />;
  const entries = state.entries.filter((entry) => !needle || `${entry.description} ${entry.reference ?? ""} ${entry.packageName ?? ""}`.toLocaleLowerCase().includes(needle));
  const packages = state.packages.filter((row) => !needle || packageName(row.name).toLocaleLowerCase().includes(needle));
  const views: Record<View, string> = { packages: t("By package"), entries: t("Every cost"), hours: t("Hours") };
  const toolbar = <>{switcher}<MenuButton size="compact" label={views[view]} onAction={(value) => { setView(value as View); setSearch(""); }}
    items={(["packages", "entries", "hours"] as const).map((id) => ({ id, label: views[id] }))} />
    {canAskFinance ? <Button size="compact" onPress={() => setAskingFinance(true)}>{t("Request from Finance")}</Button> : null}</>;
  return <div className={styles.money}>
    {state.uncosted ? <InlineNotice tone="info" message={t("{count} costs have no price or exchange rate yet and aren't counted.", { count: state.uncosted })} /> : null}
    {view === "hours" ? <ProjectHours workspaceId={workspaceId} projectId={projectId} switcher={toolbar} />
      : view === "packages"
      ? <DataGrid<PackageMoney> ariaLabel={t("Budget by package")} columns={packageColumns} data={packages} getRowId={(row) => row.id ?? "none"} rowNumbers={false} wrapText
          onSearchChange={setSearch} searchValue={search} searchLabel={t("Search packages")} toolbarLeading={toolbar}
          emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No packages yet")} />} />
      : <DataGrid<CostEntry> ariaLabel={t("Every cost")} columns={entryColumns} data={entries} getRowId={(row) => row.key} rowNumbers={false} wrapText
          onSearchChange={setSearch} searchValue={search} searchLabel={t("Search costs")} toolbarLeading={toolbar}
          emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No costs yet")} />} />}
    {editing ? <BudgetDialog row={editing} currency={state.currency} name={packageName(editing.name)} onClose={() => setEditing(null)}
      onSave={async (amount, note) => { setState(await api.saveBudget(projectId, { packageId: editing.id, amount, note, version: editing.budgetVersion })); setEditing(null); }} /> : null}
    {askingFinance ? <RaiseFinanceRequest workspaceId={workspaceId} origin={{ projectId }} onClose={() => setAskingFinance(false)} /> : null}
  </div>;
}

function BudgetDialog({ row, currency, name, onClose, onSave }: { row: PackageMoney; currency: string; name: string; onClose: () => void; onSave: (amount: string, note: string) => Promise<void> }) {
  const t = useT();
  const [amount, setAmount] = useState(row.budget === null ? "" : plain(row.budget));
  const [note, setNote] = useState(row.budgetNote);
  return <FormDialog size="md" title={t("Budget for {package}", { package: name })} onClose={onClose} isDirty={amount !== (row.budget === null ? "" : plain(row.budget)) || note !== row.budgetNote}
    isSubmitDisabled={!amount} submitLabel={t("Save")} onSubmit={() => onSave(amount, note.trim())}>
    <MoneyField label={t("Budget")} isRequired currency={currency} value={amount} onChange={setAmount} />
    <TextInput label={t("Note")} maxLength={500} value={note} onChange={setNote} />
  </FormDialog>;
}
