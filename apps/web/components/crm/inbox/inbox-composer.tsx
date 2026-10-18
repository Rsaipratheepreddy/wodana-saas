"use client";

import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { CalendarClock, FileText, Lock, Paperclip, Send, StickyNote, UserRound, X, Zap } from "lucide-react";
import { Badge, Button, EmptyState, IconButton, InlineNotice, SearchInput, SegmentedControl, TextInput, useConfirmationDialog, useDesignSystem, useReadOnlyReason, FormDialog } from "@/design-system";
import { crmRequest, type RecordData } from "@/lib/crm/client";
import { ATTACH_ACCEPT, attachProblem, channelName, fileSizeText, fillQuickReply, fillTemplate, quickReplyQuery, renderTemplate, sendableKind, sendableTemplate, TEMPLATE_SOURCE_LABELS, TEMPLATE_STATUS, uploadAttachment, windowLeft, type ChatContext, type InboxOwner, type InboxTemplate, type QuickReply } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import { woddyInstruction } from "@/lib/woddy/agent";
import { submitChatOnEnter } from "../chat-composer";
import { ScheduleDialog } from "./scheduled-messages";
import styles from "../crm-inbox.module.css";
import parts from "./inbox-parts.module.css";
import { playFeedback } from "@/lib/feedback/sounds";

const timeout = () => AbortSignal.timeout(20_000);

export type ComposerLookups = { quickReplies: QuickReply[]; templates: InboxTemplate[]; owners: InboxOwner[]; canManage: boolean };

/**
 * The reply box: free text inside WhatsApp's 24-hour window (with its countdown), an approved template
 * outside it, "/" quick replies filled from the chat's records, and internal notes with @mentions.
 * A reply someone else sent since you opened the chat asks before sending.
 */
export function InboxComposer({ workspaceId, thread, lookups, variables, draft, onDraftChange, onSent, now, blocked, onAskWoddy, woddyBusy = false }: {
  workspaceId: string; thread: RecordData; lookups: ComposerLookups; variables: ChatContext["variables"];
  draft: string; onDraftChange: (value: string) => void; onSent: () => Promise<void>; now: number; blocked: string;
  /** "@Woddy …" is an instruction for Woddy, answered privately in the thread; it is never sent to the client. */
  onAskWoddy?: (instruction: string) => Promise<void> | void; woddyBusy?: boolean;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const readOnly = useReadOnlyReason();
  const id = thread.id;
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(""), [notice, setNotice] = useState("");
  const [picking, setPicking] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [mentions, setMentions] = useState<InboxOwner[]>([]);
  // One file per message, as WhatsApp sends it; the text becomes its caption.
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [later, setLater] = useState<{ bodyText?: string; templateId?: string; templateParameters?: string[] } | null>(null);
  const scheduleAttempt = useRef<{ key: string; id: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false), attempt = useRef<{ text: string; id: string; fileId: string } | null>(null);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const messages = (thread.messages ?? []) as RecordData[];
  const lastOutbound = [...messages].reverse().find((message) => message.direction === "outbound")?.id ?? null;
  // What the person saw when they started typing; a newer reply from someone else asks before sending.
  const seenOutbound = useRef<string | null | undefined>(undefined);
  if (seenOutbound.current === undefined) seenOutbound.current = lastOutbound;
  const mine = useRef(new Set<string>());
  const isWhatsApp = thread.channel === "whatsapp";
  const inboundAt = Date.parse(String(thread.lastInboundAt ?? ""));
  const left = windowLeft(thread.windowClosesAt ?? (Number.isFinite(inboundAt) ? new Date(inboundAt + 86_400_000).toISOString() : null), now);
  const windowClosed = isWhatsApp && left <= 0;
  const needsTemplate = mode === "reply" && windowClosed;
  const internal = mode === "note" || thread.channel === "internal";
  const clientName = String(thread.partyName ?? "").trim() || t("the client");
  const replyBlocked = mode === "reply" ? blocked : !thread.canSend ? blocked : "";
  const instruction = onAskWoddy ? woddyInstruction(draft) : null;
  const query = instruction === null ? quickReplyQuery(draft) : null;
  const replies = useMemo(() => query === null ? [] : lookups.quickReplies.filter((reply) => reply.status === "active" && reply.shortcut.startsWith(query)).slice(0, 8), [query, lookups.quickReplies]);
  const mentionQuery = mode === "note" && instruction === null ? /(?:^|\s)@([^\s@]*)$/.exec(draft)?.[1]?.toLowerCase() ?? null : null;
  const people = mentionQuery === null ? [] : lookups.owners.filter((owner) => owner.displayName.toLowerCase().includes(mentionQuery)).slice(0, 6);
  const popup: Array<{ id: string; label: string; detail?: string; pick: () => void }> = query !== null && mode === "reply"
    ? replies.map((reply) => ({ id: reply.id, label: `/${reply.shortcut}`, detail: reply.body, pick: () => { onDraftChange(fillQuickReply(reply.body, variables)); setHighlight(0); input.current?.focus(); } }))
    : people.map((person) => ({ id: person.id, label: person.displayName, pick: () => { onDraftChange(draft.replace(/@([^\s@]*)$/, `@${person.displayName} `)); setMentions((current) => current.some((item) => item.id === person.id) ? current : [...current, person]); setHighlight(0); input.current?.focus(); } }));
  useLayoutEffect(() => { if (input.current) { input.current.style.height = "auto"; input.current.style.height = `${Math.min(input.current.scrollHeight, 112)}px`; } }, [draft]);

  const send = async (body: { bodyText?: string; templateId?: string; templateParameters?: string[]; file?: File | null }, after?: () => void, confirmed = false): Promise<void> => {
    if (saving.current) return;
    const text = body.bodyText?.trim() ?? "";
    const attached = body.templateId ? null : body.file ?? null;
    const newer = lastOutbound && lastOutbound !== seenOutbound.current && !mine.current.has(lastOutbound);
    if (mode === "reply" && newer && !confirmed) {
      requestConfirmation({ title: t("Someone else replied"), body: t("A teammate replied since you opened this chat. Send yours too?"), confirmLabel: t("Send anyway"), confirmVariant: "primary", onConfirm: () => void send(body, after, true) });
      return;
    }
    if (attached && text && mode === "reply" && isWhatsApp && sendableKind(attached.name) === "audio") { setFailure(t("WhatsApp sends audio without a caption. Send the text as its own message.")); return; }
    const key = `${mode}:${body.templateId ?? ""}:${JSON.stringify(body.templateParameters ?? [])}:${text}:${attached ? `${attached.name}:${attached.size}:${attached.lastModified}` : ""}`;
    if (attempt.current?.text !== key) attempt.current = { text: key, id: crypto.randomUUID(), fileId: crypto.randomUUID() };
    saving.current = true; setBusy(true); setFailure(""); setNotice("");
    try {
      const note = mode === "note" || thread.channel === "internal";
      const mentioned = note ? mentions.filter((person) => text.includes(`@${person.displayName}`)).map((person) => person.id) : [];
      // The file is uploaded first (the same file again is the same upload), then sent with the text as its caption.
      const attachmentId = attached ? (await uploadAttachment(workspaceId, id, attempt.current.fileId, attached, AbortSignal.timeout(120_000))).id : null;
      const result = await crmRequest(workspaceId, `conversations/${id}/messages`, "POST", {
        direction: note ? "internal" : "outbound", ...(note ? {} : { purpose: "service" }),
        ...(body.templateId ? { templateId: body.templateId, ...(body.templateParameters ? { templateParameters: body.templateParameters } : {}) } : text ? { bodyText: text } : {}),
        ...(attachmentId ? { attachmentId } : {}), ...(mentioned.length ? { mentions: mentioned } : {}), clientMessageId: attempt.current.id,
      }, timeout());
      mine.current.add(result.id); seenOutbound.current = result.id;
      attempt.current = null; setMentions([]);
      if (attached) setFile(null);
      setNotice(note ? t("Note added") : t("Message queued"));
      if (!note) playFeedback("send");
      after?.();
      await onSent();
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Message could not be sent. Your draft is saved.")); }
    finally { saving.current = false; setBusy(false); input.current?.focus(); }
  };
  const canAttach = !busy && !readOnly && Boolean(thread.canSend) && !replyBlocked;
  // "Send later": a reply to the client (not a note, not a file), written now and sent at a chosen time.
  const canSendLater = mode === "reply" && thread.channel !== "internal" && !readOnly && Boolean(thread.canSend) && !replyBlocked && !file && instruction === null;
  const pick = (picked: File | null | undefined) => {
    if (!picked || !canAttach) return;
    const problem = attachProblem(picked);
    if (problem) { setFailure(t(problem.key, problem.values)); return; }
    setFailure(""); setFile(picked); input.current?.focus();
  };
  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault(); setDragging(false);
    pick(event.dataTransfer.files[0]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (popup.length && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowDown") setHighlight((index) => (index + 1) % popup.length);
      else if (event.key === "ArrowUp") setHighlight((index) => (index - 1 + popup.length) % popup.length);
      else if (event.key === "Escape") onDraftChange(draft.replace(/[/@]\S*$/, ""));
      else popup[Math.min(highlight, popup.length - 1)].pick();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); return; }
    submitChatOnEnter(event);
  };

  return <form className={styles.composer} data-mode={mode} data-dragging={dragging || undefined} aria-busy={busy}
    onDragOver={(event) => { if (canAttach && !needsTemplate && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={onDrop} onSubmit={async (event) => {
    event.preventDefault();
    // "@Woddy …" goes to Woddy only: nothing is sent to the client, not even as a note.
    if (instruction !== null) {
      if (instruction && !woddyBusy) { onDraftChange(""); await onAskWoddy?.(instruction); input.current?.focus(); }
      return;
    }
    if (replyBlocked || needsTemplate || (!draft.trim() && !file) || popup.length) return;
    await send({ bodyText: draft, file }, () => onDraftChange(""));
  }}>
    <div className={styles.composerTools}>
      {thread.channel !== "internal" ? <SegmentedControl label={t("Message type")} value={mode} onChange={(value) => { setMode(value as "reply" | "note"); setFailure(""); }} options={[{ id: "reply", label: t("Reply") }, { id: "note", label: t("Note") }]} /> : null}
      {/* E6-1: who reads this message, always in view. A note stays with the team and never reaches the client or the portal. */}
      {internal ? <span className={styles.audience} data-audience="internal" id={`audience-${id}`}><Lock aria-hidden="true" size={12} />{t("Internal · only the team")}</span>
        : <span className={styles.audience} data-audience="client" id={`audience-${id}`}><UserRound aria-hidden="true" size={12} />{t("To {name} · {channel}", { name: clientName, channel: channelName(thread.channel, t) })}</span>}
      {mode === "reply" && isWhatsApp && left > 0 && !replyBlocked ? <span className={styles.windowChip}>{t("Window closes in {time}", { time: left >= 3_600_000 ? t("{count} h", { count: Math.floor(left / 3_600_000) }) : t("{count} m", { count: Math.max(1, Math.floor(left / 60_000)) }) })}</span> : null}
      <span className={styles.toolSpacer} />
      {mode === "reply" && isWhatsApp ? <Button size="compact" variant="quiet" isDisabled={Boolean(replyBlocked)} onPress={() => setPicking(true)}><FileText aria-hidden="true" size={15} />{t("Templates")}</Button> : null}
      {mode === "reply" && !needsTemplate ? <IconButton aria-label={t("Quick replies")} size="compact" isDisabled={Boolean(replyBlocked)} onPress={() => { onDraftChange("/"); input.current?.focus(); }}><Zap size={15} /></IconButton> : null}
    </div>
    {replyBlocked ? <p className={styles.composerNotice}>{replyBlocked}{isWhatsApp && thread.whatsappConnected === false && lookups.canManage ? <> <Link href="/workspace/integrations">{t("Connect WhatsApp")}</Link></> : null}
      {thread.channel === "email" && !(thread.email as { via?: string | null } | null)?.via && lookups.canManage ? <> <Link href="/workspace/settings/inbox#inbox-email">{t("Set up email")}</Link></> : null}</p> : null}
    {needsTemplate && !replyBlocked ? <div className={styles.windowClosed}><p>{t("More than 24 hours since the client's last message. Choose a template to restart the chat.")}</p><Button size="compact" variant="primary" onPress={() => setPicking(true)}>{t("Choose template")}</Button></div> : null}
    {file && !needsTemplate ? <div className={styles.attachmentChip}>
      <FileText aria-hidden="true" size={16} /><span>{file.name}</span><small>{fileSizeText(file.size, locale)}</small>
      <IconButton aria-label={t("Remove file")} size="compact" variant="quiet" isDisabled={busy} onPress={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={14} /></IconButton>
    </div> : null}
    {!needsTemplate ? <div className={styles.composerInput} data-note={mode === "note" || undefined}>
      {popup.length ? <div className={styles.suggestions} role="listbox" id={`suggest-${id}`} aria-label={query !== null ? t("Quick replies") : t("People")}>
        {popup.map((item, index) => <button key={item.id} id={`suggest-${id}-${index}`} type="button" role="option" aria-selected={index === highlight} onMouseDown={(event) => event.preventDefault()} onClick={item.pick}><strong>{item.label}</strong>{item.detail ? <small>{item.detail}</small> : null}</button>)}
      </div> : query !== null && mode === "reply" ? <div className={styles.suggestions} role="status" data-empty={!lookups.quickReplies.some((reply) => reply.status === "active") || undefined}>{lookups.quickReplies.some((reply) => reply.status === "active")
        ? <><span>{t("No quick reply starts with /{query}", { query })}</span><Link href="/workspace/settings/inbox#new-quick-reply">{t("New quick reply")}</Link></>
        : <EmptyState illustration={null} icon={<Zap aria-hidden="true" size={18} />} title={t("No quick replies yet")}
          action={<Link className="wd-button" data-size="compact" data-variant="primary" href="/workspace/settings/inbox#new-quick-reply">{t("New quick reply")}</Link>} />}</div> : null}
      {mode === "note" ? <StickyNote aria-hidden="true" className={styles.noteMark} size={16} /> : null}
      <IconButton aria-label={t("Attach a file")} className={styles.attachButton} size="compact" variant="quiet" isDisabled={!canAttach || Boolean(file)} onPress={() => fileInput.current?.click()}><Paperclip size={17} /></IconButton>
      <input ref={fileInput} type="file" hidden accept={ATTACH_ACCEPT} tabIndex={-1} aria-hidden="true" onChange={(event) => { pick(event.target.files?.[0]); event.target.value = ""; }} />
      <label className="wd-visually-hidden" htmlFor={`message-${id}`}>{mode === "note" ? t("Note") : t("Message")}</label>
      <textarea ref={input} rows={1} id={`message-${id}`} value={draft} maxLength={4096} readOnly={busy || !thread.canSend}
        placeholder={file ? t("Add a caption") : mode === "note" ? t("Note for the team · @ to mention") : t("Type a message · / for quick replies")}
        role={popup.length ? "combobox" : undefined} aria-expanded={popup.length ? true : undefined} aria-controls={popup.length ? `suggest-${id}` : undefined}
        aria-activedescendant={popup.length ? `suggest-${id}-${Math.min(highlight, popup.length - 1)}` : undefined} aria-autocomplete={popup.length ? "list" : undefined}
        onChange={(event) => { onDraftChange(event.target.value); setNotice(""); setHighlight(0); }} onKeyDown={onKeyDown} aria-describedby={`audience-${id} message-help-${id}`} />
      {canSendLater ? <IconButton aria-label={t("Send later")} className={styles.attachButton} size="compact" variant="quiet" isDisabled={!draft.trim() || busy} onPress={() => setLater({ bodyText: draft.trim() })}><CalendarClock size={17} /></IconButton> : null}
      <Button className={styles.sendButton} aria-label={instruction !== null ? t("Ask Woddy") : mode === "note" ? t("Add note") : t("Send message")} variant="primary" type="submit" isDisabled={(!draft.trim() && !file) || (instruction === null ? Boolean(replyBlocked) : woddyBusy || !instruction)} isLoading={busy || (instruction !== null && woddyBusy)}><Send data-directional="true" size={19} /></Button>
    </div> : null}
    <div className={styles.composerFooter} id={`message-help-${id}`}><span role="status">{notice}</span><small>{instruction !== null ? t("Only Woddy reads this line. It is never sent.") : mode === "note" ? t("Only your team sees notes") : thread.signatureEnabled ? t("Signed with your first name") : t("Enter to send · Shift+Enter for a new line")}</small></div>
    {failure ? <InlineNotice action={isWhatsApp && windowClosed && mode === "reply" ? <Button size="compact" variant="quiet" onPress={() => setPicking(true)}>{t("Choose template")}</Button> : undefined} message={failure} tone="error" /> : null}
    {picking ? <TemplatePicker templates={lookups.templates} variables={variables} canManage={lookups.canManage} connected={thread.whatsappConnected !== false} onClose={() => setPicking(false)} onSend={async (template, templateParameters) => { setPicking(false); await send({ templateId: template.id, templateParameters }); }}
      onSendLater={readOnly ? undefined : (template, templateParameters) => { setPicking(false); setLater({ templateId: template.id, templateParameters }); }} /> : null}
    {later ? <ScheduleDialog title={later.templateId ? t("Send the template later") : t("Send later")} freeText={!later.templateId} windowClosesAt={isWhatsApp ? String(thread.windowClosesAt ?? "") || null : undefined}
      offerCancelOnReply onClose={() => setLater(null)} onSchedule={async (sendAt, { cancelOnReply }) => {
        const key = JSON.stringify(later);
        if (scheduleAttempt.current?.key !== key) scheduleAttempt.current = { key, id: crypto.randomUUID() };
        await crmRequest(workspaceId, `conversations/${id}/scheduled-messages`, "POST", { clientRequestId: scheduleAttempt.current.id, sendAt, cancelOnReply,
          ...(later.templateId ? { templateId: later.templateId, ...(later.templateParameters ? { templateParameters: later.templateParameters } : {}) } : { bodyText: later.bodyText }) }, timeout());
        scheduleAttempt.current = null;
        if (!later.templateId) onDraftChange("");
        setLater(null); setNotice(t("Scheduled"));
        await onSent();
      }} /> : null}
    {confirmationDialog}
  </form>;
}

/**
 * Approved templates with a preview filled from the chat's records. A value the chat does not have is named
 * with its field and can be typed for this one message; until it is, Send stays off.
 */
function TemplatePicker({ templates, variables, canManage, connected, onClose, onSend, onSendLater }: { templates: InboxTemplate[]; variables: ChatContext["variables"]; canManage: boolean; connected: boolean; onClose: () => void; onSend: (template: InboxTemplate, parameters?: string[]) => Promise<void>; onSendLater?: (template: InboxTemplate, parameters?: string[]) => void }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const matching = templates.filter((template) => `${template.code} ${template.body}`.toLowerCase().includes(search.trim().toLowerCase()));
  const usable = matching.filter(sendableTemplate);
  // Templates Meta hasn't approved (or has stopped) stay visible, greyed with their state, so nobody wonders where they went.
  const waiting = matching.filter((template) => !sendableTemplate(template));
  const noneApproved = !templates.some(sendableTemplate);
  const [chosen, setChosen] = useState<InboxTemplate | null>(null);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);
  const selected = chosen ?? usable[0] ?? null;
  const filled = selected ? fillTemplate(selected, variables) : null;
  const parameters = filled ? filled.parameters.map((value, index) => value || (typed[selected!.positions[index]] ?? "").trim()) : [];
  const stillMissing = filled?.missing.filter((item) => !(typed[item.position] ?? "").trim()) ?? [];
  const unmapped = filled?.missing.find((item) => !item.source);
  const fieldOf = (item: { position: number; source: keyof typeof TEMPLATE_SOURCE_LABELS | null }) => item.source ? t(TEMPLATE_SOURCE_LABELS[item.source]) : t("No field yet");
  return <FormDialog size="lg" title={t("Send a template")} onClose={onClose} isSubmitDisabled={!selected || stillMissing.length > 0} submitLabel={t("Send template")} onSubmit={async () => { if (!selected) return; setSending(true); await onSend(selected, filled?.missing.length ? parameters : undefined); setSending(false); }} secondaryAction={<>{onSendLater ? <Button isDisabled={sending || !selected || stillMissing.length > 0} onPress={() => { if (selected) onSendLater(selected, filled?.missing.length ? parameters : undefined); }}>{t("Send later")}</Button> : null}</>}>
    <div className={styles.templatePicker}>
      {!connected ? <EmptyState title={t("WhatsApp isn't connected")} action={canManage ? <Link className="wd-button" data-size="compact" data-variant="primary" href="/workspace/integrations">{t("Connect WhatsApp")}</Link> : undefined} />
        : noneApproved ? <EmptyState title={t("No approved templates yet")} action={canManage ? <Link className="wd-button" data-size="compact" data-variant="primary" href="/workspace/settings/inbox#inbox-templates">{t("New template")}</Link> : undefined} />
        : <SearchInput label={t("Search templates")} value={search} onChange={setSearch} />}
      {connected && !noneApproved && !matching.length ? <p className={parts.muted}>{t("No matching templates.")}</p> : null}
      {connected && (usable.length || waiting.length) ? <div className={styles.templateList} role="listbox" aria-label={t("Templates")}>
        {usable.map((template) => <button key={template.id} type="button" role="option" aria-selected={selected?.id === template.id} onClick={() => { setChosen(template); setTyped({}); }}><strong>{template.code}</strong><small>{template.locale}</small></button>)}
        {waiting.map((template) => { const status = TEMPLATE_STATUS[template.providerStatus ?? "pending"] ?? TEMPLATE_STATUS.pending; return <button key={template.id} type="button" role="option" aria-selected={false} aria-disabled="true" disabled data-waiting="true"
          title={template.providerReason ?? undefined}><strong>{template.code}</strong><small>{template.locale}</small><Badge tone={status.tone}>{!template.usable && template.providerStatus === "approved" ? t("Not numbered 1, 2, 3…") : t(status.label)}</Badge>{template.providerReason ? <small>{template.providerReason}</small> : null}</button>; })}
      </div> : null}
      {selected && filled ? <p className={parts.preview}>{renderTemplate(selected.body, parameters)}</p> : null}
      {filled?.missing.length ? <div className={styles.templateValues}>
        {filled.missing.map((item) => <TextInput key={`${selected!.id}:${item.position}`} maxLength={1024} label={`{{${item.position}}} · ${fieldOf(item)}`}
          description={item.source ? t("This chat has no value for it. Type it for this message.") : undefined} value={typed[item.position] ?? ""} onChange={(value) => setTyped((current) => ({ ...current, [item.position]: value }))} />)}
        {unmapped && canManage ? <Link href="/workspace/settings/inbox#inbox-templates">{t("Map its variables")}</Link> : null}
      </div> : null}
    </div>
  </FormDialog>;
}
