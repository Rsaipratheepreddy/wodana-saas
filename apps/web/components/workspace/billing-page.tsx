"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { CreditCard } from "lucide-react";
import { Badge, Callout, DataGrid, EmptyState, Progress, SettingsPage, SettingsRow, SettingsSection, useDesignSystem, type DataGridColumn, type StatusTone } from "@/design-system";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import type { WorkspaceBillingData } from "@/lib/internal/types";
import styles from "./billing-page.module.css";

type BillingDocument = WorkspaceBillingData["documents"][number];

const planNames: Record<string, MessageKey> = { starter: tKey("Starter"), pro: tKey("Pro"), enterprise: tKey("Enterprise") };

/** Billing states, document types and cycles as people read them. */
const VALUE_LABELS: Record<string, MessageKey> = {
  not_configured: tKey("Not configured"), trial: tKey("Trial"), trial_expired: tKey("Trial expired"), trial_uncontracted: tKey("Trial uncontracted"),
  contracted: tKey("Contracted"), current: tKey("Current"), grace: tKey("Grace"), past_due: tKey("Past due"), collections: tKey("Collections"),
  suspended: tKey("Suspended"), closed: tKey("Closed"), expired: tKey("Expired"), draft: tKey("Draft"), issued: tKey("Issued"), paid: tKey("Paid"),
  applied: tKey("Applied"), verified: tKey("Verified"), failed: tKey("Failed"), void: tKey("Void"), refunded: tKey("Refunded"),
  invoice: tKey("Invoice"), credit_note: tKey("Credit note"), receipt: tKey("Receipt"), monthly: tKey("Monthly"), yearly: tKey("Yearly"), custom: tKey("Custom"),
};

function humanize(value: string, t: Translate) {
  return VALUE_LABELS[value] ? t(VALUE_LABELS[value]) : value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

type Format = { locale: string; timeZone: string };

function money(amount: string | number, currency: string, format: Format) {
  return new Intl.NumberFormat(format.locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
}

function date(value: string | null, t: Translate, format: Format) {
  return value ? new Intl.DateTimeFormat(format.locale, { day: "numeric", month: "short", year: "numeric", timeZone: format.timeZone }).format(new Date(value)) : t("Not scheduled");
}

function tone(status: string): StatusTone {
  if (["current", "active", "paid", "applied", "verified"].includes(status)) return "success";
  if (["past_due", "failed", "collections", "suspended", "closed", "expired", "refunded"].includes(status)) return "warning";
  if (["trial", "trial_uncontracted", "grace", "issued"].includes(status)) return "info";
  return "neutral";
}

const documentColumns = (t: Translate, format: Format): DataGridColumn<BillingDocument>[] => [
  { accessorKey: "documentNumber", header: t("Document"), size: 180, meta: { primary: true },
    cell: ({ row }) => row.original.documentNumber ?? humanize(row.original.documentType, t) },
  { accessorKey: "documentType", header: t("Type"), size: 130,
    cell: ({ row }) => humanize(row.original.documentType, t) },
  { accessorKey: "status", header: t("Status"), size: 125,
    cell: ({ row }) => <Badge tone={tone(row.original.status)}>{humanize(row.original.status, t)}</Badge> },
  { accessorKey: "totalAmount", header: t("Total"), size: 150, meta: { align: "end" },
    cell: ({ row }) => money(row.original.totalAmount, row.original.currency, format) },
  { accessorKey: "balanceAmount", header: t("Balance"), size: 150, meta: { align: "end" },
    cell: ({ row }) => money(row.original.balanceAmount, row.original.currency, format) },
  { accessorKey: "issuedAt", header: t("Issued"), size: 140, cell: ({ row }) => date(row.original.issuedAt, t, format) },
  { accessorKey: "dueAt", header: t("Due"), size: 140, cell: ({ row }) => date(row.original.dueAt, t, format) },
];

function Usage({ label, limit, value }: { label: string; limit: number; value: number }) {
  const t = useT();
  return <div className={styles.usage}>
    <small>{t("{value} of {limit}", { value, limit })}</small>
    <Progress label={t("{label}: {value} of {limit}", { label, value, limit })} max={limit} value={value} />
  </div>;
}

export function BillingPage({ data }: { data: WorkspaceBillingData }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const format = { locale, timeZone };
  const contract = "version" in data.contract ? data.contract : null;
  const allocation = "version" in data.organizationAllocation ? data.organizationAllocation : null;
  const collection = "version" in data.collection ? data.collection : null;
  const planName = contract ? (planNames[contract.planCode] ? t(planNames[contract.planCode]) : contract.planCode) : null;

  return <SettingsPage actions={<Badge tone={tone(data.accessPolicy.state)}>{humanize(data.accessPolicy.state, t)}</Badge>} title={t("Billing")}>
    {data.accessPolicy.warning ? <Callout title={t("Billing needs attention")} tone="warning">
      {data.accessPolicy.message}{data.accessPolicy.actionDueAt ? ` ${t("Review by {date}.", { date: date(data.accessPolicy.actionDueAt, t, format) })}` : ""}
    </Callout> : null}

    {!contract || !allocation ? <EmptyState icon={<CreditCard size={22}/>} title={t("Billing setup is incomplete")}
      description={t("Wodana needs to finish the account contract and this organization’s allocation. Existing workspace access is unchanged.")} /> : <>
      <SettingsSection id="plan" title={t("Plan")}>
        <SettingsRow label={t("Account plan")}><strong className={styles.value}>{planName}</strong><span>{money(contract.recurringAmount, contract.currency, format)} · {humanize(contract.billingCycle, t)}</span></SettingsRow>
        <SettingsRow label={t("Organization allocation")}><strong className={styles.value}>{money(allocation.allocatedAmount, contract.currency, format)}</strong><span>{t("{seats} seats · {projects} projects", { seats: allocation.seatLimit, projects: allocation.projectLimit })}</span></SettingsRow>
        <SettingsRow label={t("Next renewal")}>{contract.renewsAt ? date(contract.renewsAt, t, format) : t("Not scheduled")}</SettingsRow>
        <SettingsRow label={t("Collection")}>{collection ? `${humanize(collection.status, t)} · ${t("{amount} overdue", { amount: money(collection.overdueAmount, collection.currency, format) })}` : t("Not configured")}</SettingsRow>
        {!data.accessPolicy.warning && data.accessPolicy.message ? <SettingsRow label={t("Access policy")}>{data.accessPolicy.message}</SettingsRow> : null}
      </SettingsSection>

      <SettingsSection id="usage" title={t("Usage")}>
        <SettingsRow hint={t("Pending invitations reserve seats.")} label={t("Reserved seats")}><Usage label={t("Reserved seats")} limit={allocation.seatLimit} value={data.usage.reservedSeats}/></SettingsRow>
        <SettingsRow label={t("Active projects")}><Usage label={t("Active projects")} limit={allocation.projectLimit} value={data.usage.projects}/></SettingsRow>
        {data.accountUsageSnapshot ? <SettingsRow hint={t("captured {date}", { date: date(data.accountUsageSnapshot.capturedAt, t, format) })} label={t("Account usage")}>
          {t("{members} members · {projects} projects", { members: data.accountUsageSnapshot.totals.members, projects: data.accountUsageSnapshot.totals.projects })}
        </SettingsRow> : null}
      </SettingsSection>

      <SettingsSection id="documents" title={t("Invoices, credits and receipts")}>
        <DataGrid appearance="flush" ariaLabel={t("Billing documents")} columns={documentColumns(t, format)} data={data.documents}
          emptyTitle={t("No billing documents")} emptyDescription={t("No invoice, credit note or receipt has been recorded for this account.")}
          getRowId={(row) => row.id} pageSize={10} pinFirstColumn={false} rowNumbers={false} selectable={false}
          showToolbar={false}/>
      </SettingsSection>
    </>}
  </SettingsPage>;
}
