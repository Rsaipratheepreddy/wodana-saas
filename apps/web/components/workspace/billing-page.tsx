"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { CreditCard } from "lucide-react";
import { Badge, Callout, DataGrid, EmptyState, Progress, SettingsPage, SettingsRow, SettingsSection, type DataGridColumn, type StatusTone } from "@/design-system";
import type { WorkspaceBillingData } from "@/lib/internal/types";
import styles from "./billing-page.module.css";

type BillingDocument = WorkspaceBillingData["documents"][number];

const planNames: Record<string, string> = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" };

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function money(amount: string | number, currency: string) {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-AE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Not scheduled";
}

function tone(status: string): StatusTone {
  if (["current", "active", "paid", "applied", "verified"].includes(status)) return "success";
  if (["past_due", "failed", "collections", "suspended", "closed", "expired", "refunded"].includes(status)) return "warning";
  if (["trial", "trial_uncontracted", "grace", "issued"].includes(status)) return "info";
  return "neutral";
}

const documentColumns: DataGridColumn<BillingDocument>[] = [
  { accessorKey: "documentNumber", header: "Document", size: 180, meta: { primary: true },
    cell: ({ row }) => row.original.documentNumber ?? humanize(row.original.documentType) },
  { accessorKey: "documentType", header: "Type", size: 130,
    cell: ({ row }) => humanize(row.original.documentType) },
  { accessorKey: "status", header: "Status", size: 125,
    cell: ({ row }) => <Badge tone={tone(row.original.status)}>{humanize(row.original.status)}</Badge> },
  { accessorKey: "totalAmount", header: "Total", size: 150, meta: { align: "end" },
    cell: ({ row }) => money(row.original.totalAmount, row.original.currency) },
  { accessorKey: "balanceAmount", header: "Balance", size: 150, meta: { align: "end" },
    cell: ({ row }) => money(row.original.balanceAmount, row.original.currency) },
  { accessorKey: "issuedAt", header: "Issued", size: 140, cell: ({ row }) => date(row.original.issuedAt) },
  { accessorKey: "dueAt", header: "Due", size: 140, cell: ({ row }) => date(row.original.dueAt) },
];

function Usage({ label, limit, value }: { label: string; limit: number; value: number }) {
  const t = useT();
  return <div className={styles.usage}>
    <small>{value} {t("of")}{" "}{limit}</small>
    <Progress label={`${label}: ${value} of ${limit}`} max={limit} value={value} />
  </div>;
}

export function BillingPage({ data }: { data: WorkspaceBillingData }) {
  const t = useT();
  const contract = "version" in data.contract ? data.contract : null;
  const allocation = "version" in data.organizationAllocation ? data.organizationAllocation : null;
  const collection = "version" in data.collection ? data.collection : null;
  const planName = contract ? (planNames[contract.planCode] ?? contract.planCode) : null;

  return <SettingsPage actions={<Badge tone={tone(data.accessPolicy.state)}>{humanize(data.accessPolicy.state)}</Badge>} title={t("Billing")}>
    {data.accessPolicy.warning ? <Callout title={t("Billing needs attention")} tone="warning">
      {data.accessPolicy.message}{data.accessPolicy.actionDueAt ? ` Review by ${date(data.accessPolicy.actionDueAt)}.` : ""}
    </Callout> : null}

    {!contract || !allocation ? <EmptyState icon={<CreditCard size={22}/>} title={t("Billing setup is incomplete")}
      description={t("Wodana needs to finish the account contract and this organization’s allocation. Existing workspace access is unchanged.")} /> : <>
      <SettingsSection id="plan" title={t("Plan")}>
        <SettingsRow label={t("Account plan")}><strong className={styles.value}>{planName}</strong><span>{money(contract.recurringAmount, contract.currency)} · {humanize(contract.billingCycle)}</span></SettingsRow>
        <SettingsRow label={t("Organization allocation")}><strong className={styles.value}>{money(allocation.allocatedAmount, contract.currency)}</strong><span>{allocation.seatLimit} {t("seats ·")}{" "}{allocation.projectLimit} {t("projects")}</span></SettingsRow>
        <SettingsRow label={t("Next renewal")}>{contract.renewsAt ? date(contract.renewsAt) : t("Not scheduled")}</SettingsRow>
        <SettingsRow label={t("Collection")}>{collection ? `${humanize(collection.status)} · ${money(collection.overdueAmount, collection.currency)} ${t("overdue")}` : t("Not configured")}</SettingsRow>
        {!data.accessPolicy.warning && data.accessPolicy.message ? <SettingsRow label={t("Access policy")}>{data.accessPolicy.message}</SettingsRow> : null}
      </SettingsSection>

      <SettingsSection id="usage" title={t("Usage")}>
        <SettingsRow hint={t("Pending invitations reserve seats.")} label={t("Reserved seats")}><Usage label={t("Reserved seats")} limit={allocation.seatLimit} value={data.usage.reservedSeats}/></SettingsRow>
        <SettingsRow label={t("Active projects")}><Usage label={t("Active projects")} limit={allocation.projectLimit} value={data.usage.projects}/></SettingsRow>
        {data.accountUsageSnapshot ? <SettingsRow hint={`${t("captured")} ${date(data.accountUsageSnapshot.capturedAt)}`} label={t("Account usage")}>
          {data.accountUsageSnapshot.totals.members} {t("members")} · {data.accountUsageSnapshot.totals.projects} {t("projects")}
        </SettingsRow> : null}
      </SettingsSection>

      <SettingsSection id="documents" title={t("Invoices, credits and receipts")}>
        <DataGrid appearance="flush" ariaLabel="Billing documents" columns={documentColumns} data={data.documents}
          emptyTitle="No billing documents" emptyDescription="No invoice, credit note or receipt has been recorded for this account."
          getRowId={(row) => row.id} pageSize={10} pinFirstColumn={false} rowNumbers={false} selectable={false}
          showToolbar={false}/>
      </SettingsSection>
    </>}
  </SettingsPage>;
}
