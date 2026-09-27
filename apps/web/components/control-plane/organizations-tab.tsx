"use client";

import { useMemo } from "react";
import { Badge, RecordTable, EmptyState, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { AccountOrganization, AccountSummary } from "@/lib/internal/console";
import { useConsoleFormat, useConsoleLabels } from "./labels";
import styles from "./control-plane.module.css";

/** The account's organizations (workspaces); opening one makes it the organization the other tabs show. */
export function OrganizationsTab({ account, selected, onSelect }: { account: AccountSummary; selected: string; onSelect: (key: string) => void }) {
  const t = useT();
  const labels = useConsoleLabels();
  const format = useConsoleFormat();
  const columns = useMemo<DataGridColumn<AccountOrganization>[]>(() => [
    { id: "name", header: t("Organization"), size: 260, accessorFn: (row) => row.name, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <strong>{row.name}{row.workspaceId === selected ? <span className={styles.muted}> · {t("Shown")}</span> : null}</strong>
      <small dir="ltr">{row.address}</small>
    </span> } },
    { id: "state", header: t("State"), size: 130, accessorFn: (row) => row.state, meta: { renderCell: (row) =>
      <Badge tone={labels.state[row.state].tone}>{labels.state[row.state].label}</Badge> } },
    { id: "seats", header: t("Seats"), size: 110, accessorFn: (row) => row.seats.members, meta: { align: "end", renderCell: (row) =>
      <span className={styles.number}>{row.seats.limit === null ? format.number(row.seats.members)
        : t("{used} of {allowed}", { used: format.number(row.seats.members), allowed: format.number(row.seats.limit) })}</span> } },
    { id: "owner", header: t("Owner"), size: 220, accessorFn: (row) => row.owner.email ?? "" },
    { id: "created", header: t("Created"), size: 130, accessorFn: (row) => row.createdAt, meta: { renderCell: (row) => format.date(row.createdAt) } },
  ], [format, labels, selected, t]);
  return <div className={styles.panel}>
    <RecordTable<AccountOrganization> ariaLabel={t("Organizations")} columns={columns} data={account.organizations}
      getRowId={(row) => row.workspaceId} onRowAction={(row) => onSelect(row.key)} emptyContent={<EmptyState illustration={null} title={t("No organizations")} />}
      rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
  </div>;
}
