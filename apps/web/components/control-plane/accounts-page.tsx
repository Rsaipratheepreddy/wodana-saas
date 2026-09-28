"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, DataGrid, EmptyState, ErrorState, ListTabs, NoResultsState, PageHeader, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, LIFECYCLE_STATES, type AccountList, type AccountSummary, type LifecycleState } from "@/lib/internal/console";
import { useConsoleFormat, useConsoleLabels } from "./labels";
import styles from "./control-plane.module.css";

type Filter = "all" | LifecycleState;

/** Accounts list (§6.1): search, state filter, seats used/allowed, plan and last activity. */
export function AccountsPage({ canProvision }: { canProvision: boolean }) {
  const t = useT();
  const router = useRouter();
  const labels = useConsoleLabels();
  const format = useConsoleFormat();
  const [data, setData] = useState<AccountList | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    try { setData(await consoleApi.accounts()); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Accounts didn't load.")); }
  }, [t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.accounts ?? []).filter((account) => (filter === "all" || account.state === filter) && (!query
      || [account.name, account.contactEmail ?? "", ...account.organizations.flatMap((org) => [org.name, org.slug, org.owner.email ?? ""])]
        .some((value) => value.toLowerCase().includes(query))));
  }, [data, filter, search]);

  const columns = useMemo<DataGridColumn<AccountSummary>[]>(() => [
    { id: "account", header: t("Account"), size: 280, accessorFn: (row) => row.name, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <Link href={`/internal/accounts/${row.id}`}>{row.name}</Link>
      <small>{row.organizations.length > 1 ? t("{count} organizations", { count: row.organizations.length }) : row.organizations[0]?.address}</small>
    </span> } },
    { id: "state", header: t("State"), size: 180, accessorFn: (row) => labels.state[row.state].label, meta: { renderCell: (row) => <span className={styles.stateCell}>
      <Badge tone={labels.state[row.state].tone}>{labels.state[row.state].label}</Badge>
      {row.attention.filter((reason) => reason !== "suspended" && reason !== "grace").slice(0, 1).map((reason) => <small key={reason}>{labels.attention[reason]}</small>)}
    </span> } },
    { id: "plan", header: t("Plan"), size: 130, accessorFn: (row) => row.plan?.code ?? "", meta: { renderCell: (row) => row.plan
      ? <span>{row.plan.code}{row.plan.version ? <span className={styles.muted}> · v{row.plan.version}</span> : null}</span>
      : <span className={styles.muted}>{t("Not set")}</span> } },
    { id: "seats", header: t("Seats"), size: 110, accessorFn: (row) => row.seats.members, meta: { align: "end", renderCell: (row) =>
      <span className={styles.number}>{row.seats.limit === null
        ? format.number(row.seats.members)
        : t("{used} of {allowed}", { used: format.number(row.seats.members), allowed: format.number(row.seats.limit) })}</span> } },
    { id: "activity", header: t("Last activity"), size: 150, accessorFn: (row) => row.lastActivityAt ?? "", meta: { renderCell: (row) => row.lastActivityAt
      ? <span title={format.dateTime(row.lastActivityAt)}>{format.relative(row.lastActivityAt)}</span>
      : <span className={styles.muted}>{t("None yet")}</span> } },
  ], [format, labels, t]);

  const create = canProvision ? <Button variant="primary" onPress={() => router.push("/internal/new")}>{t("Create tenant")}</Button> : null;
  const counts = data?.counts ?? {};
  const tabs = [
    { id: "all" as Filter, label: t("All"), count: data?.total },
    ...LIFECYCLE_STATES.filter((state) => counts[state]).map((state) => ({ id: state as Filter, label: labels.state[state].label, count: counts[state] })),
  ];

  if (error && !data) return <div className={styles.page}><PageHeader title={t("Accounts")} /><ErrorState description={error} onRetry={() => void load()} /></div>;
  return <div className={styles.page}>
    <PageHeader title={t("Accounts")} actions={create} />
    <DataGrid<AccountSummary>
      ariaLabel={t("Accounts")}
      columns={columns}
      data={visible}
      getRowId={(row) => row.id}
      isLoading={!data}
      onRowAction={(row) => router.push(`/internal/accounts/${row.id}`)}
      searchLabel={t("Search accounts")}
      searchValue={search}
      onSearchChange={setSearch}
      toolbarLeading={<ListTabs label={t("State")} items={tabs} value={filter} onChange={setFilter} />}
      emptyContent={search.trim() || filter !== "all"
        ? <NoResultsState onClear={() => { setSearch(""); setFilter("all"); }} />
        : <EmptyState title={t("No accounts yet")} description={t("Create the first tenant to start.")} action={create} />}
      rowNumbers={false}
      selectable={false}
      wrapText
    />
  </div>;
}
