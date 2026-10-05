"use client";

import { useEffect, useState } from "react";
import { FolderInput, Plus, Sparkles } from "lucide-react";
import { Button } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import { fillQuickReply, jobName, type ChatContext, type InboxInsights, type InboxOwner } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import { LeadEnquiryForm } from "../lead-enquiry-form";
import { enquiryPrefill, useEnquiryDraft } from "./chat-context";
import styles from "../crm-inbox.module.css";

const timeout = () => AbortSignal.timeout(30_000);

/**
 * Woddy beside a chat ("AI proposes, people confirm"): read once per new message. Without AI the server still
 * ranks the quick replies; a failure leaves the chat as it is.
 */
export function useChatInsights(workspaceId: string, conversationId: string, lastMessageId: string | null) {
  const [insights, setInsights] = useState<InboxInsights | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      crmRequest<InboxInsights>(workspaceId, `conversations/${conversationId}/insights`, "GET", undefined, timeout())
        .then((next) => { if (alive && next && Array.isArray(next.suggestedReplies)) setInsights(next); })
        .catch(() => { if (alive) setInsights((current) => current); });
    }, 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [workspaceId, conversationId, lastMessageId]);
  return insights;
}

/**
 * One calm line under the chat's header: what the client wants (Woddy's summary) and, while the contact has
 * no enquiry, "Create enquiry" prefilled with the enquiry type Woddy read and the client's words. Nothing is
 * saved until the person submits the form.
 */
export function WoddyLine({ workspaceId, thread, context, insights, owners, membershipId, onCreated }: {
  workspaceId: string; thread: RecordData; context: ChatContext | null; insights: InboxInsights | null; owners: InboxOwner[]; membershipId: string | null;
  onCreated: (leadId: string) => Promise<void>;
}) {
  const t = useT();
  const draft = useEnquiryDraft(workspaceId, owners, membershipId);
  const hasEnquiry = Boolean(thread.leadId) || Boolean(context?.job) || Boolean(context?.enquiries?.length);
  const offerEnquiry = Boolean(thread.canSend) && context !== null && context.enquiries !== null && !hasEnquiry && Boolean(thread.partyId);
  if (!insights?.summary && !offerEnquiry) return null;
  const type = insights?.suggestedEnquiryType;
  return <div className={styles.woddyLine} role="status">
    <Sparkles aria-hidden="true" size={14} />
    <p>
      {insights?.summary ? <span>{insights.summary}</span> : <span>{t("New contact, no enquiry yet.")}</span>}
      {offerEnquiry && type ? <span className={styles.woddyHint}>{t("Looks like {type}", { type: type.label })}</span> : null}
    </p>
    {offerEnquiry ? <Button size="compact" isLoading={draft.busy} onPress={() => void draft.start()}><Plus aria-hidden="true" size={14} />{t("Create enquiry")}</Button> : null}
    {draft.failure ? <small role="alert">{draft.failure}</small> : null}
    {draft.data ? <LeadEnquiryForm initialData={draft.data} prefill={enquiryPrefill(thread, context, { summary: insights?.summaryForEnquiry })}
      onClose={draft.clear} onSaved={async (leadId) => { draft.clear(); await onCreated(leadId); }} /> : null}
  </div>;
}

/** Up to three quick replies that fit the chat, above the reply box. A chip fills the draft; the person sends. */
export function SuggestedReplies({ insights, variables, onPick }: { insights: InboxInsights | null; variables: ChatContext["variables"]; onPick: (text: string) => void }) {
  const t = useT();
  if (!insights?.suggestedReplies?.length) return null;
  return <div className={styles.suggestedReplies} role="group" aria-label={t("Suggested replies")}>
    {insights.suggestedReplies.map((reply) => <button key={reply.id} type="button" title={reply.body} onClick={() => onPick(fillQuickReply(reply.body, variables))}>/{reply.shortcut}</button>)}
  </div>;
}

/** A known contact whose chat is not filed yet: the job proposed, filed on one click. */
export function JobSuggestion({ context, busy, onFile }: { context: ChatContext | null; busy: boolean; onFile: (job: NonNullable<ChatContext["suggestedJob"]>) => void }) {
  const t = useT();
  const job = context?.suggestedJob;
  if (!job || context?.job) return null;
  return <p className={styles.stateBar} data-tone="suggestion">
    <FolderInput aria-hidden="true" size={14} />
    <span>{t("Known contact · {job}", { job: jobName(job) })}</span>
    <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => onFile(job)}>{t("File into job")}</Button>
  </p>;
}
