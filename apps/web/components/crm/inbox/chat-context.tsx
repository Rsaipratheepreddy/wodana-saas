"use client";

import Link from "next/link";
import { useState } from "react";
import { Link2, Plus } from "lucide-react";
import { Avatar, Badge, Button, InlineNotice, Skeleton, useDesignSystem } from "@/design-system";
import { crmRequest, label, type RecordData } from "@/lib/crm/client";
import type { ChatContext, InboxOwner } from "@/lib/crm/inbox";
import type { LeadOptions } from "@/lib/crm/lead-options";
import type { LeadsPageData } from "@/lib/crm/leads";
import { useT } from "@/lib/i18n/i18n-provider";
import { LeadEnquiryForm } from "../lead-enquiry-form";
import styles from "../crm-inbox.module.css";

const timeout = () => AbortSignal.timeout(20_000);

/**
 * Beside a chat: who the client is and their enquiry, opportunity and project (each only when the
 * person may see that module), with Create enquiry (prefilled from the chat) and Link to an enquiry.
 */
export function ChatContextPanel({ workspaceId, thread, context, owners, membershipId, onLinked }: {
  workspaceId: string; thread: RecordData; context: ChatContext | null; owners: InboxOwner[]; membershipId: string | null; onLinked: () => Promise<void>;
}) {
  const t = useT();
  const { regionLocale } = useDesignSystem();
  const [creating, setCreating] = useState<LeadsPageData | null>(null);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  if (!context) return <div className={styles.contactDetails}><Skeleton lines={6} /></div>;
  const name = context.party?.name ?? String(thread.partyName ?? t("Customer"));
  const link = async (leadId: string) => {
    setBusy(true); setFailure("");
    try { await crmRequest(workspaceId, `conversations/${thread.id}`, "PATCH", { version: thread.version, leadId }, timeout()); await onLinked(); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The chat could not be linked.")); }
    finally { setBusy(false); }
  };
  const startEnquiry = async () => {
    setBusy(true); setFailure("");
    try {
      const [leadOptions, enquiryFields, queues] = await Promise.all([
        crmRequest<LeadOptions>(workspaceId, "lead-options", "GET", undefined, timeout()),
        crmRequest<LeadsPageData["enquiryFields"]>(workspaceId, "enquiry-fields", "GET", undefined, timeout()).catch(() => undefined),
        crmRequest<LeadsPageData["queues"] | { data: LeadsPageData["queues"] }>(workspaceId, "queues", "GET", undefined, timeout()).catch(() => []),
      ]);
      const salesOwners = owners.map((owner) => ({ id: owner.id, displayName: owner.displayName, email: "", status: "active" }));
      setCreating({
        workspaceId, canView: true, defaultLocale: regionLocale, currentMembershipId: membershipId ?? undefined, leadOptions, enquiryFields,
        salesOwners, members: salesOwners, queues: Array.isArray(queues) ? queues : queues.data ?? [], assignmentPolicies: [], slaPolicies: [], intake: [], pipelines: [], items: [],
        nextCursor: null, referenceTime: new Date().toISOString(),
      });
    } catch (error) { setFailure(error instanceof Error ? error.message : t("The enquiry form could not be opened.")); }
    finally { setBusy(false); }
  };
  const phone = context.party?.contacts.find((contact) => contact.type === "phone")?.value;
  const email = context.party?.contacts.find((contact) => contact.type === "email")?.value;
  const inbound = ((thread.messages ?? []) as RecordData[]).filter((message) => message.direction === "inbound").slice(-3).map((message) => String(message.bodyText ?? "")).join("\n");
  const placeholderName = /^whatsapp\s*\+?\d/i.test(name);
  return <div className={styles.contactDetails}>
    <header><Avatar name={name} size="lg" /><h2>{name}</h2><span>{label(thread.channel)}</span></header>
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    <dl>
      {phone ? <div><dt>{t("Phone")}</dt><dd>{phone}</dd></div> : null}
      {email ? <div><dt>{t("Email")}</dt><dd>{email}</dd></div> : null}
      <div><dt>{t("Owner")}</dt><dd>{String(thread.ownerName ?? t("Unassigned"))}</dd></div>
    </dl>
    <section className={styles.contextSection} aria-label={t("Enquiries")}>
      <h3>{t("Enquiries")}</h3>
      {context.enquiries === null ? null : !context.enquiries.length ? <p>{t("No enquiry yet.")}</p> : context.enquiries.map((enquiry) => <div className={styles.contextRecord} key={enquiry.id}>
        <Link href={`/workspace/crm/leads?lead=${enquiry.id}`}>{enquiry.reference}</Link><Badge tone={enquiry.id === context.leadId ? "info" : "neutral"}>{enquiry.id === context.leadId ? t("Linked") : label(enquiry.status)}</Badge>
        {enquiry.id !== context.leadId && thread.canSend ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void link(enquiry.id)}><Link2 aria-hidden="true" size={13} />{t("Link")}</Button> : null}
      </div>)}
      {thread.canSend && context.enquiries !== null ? <Button size="compact" isLoading={busy} onPress={() => void startEnquiry()}><Plus aria-hidden="true" size={14} />{t("Create enquiry")}</Button> : null}
    </section>
    {context.opportunities?.length ? <section className={styles.contextSection} aria-label={t("Opportunities")}><h3>{t("Opportunities")}</h3>{context.opportunities.map((opportunity) => <div className={styles.contextRecord} key={opportunity.id}>
      <Link href={`/workspace/crm/opportunities?record=${opportunity.id}`}>{opportunity.reference}</Link><span>{opportunity.stageName ?? label(opportunity.status)}</span>
    </div>)}</section> : null}
    {context.projects?.length ? <section className={styles.contextSection} aria-label={t("Projects")}><h3>{t("Projects")}</h3>{context.projects.map((project) => <div className={styles.contextRecord} key={project.id}>
      <Link href={`/workspace/projects/${project.id}/overview`}>{project.name}</Link><span>{project.managerName ?? label(project.status)}</span>
    </div>)}</section> : null}
    {creating ? <LeadEnquiryForm initialData={creating} prefill={{ party: { displayName: placeholderName ? "" : name, mobile: phone, email }, channel: String(thread.channel), summary: inbound }}
      onClose={() => setCreating(null)} onSaved={async (leadId) => { setCreating(null); await link(leadId); }} /> : null}
  </div>;
}
