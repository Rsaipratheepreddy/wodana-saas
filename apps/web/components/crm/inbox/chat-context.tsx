"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Link2, Plus } from "lucide-react";
import { Avatar, Badge, Button, InlineNotice, Skeleton, useDesignSystem } from "@/design-system";
import { crmRequest, label, type RecordData } from "@/lib/crm/client";
import { channelName, jobHref, jobName, type ChatContext, type InboxOwner } from "@/lib/crm/inbox";
import type { LeadOptions } from "@/lib/crm/lead-options";
import type { LeadsPageData } from "@/lib/crm/leads";
import { useT } from "@/lib/i18n/i18n-provider";
import { LeadEnquiryForm } from "../lead-enquiry-form";
import styles from "../crm-inbox.module.css";

const timeout = () => AbortSignal.timeout(20_000);

/**
 * "Create enquiry" from a chat: the staff enquiry form's data (options, fields, queues, the inbox's people as
 * owners), loaded when asked for. Shared by the contact panel and Woddy's suggestion above the chat.
 */
export function useEnquiryDraft(workspaceId: string, owners: InboxOwner[], membershipId: string | null) {
  const t = useT();
  const { regionLocale } = useDesignSystem();
  const [data, setData] = useState<LeadsPageData | null>(null);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  const start = useCallback(async () => {
    setBusy(true); setFailure("");
    try {
      const [leadOptions, enquiryFields, queues] = await Promise.all([
        crmRequest<LeadOptions>(workspaceId, "lead-options", "GET", undefined, timeout()),
        crmRequest<LeadsPageData["enquiryFields"]>(workspaceId, "enquiry-fields", "GET", undefined, timeout()).catch(() => undefined),
        crmRequest<LeadsPageData["queues"] | { data: LeadsPageData["queues"] }>(workspaceId, "queues", "GET", undefined, timeout()).catch(() => []),
      ]);
      const salesOwners = owners.map((owner) => ({ id: owner.id, displayName: owner.displayName, email: "", status: "active" }));
      setData({
        workspaceId, canView: true, defaultLocale: regionLocale, currentMembershipId: membershipId ?? undefined, leadOptions, enquiryFields,
        salesOwners, members: salesOwners, queues: Array.isArray(queues) ? queues : queues.data ?? [], assignmentPolicies: [], slaPolicies: [], intake: [], pipelines: [], items: [],
        nextCursor: null, referenceTime: new Date().toISOString(),
      });
    } catch (error) { setFailure(error instanceof Error ? error.message : t("The enquiry form could not be opened.")); }
    finally { setBusy(false); }
  }, [workspaceId, owners, membershipId, regionLocale, t]);
  return { data, start, clear: () => setData(null), busy, failure };
}

/** What a chat's enquiry form starts from: the contact, the channel and the client's words. */
export function enquiryPrefill(thread: RecordData, context: ChatContext | null, extra: { summary?: string | null } = {}) {
  const name = context?.party?.name ?? String(thread.partyName ?? "");
  const phone = context?.party?.contacts.find((contact) => contact.type === "phone")?.value;
  const email = context?.party?.contacts.find((contact) => contact.type === "email")?.value;
  const inbound = ((thread.messages ?? []) as RecordData[]).filter((message) => message.direction === "inbound").slice(-3).map((message) => String(message.bodyText ?? "")).join("\n");
  const placeholderName = /^whatsapp\s*\+?\d/i.test(name);
  return { party: { displayName: placeholderName ? "" : name, mobile: phone, email }, channel: String(thread.channel), summary: extra.summary ?? inbound };
}

/**
 * Beside a chat: who the client is and their enquiry, opportunity and project (each only when the
 * person may see that module), with Create enquiry (prefilled from the chat) and Link to an enquiry.
 */
export function ChatContextPanel({ workspaceId, thread, context, owners, membershipId, onFile }: {
  workspaceId: string; thread: RecordData; context: ChatContext | null; owners: InboxOwner[]; membershipId: string | null;
  /** "File into job": the one way a chat joins a job (it reports its own failures). */
  onFile: (job: { kind: "enquiry"; id: string }) => Promise<void>;
}) {
  const t = useT();
  const draft = useEnquiryDraft(workspaceId, owners, membershipId);
  const [linking, setLinking] = useState(false);
  const busy = linking || draft.busy, failure = draft.failure;
  if (!context) return <div className={styles.contactDetails}><Skeleton lines={6} /></div>;
  const name = context.party?.name ?? String(thread.partyName ?? t("Customer"));
  // Linking an enquiry files the chat into it (the job it belongs to from now on).
  const link = async (leadId: string) => {
    setLinking(true);
    try { await onFile({ kind: "enquiry", id: leadId }); } finally { setLinking(false); }
  };
  const phone = context.party?.contacts.find((contact) => contact.type === "phone")?.value;
  const email = context.party?.contacts.find((contact) => contact.type === "email")?.value;
  return <div className={styles.contactDetails}>
    <header><Avatar name={name} size="lg" /><h2>{name}</h2><span>{channelName(thread.channel, t)}</span></header>
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    <dl>
      {phone ? <div><dt>{t("Phone")}</dt><dd>{phone}</dd></div> : null}
      {email ? <div><dt>{t("Email")}</dt><dd>{email}</dd></div> : null}
      <div><dt>{t("Owner")}</dt><dd>{String(thread.ownerName ?? t("Unassigned"))}</dd></div>
      {context.job ? <div><dt>{t("Filed into")}</dt><dd><Link href={jobHref(context.job)}>{jobName(context.job)}</Link></dd></div> : null}
    </dl>
    <section className={styles.contextSection} aria-label={t("Enquiries")}>
      <h3>{t("Enquiries")}</h3>
      {context.enquiries === null ? null : !context.enquiries.length ? <p>{t("No enquiry yet.")}</p> : context.enquiries.map((enquiry) => <div className={styles.contextRecord} key={enquiry.id}>
        <Link href={`/workspace/crm/leads?lead=${enquiry.id}`}>{enquiry.reference}</Link><Badge tone={enquiry.id === context.leadId ? "info" : "neutral"}>{enquiry.id === context.leadId ? t("Linked") : label(enquiry.status)}</Badge>
        {enquiry.id !== context.leadId && thread.canSend ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void link(enquiry.id)}><Link2 aria-hidden="true" size={13} />{t("Link")}</Button> : null}
      </div>)}
      {thread.canSend && context.enquiries !== null ? <Button size="compact" isLoading={busy} onPress={() => void draft.start()}><Plus aria-hidden="true" size={14} />{t("Create enquiry")}</Button> : null}
    </section>
    {context.opportunities?.length ? <section className={styles.contextSection} aria-label={t("Opportunities")}><h3>{t("Opportunities")}</h3>{context.opportunities.map((opportunity) => <div className={styles.contextRecord} key={opportunity.id}>
      <Link href={`/workspace/crm/opportunities?record=${opportunity.id}`}>{opportunity.reference}</Link><span>{opportunity.stageName ?? label(opportunity.status)}</span>
    </div>)}</section> : null}
    {context.projects?.length ? <section className={styles.contextSection} aria-label={t("Projects")}><h3>{t("Projects")}</h3>{context.projects.map((project) => <div className={styles.contextRecord} key={project.id}>
      <Link href={`/workspace/projects/${project.id}/overview`}>{project.name}</Link><span>{project.managerName ?? label(project.status)}</span>
    </div>)}</section> : null}
    {draft.data ? <LeadEnquiryForm initialData={draft.data} prefill={enquiryPrefill(thread, context)}
      onClose={draft.clear} onSaved={async (leadId) => { draft.clear(); await link(leadId); }} /> : null}
  </div>;
}
