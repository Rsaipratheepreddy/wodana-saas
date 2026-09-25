"use client";
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
        direction.trim() || "Suggest rooms and items from the requirements.",
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
        throw new Error(data.message ?? "Could not analyze the case.");
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.rooms))
        throw new Error(
          "The assistant returned an incomplete response. Please try again.",
        );
      onProposal(data);
      setAnalysis(data);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: data.rooms.length
            ? `${data.summary}\n\nReview the suggestions before adding them. Your existing items and prices will stay unchanged.`
            : data.summary ||
              "No matching rooms were found. Try describing a room from Master Data.",
        },
      ]);
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(
          error instanceof Error
            ? error.message
            : "Could not analyze the case.",
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
    <section className={s.chat} aria-label="Woody quotation chat">
      <header className={s.chatHeader}>
        <span className={s.woodyMark}>
          <Sparkles size={16} />
        </span>
        <div>
          <strong>Woody · AI assistant</strong>
          <small>Suggest with AI. Edit manually anytime.</small>
        </div>
      </header>
      <div
        className={s.conversation}
        ref={conversation}
        role="log"
        aria-label="Quotation conversation"
        aria-live="polite"
      >
        {!messages.length && (
          <div className={s.welcome}>
            <h2>What would you like to add?</h2>
            <p>
              Use your case references to suggest rooms, items and materials.
              You choose what to add; quantities and prices stay in your
              control.
            </p>
            <div className={s.sourceList}>
              {(
                [
                  ["Requirements", FileText],
                  ["Client inspirations", Image],
                  ["Site layouts", LayoutTemplate],
                  ["Measurements", Ruler],
                ] as const
              ).map(([label, Icon]) => (
                <span key={label}>
                  <Icon size={12} />
                  {label}
                </span>
              ))}
            </div>
            <button
              className={s.promptStarter}
              disabled={disabled || busy}
              onClick={() =>
                void analyze(
                  "Suggest rooms and items from all case requirements.",
                )
              }
            >
              <Sparkles size={13} />
              Suggest from requirements
            </button>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={s.chatMessage}
            data-role={message.role}
          >
            <small>{message.role === "user" ? "You" : "Woody"}</small>
            <p>{message.text}</p>
          </div>
        ))}
        {busy && (
          <p className={s.thinking} role="status">
            <Sparkles size={14} />
            Reading the case and matching rooms…
          </p>
        )}
        {analysis && (
          <div className={s.chatReview}>
            <button className={s.linkButton} onClick={onReview}>
              <Check size={14} />
              Review room suggestions
            </button>
            {Boolean(analysis.review?.length || analysis.notes?.length) && (
              <section>
                <h3>
                  Details to review ·{" "}
                  {(analysis.review?.length ?? 0) +
                    (analysis.notes?.length ?? 0)}
                </h3>
                {[...(analysis.review ?? []), ...(analysis.notes ?? [])].map(
                  (note, i) => (
                    <p key={i}>{note}</p>
                  ),
                )}
              </section>
            )}
            <small>Quantities and prices need your confirmation.</small>
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
            {selectedRooms.length} selected{" "}
            {selectedRooms.length === 1 ? "room" : "rooms"}
          </span>
        )}
        <textarea
          aria-label="Message Woody"
          placeholder="Describe your rooms or request additions…"
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
            {disabled ? "Read only" : "Review suggestions before adding"}
          </small>
          {busy ? (
            <button
              className={s.send}
              type="button"
              aria-label="Stop generation"
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
              aria-label="Send message"
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
