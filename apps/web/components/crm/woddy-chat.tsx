"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { WODDY_MARK_SRC } from "@/lib/brand/identity";
import Link from "next/link";
import { ArrowUp, RotateCcw, Square, X } from "lucide-react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Avatar, Button, IconButton } from "@/design-system";
import { submitChatOnEnter } from "./chat-composer";
import workspaceColors from "./crm-workspace-colors.module.css";
import styles from "./woddy-chat.module.css";

type RecordContext = { type: "lead" | "opportunity" | "customer" | "conversation" | "commercial"; id: string; label: string };
type Message = { role: "user" | "assistant"; text: string };
const WoddyContext = createContext<{ open: () => void; register: (record: RecordContext) => () => void } | null>(null);

export function useWoddy() { return useContext(WoddyContext); }
export function useWoddyRecord(type: RecordContext["type"], id: string, label: string) {
  const register = useWoddy()?.register;
  useEffect(() => register?.({ type, id, label }), [register, type, id, label]);
}

export function WoddyProvider({ children, workspaceId }: { children: ReactNode; workspaceId: string }) {
  const [isOpen, setOpen] = useState(false);
  const [records, setRecords] = useState<RecordContext[]>([]);
  const register = useCallback((record: RecordContext) => {
    setRecords((current) => [...current, record]);
    return () => setRecords((current) => current.filter((item) => item !== record));
  }, []);
  const open = useCallback(() => setOpen(true), []);
  const record = records.at(-1);
  return <WoddyContext.Provider value={{ open, register }}>{children}<ChatPanel key={`${workspaceId}/${record?.type}/${record?.id}`} workspaceId={workspaceId} context={record} isOpen={isOpen} onOpenChange={setOpen} /></WoddyContext.Provider>;
}

function ChatPanel({ workspaceId, context, isOpen, onOpenChange }: { workspaceId: string; context?: RecordContext; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    request.current = controller; restoreFocus.current = true; setBusy(true); setError(""); setDraft(""); setMessages(next);
    try {
      const response = await fetch(context?.type === "commercial" ? "/api/commercial-assist" : "/api/workspace/crm/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify(context?.type === "commercial" ? {workspaceId,caseId:context.id,question:question.trim(),messages:next.slice(-11)} : { workspaceId, context: context ? { type: context.type, id: context.id } : { type: "overview" }, messages: next.slice(-11) }) });
      const payload = await response.json().catch(() => null);
      if (controller.signal.aborted) throw new Error("Reply stopped");
      if (!response.ok || !payload?.answer) throw new Error(payload?.message ?? "Woddy could not reply. Please try again.");
      if (!controller.signal.aborted) setMessages([...next, { role: "assistant", text: payload.answer }]);
    } catch (failure) {
      setMessages(previous); setDraft(question);
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Woddy could not reply.");
    } finally { request.current = null; setBusy(false); }
  };
  const prompts = context?.type === "commercial" ? ["What is missing before I issue this quotation?", "Review the payment schedule", "Which catalog materials match this scope?"] : context ? ["What should I do next?", "What information is missing?", "Draft a short follow-up"] : ["Explain the CRM flow", "What needs attention today?", "How does lead manager assignment work?"];
  const recordHref = context?.type === "commercial" ? `/workspace/pre-projects/cases/${context.id}/quotations` : context ? `/workspace/crm/${context.type === "lead" ? "leads" : context.type === "opportunity" ? "opportunities" : context.type === "conversation" ? "conversations" : "customers"}?${context.type === "lead" ? "lead" : "record"}=${context.id}` : null;
  return <ModalOverlay className={styles.overlay} isOpen={isOpen} onOpenChange={onOpenChange} isDismissable>
    <Modal className={`${styles.panel} ${workspaceColors.theme}`}><Dialog aria-label="Woddy chat" className={styles.dialog}>
      <header className={styles.header}><Image alt="" src={WODDY_MARK_SRC} width={40} height={40} className={styles.avatar} /><div><Heading slot="title">Woddy</Heading><p>{context?.type === "commercial" ? "Your commercial copilot" : "Your CRM copilot"}</p></div><IconButton aria-label="New Woddy chat" isDisabled={busy || !messages.length} onPress={() => { setMessages([]); setError(""); setDraft(""); }}><RotateCcw size={16} /></IconButton><IconButton aria-label="Close Woddy chat" onPress={() => onOpenChange(false)}><X size={18} /></IconButton></header>
      <div className={styles.context}><span>Context</span><strong title={context?.label}>{context?.label ?? "CRM · Today’s work queue"}</strong>{recordHref ? <Link href={recordHref} onClick={() => onOpenChange(false)}>Open record</Link> : null}</div>
      <div className={styles.messages} role="log" aria-label="Conversation with Woddy" aria-live="polite" aria-relevant="additions text">
        {!messages.length ? <div className={styles.welcome}><h3>Hey, let’s move work forward.</h3><p>{context?.type === "commercial" ? "I read the latest catalogs, saved quotations, scope and payment schedules for each question. New catalog items are included automatically." : context ? "I can review this record, explain the next step, or help draft a follow-up." : "I can explain the CRM and review today’s priorities. Open a lead, opportunity or customer to ask about that record."}</p><div className={styles.prompts}>{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => void send(prompt)}>{prompt}</button>)}</div></div> : null}
        {messages.map((message, index) => <div className={styles.messageRow} data-role={message.role} key={index}>
          <span className={styles.messageAvatar}>{message.role === "assistant" ? <Image alt="Woddy" src={WODDY_MARK_SRC} width={30} height={30} /> : <Avatar name="You" size="sm" />}</span>
          <article className={styles.message} data-role={message.role} aria-label={message.role === "user" ? "Your message" : "Woddy reply"}><small>{message.role === "user" ? "You" : "Woddy"}</small><p>{message.text}</p></article>
        </div>)}
        {busy ? <div className={styles.messageRow} data-role="assistant"><span className={styles.messageAvatar}><Image alt="Woddy" src={WODDY_MARK_SRC} width={30} height={30} /></span><div className={styles.thinking} role="status" aria-label="Woddy is typing"><span aria-hidden="true"><i /><i /><i /></span><span className="wd-visually-hidden">Woddy is typing…</span></div></div> : null}<div ref={end} />
      </div>
      <footer className={styles.footer}>{error ? <p className={styles.error} role="alert">{error} Your question is ready to retry.</p> : null}<form aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void send(draft); }}><label className="wd-sr-only" htmlFor="woddy-question">Message Woddy</label><textarea ref={composerInput} autoFocus id="woddy-question" rows={1} maxLength={3000} placeholder="Ask Woddy…" value={draft} readOnly={busy} aria-describedby="woddy-keyboard-hint" onChange={(event) => setDraft(event.target.value)} onKeyDown={submitChatOnEnter} />{busy ? <IconButton aria-label="Stop Woddy reply" onPress={() => request.current?.abort()}><Square size={15} /></IconButton> : <Button className={styles.sendButton} type="submit" variant="primary" aria-label="Send message to Woddy" isDisabled={!draft.trim() || !workspaceId} size="compact"><ArrowUp size={17} /></Button>}</form><small id="woddy-keyboard-hint">Enter to send · Shift+Enter for a new line</small><small>AI suggestions, not actions. Review before using.<br />Chat stays in this session; relevant context is sent to Gemini.</small></footer>
    </Dialog></Modal>
  </ModalOverlay>;
}
