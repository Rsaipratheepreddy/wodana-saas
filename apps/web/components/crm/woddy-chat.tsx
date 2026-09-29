"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUp, RotateCcw, Square, X } from "lucide-react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Avatar, Button, IconButton, InlineNotice, Woddy } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { askWoddyAgent, WoddyAskError, type WoddyAnswer, type WoddyAsk } from "@/lib/woddy/agent";
import { AiPauseNotice } from "@/components/workspace/ai-pause-notice";
import { WoddyAnswerView } from "@/components/woddy/woddy-answer";
import { submitChatOnEnter } from "./chat-composer";
import workspaceColors from "./crm-workspace-colors.module.css";
import styles from "./woddy-chat.module.css";
import { playFeedback } from "@/lib/feedback/sounds";

type RecordContext = { type: "lead" | "opportunity" | "customer" | "conversation" | "commercial" | "pre-project" | "project"; id: string; label: string };
type Selection = { type: "conversation" | "enquiry"; ids: string[] };
type Message = { role: "user" | "assistant"; text: string; answer?: WoddyAnswer };
type WoddyContextValue = {
  open: () => void;
  register: (record: RecordContext) => () => void;
  /** What the person has selected in a list (e.g. chats in the inbox): "these" in a question means them. */
  select: (selection: Selection) => () => void;
  selection: Selection | null;
  /** An open chat's reply box, so a reply Woddy drafts can be put there (never sent). */
  registerComposer: (conversationId: string, put: (text: string) => void) => () => void;
  /** Opens the chat and asks this question (⌘K → "Ask Woddy: …"). */
  ask: (question: string) => void;
};
const WoddyContext = createContext<WoddyContextValue | null>(null);

export function useWoddy() { return useContext(WoddyContext); }
export function useWoddyRecord(type: RecordContext["type"], id: string, label: string) {
  const register = useWoddy()?.register;
  useEffect(() => register?.({ type, id, label }), [register, type, id, label]);
}
export function useWoddySelection(type: Selection["type"], ids: string[]) {
  const select = useWoddy()?.select;
  const key = ids.join(",");
  useEffect(() => (key ? select?.({ type, ids: key.split(",") }) : undefined), [select, type, key]);
}
export function useWoddyComposer(conversationId: string, put: (text: string) => void) {
  const registerComposer = useWoddy()?.registerComposer;
  const latest = useRef(put);
  useEffect(() => { latest.current = put; });
  useEffect(() => registerComposer?.(conversationId, (text) => latest.current(text)), [registerComposer, conversationId]);
}

/**
 * The CRM records Woddy's tools act on; `undefined` keeps a screen's own assistant (commercial, planning
 * readiness and project delivery read their own facts).
 */
function agentContext(context: RecordContext | undefined): WoddyAsk["context"] | undefined {
  if (!context) return null;
  if (context.type === "lead") return { type: "enquiry", id: context.id, label: context.label };
  if (context.type === "opportunity" || context.type === "customer" || context.type === "conversation") return { type: context.type, id: context.id, label: context.label };
  return undefined;
}

export function WoddyProvider({ children, workspaceId }: { children: ReactNode; workspaceId: string }) {
  const [isOpen, setOpen] = useState(false);
  const [records, setRecords] = useState<RecordContext[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const composers = useRef(new Map<string, (text: string) => void>());
  const register = useCallback((record: RecordContext) => {
    setRecords((current) => [...current, record]);
    return () => setRecords((current) => current.filter((item) => item !== record));
  }, []);
  const select = useCallback((next: Selection) => {
    setSelection(next);
    return () => setSelection((current) => (current === next ? null : current));
  }, []);
  const registerComposer = useCallback((conversationId: string, put: (text: string) => void) => {
    composers.current.set(conversationId, put);
    return () => { if (composers.current.get(conversationId) === put) composers.current.delete(conversationId); };
  }, []);
  /** Puts a drafted reply into that chat's reply box; false when the chat isn't open. */
  const putDraft = useCallback((conversationId: string, text: string) => {
    const put = composers.current.get(conversationId);
    if (!put) return false;
    put(text);
    return true;
  }, []);
  const open = useCallback(() => setOpen(true), []);
  // A question handed over from elsewhere (the command palette); the chat asks it once and clears it.
  const [question, setQuestion] = useState<{ id: number; text: string } | null>(null);
  const ask = useCallback((text: string) => { setQuestion((current) => ({ id: (current?.id ?? 0) + 1, text })); setOpen(true); }, []);
  const asked = useCallback(() => setQuestion(null), []);
  const value = useMemo(() => ({ open, register, select, selection, registerComposer, ask }), [open, register, select, selection, registerComposer, ask]);
  const record = records.at(-1);
  return <WoddyContext.Provider value={value}>{children}<ChatPanel key={`${workspaceId}/${record?.type}/${record?.id}`} workspaceId={workspaceId} context={record} selection={selection} putDraft={putDraft} isOpen={isOpen} onOpenChange={setOpen} question={question} onAsked={asked} /></WoddyContext.Provider>;
}

function ChatPanel({ workspaceId, context, selection, putDraft, isOpen, onOpenChange, question = null, onAsked }: {
  workspaceId: string; context?: RecordContext; selection: Selection | null; putDraft: (conversationId: string, text: string) => boolean; isOpen: boolean; onOpenChange: (open: boolean) => void;
  question?: { id: number; text: string } | null; onAsked?: () => void;
}) {
  const t = useT();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftFailure, setDraftFailure] = useState("");
  const tools = agentContext(context);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState("");
  const request = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "end", behavior: "instant" }); }, [messages, busy]);
  useLayoutEffect(() => {
    const input = composerInput.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }, [draft, isOpen]);
  useEffect(() => {
    if (restoreFocus.current && !busy && isOpen && composerInput.current) {
      composerInput.current.focus();
      restoreFocus.current = false;
    }
  }, [busy, isOpen]);
  const send = async (question: string) => {
    if (!question.trim() || request.current || !workspaceId) return;
    const previous = messages;
    const next: Message[] = [...previous, { role: "user", text: question.trim() }];
    const controller = new AbortController();
    request.current = controller; restoreFocus.current = true; setBusy(true); setError(""); setPaused(""); setDraft(""); setDraftFailure(""); setMessages(next);
    try {
      if (tools !== undefined) {
        // Woddy with tools (W-1): reads answer at once, changes come back as cards to confirm.
        try {
          const answer = await askWoddyAgent(workspaceId, {
            message: question.trim(), surface: "panel", context: tools, selection,
            history: previous.filter((message) => message.text.trim()).slice(-10).map((message) => ({ role: message.role, text: message.text.slice(0, 3000) })),
          }, controller.signal);
          if (!controller.signal.aborted) { setMessages([...next, { role: "assistant", text: answer.answer, answer }]); playFeedback("reply"); }
        } catch (failure) {
          if (failure instanceof WoddyAskError && failure.paused) { setMessages(previous); setDraft(question); setPaused(failure.message); return; }
          throw failure;
        }
        return;
      }
      const response = await fetch(context?.type === "commercial" ? "/api/commercial-assist" : "/api/workspace/crm/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify(context?.type === "commercial" ? {workspaceId,caseId:context.id,question:question.trim(),messages:next.slice(-11)} : { workspaceId, context: context ? { type: context.type, id: context.id } : { type: "overview" }, messages: next.slice(-11) }) });
      const payload = await response.json().catch(() => null);
      if (controller.signal.aborted) throw new Error("Reply stopped");
      if (!response.ok && payload?.paused) { setMessages(previous); setDraft(question); setPaused(payload.message ?? t("AI credits are used up. Ask your admin to top up.")); return; }
      if (!response.ok || !payload?.answer) throw new Error(payload?.message ?? t("Woddy could not reply. Please try again."));
      if (!controller.signal.aborted) { setMessages([...next, { role: "assistant", text: payload.answer }]); playFeedback("reply"); }
    } catch (failure) {
      setMessages(previous); setDraft(question);
      if (!controller.signal.aborted) setError(failure instanceof Error ? translateKnown(t, failure.message) : t("Woddy could not reply."));
    } finally { request.current = null; setBusy(false); }
  };
  const prompts = context?.type === "commercial" ? [t("What is missing before I issue this quotation?"), t("Review the payment schedule"), t("Which catalog materials match this scope?")] : context ? [t("What should I do next?"), t("What information is missing?"), t("Draft a short follow-up")] : [t("What needs attention today?"), t("What is waiting for my approval?"), t("Explain the flow from enquiry to handover")];
  const recordHref = context?.type === "commercial" ? `/workspace/pre-projects/cases/${context.id}/quotations` : context ? `/workspace/crm/${context.type === "lead" ? "leads" : context.type === "opportunity" ? "opportunities" : context.type === "conversation" ? "conversations" : "customers"}?${context.type === "lead" ? "lead" : "record"}=${context.id}` : null;
  // A question handed over (⌘K → "Ask Woddy: …") is asked once, then cleared so a remount doesn't ask it again.
  useEffect(() => {
    if (!question || !isOpen) return;
    queueMicrotask(() => { onAsked?.(); void send(question.text); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, isOpen]);
  return <ModalOverlay className={styles.overlay} isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
    <Modal className={`${styles.panel} ${workspaceColors.theme}`}><Dialog aria-label={t("Woddy chat")} className={styles.dialog}>
      <header className={styles.header}><Woddy className={styles.avatar} decorative pose={error ? "oops" : busy ? "thinking" : messages.length ? "idle" : "hello"} size={40} /><div><Heading slot="title">Woddy</Heading><p>{t(context?.type === "commercial" ? "Your commercial copilot" : context ? "Your CRM copilot" : "Your copilot")}</p></div><IconButton aria-label={t("New Woddy chat")} isDisabled={busy || !messages.length} onPress={() => { setMessages([]); setError(""); setDraft(""); }}><RotateCcw size={16} /></IconButton><IconButton aria-label={t("Close Woddy chat")} onPress={() => onOpenChange(false)}><X size={18} /></IconButton></header>
      <div className={styles.context}><span>{t("Context")}</span><strong title={context?.label}>{context?.label ?? t("Today’s work")}</strong>{recordHref ? <Link href={recordHref} onClick={() => onOpenChange(false)}>{t("Open record")}</Link> : null}</div>
      <div className={styles.messages} role="log" aria-label={t("Conversation with Woddy")} aria-live="polite" aria-relevant="additions text">
        {!messages.length ? <div className={styles.welcome}><h3>{t("Hey, let’s move work forward.")}</h3><p>{t(context?.type === "commercial" ? "I read the latest catalogs, saved quotations, scope and payment schedules for each question. New catalog items are included automatically." : context ? "I can review this record, explain the next step, or help draft a follow-up." : "I can explain how work flows here and review today’s priorities. Open a record to ask about it.")}</p><div className={styles.prompts}>{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => void send(prompt)}>{prompt}</button>)}</div></div> : null}
        {messages.map((message, index) => <div className={styles.messageRow} data-role={message.role} key={index}>
          <span className={styles.messageAvatar}>{message.role === "assistant" ? <Woddy pose={index === messages.length - 1 && !busy && !error ? "celebrating" : "idle"} size={30} /> : <Avatar name={t("You")} size="sm" />}</span>
          <article className={styles.message} data-role={message.role} aria-label={t(message.role === "user" ? "Your message" : "Woddy reply")}><small>{message.role === "user" ? t("You") : "Woddy"}</small>
            {message.answer ? <WoddyAnswerView workspaceId={workspaceId} answer={message.answer} onUseDraft={(text) => {
              const chat = message.answer?.draft?.conversationId ?? (context?.type === "conversation" ? context.id : null);
              if (chat && putDraft(chat, text)) { setDraftFailure(""); onOpenChange(false); } else setDraftFailure(t("Open the chat to use this draft. Nothing was sent."));
            }} /> : <p>{message.text}</p>}</article>
        </div>)}
        {busy ? <div className={styles.messageRow} data-role="assistant"><span className={styles.messageAvatar}><Woddy pose="thinking" size={30} /></span><div className={styles.thinking} role="status" aria-label={t("Woddy is typing")}><span aria-hidden="true"><i /><i /><i /></span><span className="wd-visually-hidden">{t("Woddy is typing…")}</span></div></div> : null}<div ref={end} />
      </div>
      <footer className={styles.footer}>{paused ? <AiPauseNotice message={paused} /> : null}{draftFailure ? <InlineNotice tone="info" message={draftFailure} /> : null}{error ? <p className={styles.error} role="alert"><Woddy pose="oops" size={28} />{t("{error} Your question is ready to retry.", { error })}</p> : null}<form aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void send(draft); }}><label className="wd-sr-only" htmlFor="woddy-question">{t("Message Woddy")}</label><textarea ref={composerInput} autoFocus id="woddy-question" rows={1} maxLength={3000} placeholder={t("Ask Woddy…")} value={draft} readOnly={busy} aria-describedby="woddy-keyboard-hint" onChange={(event) => setDraft(event.target.value)} onKeyDown={submitChatOnEnter} />{busy ? <IconButton aria-label={t("Stop Woddy reply")} onPress={() => request.current?.abort()}><Square size={15} /></IconButton> : <Button className={styles.sendButton} type="submit" variant="primary" aria-label={t("Send message to Woddy")} isDisabled={!draft.trim() || !workspaceId} size="compact"><ArrowUp size={17} /></Button>}</form><small id="woddy-keyboard-hint">{t("Enter to send · Shift+Enter for a new line")}</small><small>{t(tools !== undefined ? "Woddy prepares changes; nothing happens until you confirm." : "AI suggestions, not actions. Review before using.")}<br />{t("Chat stays in this session; relevant context is sent to the AI model.")}</small></footer>
    </Dialog></Modal>
  </ModalOverlay>;
}
