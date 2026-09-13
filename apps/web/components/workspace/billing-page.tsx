import { CalendarDays, CheckCircle2, CreditCard, FolderKanban, Users } from "lucide-react";
import type { WorkspaceBillingData } from "@/lib/internal/types";
import styles from "./billing-page.module.css";

const planNames: Record<string, string> = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" };
const statusNames: Record<string, string> = { trial: "Trial", active: "Active", past_due: "Past due", cancelled: "Cancelled" };

function money(amount: string, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)) : "Not scheduled";
}

function Usage({ icon, label, limit, value }: { icon: React.ReactNode; label: string; limit: number; value: number }) {
  const percent = Math.min(100, Math.round((value / limit) * 100));
  return <div className={styles.usage}><span className={styles.usageIcon}>{icon}</span><div><span><strong>{label}</strong><small>{value} of {limit}</small></span><div aria-label={`${label}: ${value} of ${limit}`} className={styles.track} role="progressbar" aria-valuemax={limit} aria-valuemin={0} aria-valuenow={value}><i style={{ inlineSize: `${percent}%` }}/></div></div></div>;
}

export function BillingPage({ data }: { data: WorkspaceBillingData }) {
  const subscription = data.subscription;
  return <section className={styles.page}>
    <header className={styles.header}><div><h1>Billing</h1><p>Your Wodana plan, renewal, and workspace limits.</p></div>{subscription ? <span className={styles.status} data-status={subscription.status}>{statusNames[subscription.status]}</span> : null}</header>
    {!subscription ? <div className={styles.empty}><CreditCard size={22}/><h2>No subscription assigned</h2><p>Ask Wodana to assign a plan to this workspace.</p></div> : <>
      <div className={styles.summary}>
        <div className={styles.plan}><p>Current plan</p><h2>{planNames[subscription.planCode]}</h2><span>{money(subscription.amount, subscription.currency)} · {subscription.billingCycle}</span></div>
        <dl><div><dt><CalendarDays size={15}/>Next renewal</dt><dd>{date(subscription.renewsAt)}</dd></div><div><dt><CheckCircle2 size={15}/>Workspace access</dt><dd>{data.workspace.status === "active" ? "Active" : "Suspended"}</dd></div></dl>
      </div>
      <section className={styles.section}><div><h2>Usage</h2><p>Current use against the limits assigned to this workspace.</p></div><div className={styles.usageGrid}><Usage icon={<Users size={16}/>} label="Team seats" limit={subscription.seatLimit} value={data.usage.members}/><Usage icon={<FolderKanban size={16}/>} label="Active projects" limit={subscription.projectLimit} value={data.usage.projects}/></div></section>
      <section className={styles.section}><div><h2>Billing management</h2><p>Wodana manages plan changes and renewal terms for your account.</p></div><div className={styles.explanation}><strong>Your Wodana subscription</strong><p>This page covers access to Wodana. Customer invoices and payment links created through QuickBooks or Zoho Books stay in those connected accounting accounts.</p></div></section>
    </>}
  </section>;
}
