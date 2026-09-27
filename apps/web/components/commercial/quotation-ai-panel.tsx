"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  FileText,
  Image,
  LayoutTemplate,
  Ruler,
  Sparkles,
  Square,
} from "lucide-react";
import type { Quote } from "@/lib/commercial/types";
import { roomNames } from "@/lib/commercial/room-builder";
import type { QuotationAnalysis } from "@/lib/commercial/quotation-assist";
import { Woddy, woddyPoseFor } from "@/design-system";
import s from "./quotation-workspace.module.css";

type Message = { id: string; role: "user" | "assistant"; text: string };
export function QuotationAiPanel({
  quote,
  workspaceId,
  caseId,
  disabled,
  selectedRooms,
  onProposal,
  onReview,
}: {
  quote: Quote;
  workspaceId: string;
  caseId: string;
  disabled: boolean;
  selectedRooms: string[];
  onProposal: (analysis: QuotationAnalysis) => void;
  onReview: () => void;
}) {
  const t = useT();
  const [prompt, setPrompt] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<QuotationAnalysis | null>(null);
  const request = useRef<AbortController | null>(null),
    conversation = useRef<HTMLDivElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    conversation.current?.scrollTo?.({
      top: conversation.current.scrollHeight,
      behavior: "instant",
    });
  }, [messages, busy]);
  const analyze = async (direction: string) => {
    if (busy || disabled) return;
    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text:
        direction.trim() || t("Suggest rooms and items from the requirements."),
    };
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setMessages((current) => [...current, message]);
    setPrompt("");
    try {
      const result = await fetch("/api/quotation-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          caseId,
          notes: message.text,
          currentRooms: roomNames(quote).map((name) => ({
            name,
            selected: selectedRooms.includes(name),
            items: quote.lines
              .filter((line) => line.room === name)
              .map((line) => ({
                title: line.title,
                workId: line.catalogLinks?.find((link) => link.role === "work")
                  ?.recordId,
                variantId: line.catalogLinks?.find(
                  (link) => link.role === "variant",
                )?.recordId,
              })),
          })),
          previousRequests: messages
            .filter((m) => m.role === "user")
            .slice(-3)
            .map((m) => m.text),
        }),
        signal: controller.signal,
      });
      const data = await result.json();
      if (!result.ok)
        throw new Error(data.message ?? t("Could not analyze the case."));
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.rooms))
        throw new Error(
          t("The assistant returned an incomplete response. Please try again."),
        );
      onProposal(data);
      setAnalysis(data);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.rooms.length
            ? `${data.summary}\n\n${t("Review the suggestions before adding them. Your existing items and prices will stay unchanged.")}`
            : data.summary ||
              t("No matching rooms were found. Try describing a room from Master Data."),
        },
      ]);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(
          error instanceof Error
            ? error.message
            : t("Could not analyze the case."),
        );
        setPrompt(message.text);
      }
    } finally {
      if (request.current === controller) {
        setBusy(false);
        request.current = null;
      }
    }
  };
  return (
    <section className={s.chat} aria-label={t("Woody quotation chat")}>
      <header className={s.chatHeader}>
        <Woddy className={s.woodyMark} decorative pose={error ? woddyPoseFor.error : busy ? woddyPoseFor.running : analysis ? woddyPoseFor.done : messages.length ? woddyPoseFor.idle : woddyPoseFor.empty} size={30} />
        <div>
          <strong>{t("Woody · AI assistant")}</strong>
          <small>{t("Suggest with AI. Edit manually anytime.")}</small>
        </div>
      </header>
      <div
        className={s.conversation}
        ref={conversation}
        role="log"
        aria-label={t("Quotation conversation")}
        aria-live="polite"
      >
        {!messages.length && (
          <div className={s.welcome}>
            <h2>{t("What would you like to add?")}</h2>
            <p>
              {t("Use your case references to suggest rooms, items and materials. You choose what to add; quantities and prices stay in your control.")}</p>
            <div className={s.sourceList}>
              {(
                [
                  [tKey("Requirements"), FileText],
                  [tKey("Client inspirations"), Image],
                  [tKey("Site layouts"), LayoutTemplate],
                  [tKey("Measurements"), Ruler],
                ] as const
              ).map(([label, Icon]) => (
                <span key={label}>
                  <Icon size={12} />
                  {t(label)}
                </span>
              ))}
            </div>
            <button
              className={s.promptStarter}
              disabled={disabled || busy}
              onClick={() =>
                void analyze(
                  t("Suggest rooms and items from all case requirements."),
                )
              }
            >
              <Sparkles size={13} />
              {t("Suggest from requirements")}</button>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={s.chatMessage}
            data-role={message.role}
          >
            <small>{message.role === "user" ? t("You") : "Woody"}</small>
            <p>{message.text}</p>
          </div>
        ))}
        {busy && (
          <p className={s.thinking} role="status">
            <Sparkles size={14} />
            {t("Reading the case and matching rooms…")}</p>
        )}
        {analysis && (
          <div className={s.chatReview}>
            <button className={s.linkButton} onClick={onReview}>
              <Check size={14} />
              {t("Review room suggestions")}</button>
            {Boolean(analysis.review?.length || analysis.notes?.length) && (
              <section>
                <h3>
                  {t("Details to review · {count}", {
                    count:
                      (analysis.review?.length ?? 0) +
                      (analysis.notes?.length ?? 0),
                  })}
                </h3>
                {[...(analysis.review ?? []), ...(analysis.notes ?? [])].map(
                  (note, i) => (
                    <p key={i}>{note}</p>
                  ),
                )}
              </section>
            )}
            <small>{t("Quantities and prices need your confirmation.")}</small>
          </div>
        )}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
      </div>
      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void analyze(prompt);
        }}
      >
        {!!selectedRooms.length && (
          <span className={s.chatContext}>
            {t(
              selectedRooms.length === 1
                ? "{count} selected room"
                : "{count} selected rooms",
              { count: selectedRooms.length },
            )}
          </span>
        )}
        <textarea
          aria-label={t("Message Woody")}
          placeholder={t("Describe your rooms or request additions…")}
          maxLength={2000}
          rows={3}
          disabled={disabled || busy}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (prompt.trim()) void analyze(prompt);
            }
          }}
        />
        <div>
          <small>
            {t(disabled ? "Read only" : "Review suggestions before adding")}
          </small>
          {busy ? (
            <button
              className={s.send}
              type="button"
              aria-label={t("Stop generation")}
              onClick={() => {
                request.current?.abort();
                setBusy(false);
              }}
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              className={s.send}
              type="submit"
              aria-label={t("Send message")}
              disabled={disabled || !prompt.trim()}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
