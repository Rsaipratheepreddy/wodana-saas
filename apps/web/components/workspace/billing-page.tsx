"use client";

import { CalendarDays, CheckCircle2, CreditCard, FolderKanban, Users } from "lucide-react";
import {
  Badge, Callout, Container, DataGrid, EmptyState, PageHeader, Progress, Surface,
  type DataGridColumn, type StatusTone,
} from "@/design-system";
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

function Usage({ icon, label, limit, value }: {
  icon: React.ReactNode;
  label: string;
  limit: number;
  value: number;
}) {
  return <div className={styles.usage}>
    <span className={styles.usageIcon}>{icon}</span>
    <div>
      <span><strong>{label}</strong><small>{value} of {limit}</small></span>
      <Progress label={`${label}: ${value} of ${limit}`} max={limit} value={value} />
    </div>
  </div>;
}

export function BillingPage({ data }: { data: WorkspaceBillingData }) {
  const contract = "version" in data.contract ? data.contract : null;
  const allocation = "version" in data.organizationAllocation ? data.organizationAllocation : null;
  const collection = "version" in data.collection ? data.collection : null;
  const planName = contract ? (planNames[contract.planCode] ?? contract.planCode) : null;

  return <Container as="section" className={styles.page} size="full">
    <PageHeader eyebrow="Account & billing" title="Billing"
      description="Contract, organization allocation, usage and finance-verified billing records."
      actions={<Badge tone={tone(data.accessPolicy.state)}>{humanize(data.accessPolicy.state)}</Badge>} />

    <Callout title={data.accessPolicy.warning ? "Billing needs attention" : "Access policy"}
      tone={data.accessPolicy.warning ? "warning" : "neutral"}>
      {data.accessPolicy.message}{data.accessPolicy.actionDueAt ? ` Review by ${date(data.accessPolicy.actionDueAt)}.` : ""}
    </Callout>

    {!contract || !allocation ? <EmptyState icon={<CreditCard size={22}/>} title="Billing setup is incomplete"
      description="Wodana needs to finish the account contract and this organization’s allocation. Existing workspace access is unchanged." /> : <>
      <Surface as="section" className={styles.summary} aria-label="Billing summary">
        <div><small>Account plan</small><strong>{planName}</strong><span>{money(contract.recurringAmount, contract.currency)} · {humanize(contract.billingCycle)}</span></div>
        <div><small>Organization allocation</small><strong>{money(allocation.allocatedAmount, contract.currency)}</strong><span>{allocation.seatLimit} seats · {allocation.projectLimit} projects</span></div>
        <div><small>Next renewal</small><strong>{date(contract.renewsAt)}</strong><span>{contract.renewsAt ? "Contract schedule" : "No date claimed"}</span></div>
        <div><small>Collection</small><strong>{collection ? humanize(collection.status) : "Not configured"}</strong><span>{collection ? `${money(collection.overdueAmount, collection.currency)} overdue` : "No collection state recorded"}</span></div>
      </Surface>

      <section className={styles.section}>
        <div className={styles.sectionIntro}><h2>Organization usage</h2><p>Live usage against this organization’s allocation. Pending invitations reserve seats.</p></div>
        <div className={styles.usageGrid}>
          <Usage icon={<Users size={16}/>} label="Reserved seats" limit={allocation.seatLimit} value={data.usage.reservedSeats}/>
          <Usage icon={<FolderKanban size={16}/>} label="Active projects" limit={allocation.projectLimit} value={data.usage.projects}/>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionIntro}><h2>Account usage</h2><p>The latest immutable account snapshot, separate from editable plan terms.</p></div>
        <div className={styles.accountUsage}>
          {data.accountUsageSnapshot ? <>
            <div><Users size={15}/><span><strong>{data.accountUsageSnapshot.totals.members}</strong><small>members</small></span></div>
            <div><FolderKanban size={15}/><span><strong>{data.accountUsageSnapshot.totals.projects}</strong><small>projects</small></span></div>
            <div><CalendarDays size={15}/><span><strong>{date(data.accountUsageSnapshot.capturedAt)}</strong><small>captured</small></span></div>
          </> : <span className={styles.muted}>No account usage snapshot has been captured yet.</span>}
        </div>
      </section>

      <section className={styles.documents}>
        <div className={styles.sectionIntro}><h2>Invoices, credits and receipts</h2><p>Only recorded document state is shown. A receipt is not marked verified without finance verification.</p></div>
        <DataGrid appearance="flush" ariaLabel="Billing documents" columns={documentColumns} data={data.documents}
          emptyTitle="No billing documents" emptyDescription="No invoice, credit note or receipt has been recorded for this account."
          getRowId={(row) => row.id} pageSize={10} pinFirstColumn={false} rowNumbers={false} selectable={false}
          showToolbar={false}/>
      </section>
    </>}

    <Callout title="Tax treatment is not validated" tone="neutral">
      Wodana records the billing facts above but does not claim regional tax compliance until a validated region pack is approved.
    </Callout>
    <div className={styles.truth}><CheckCircle2 size={15}/><span>Billing state never silently removes purchased modules. Suspension requires a separate audited lifecycle decision.</span></div>
  </Container>;
}
