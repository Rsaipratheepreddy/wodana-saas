"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { IconButton, InlineNotice, Spinner, Woddy } from "@/design-system";
import { AiPauseNotice } from "@/components/workspace/ai-pause-notice";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { askWoddyAgent, WoddyAskError, type WoddyAnswer, type WoddyAsk } from "@/lib/woddy/agent";
import { WoddyAnswerView } from "./woddy-answer";
import styles from "./woddy.module.css";

export type PrivateTurn = { id: string; question: string; state: "asking" | "answered" | "failed" | "paused"; answer?: WoddyAnswer; error?: string };

/**
 * "@Woddy …" typed where people write (a chat's reply box, a record's comments): the line goes to Woddy only,
 * with the record as context, and the answer stays private to the person who asked. A drafted reply is put
 * where they write, never sent.
 */
export function useWoddyPrivateAsk(workspaceId: string, base: Omit<WoddyAsk, "message" | "history">, onDraft?: (text: string) => void) {
  const [turns, setTurns] = useState<PrivateTurn[]>([]);
  const history = useRef<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const pending = useRef<AbortController | null>(null);
  const latest = useRef({ base, onDraft });
  useEffect(() => { latest.current = { base, onDraft }; });
  useEffect(() => () => pending.current?.abort(), []);
  const ask = useCallback(async (question: string) => {
    if (!question.trim() || pending.current) return;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    pending.current = controller;
    setTurns((current) => [...current, { id, question, state: "asking" }]);
    try {
      const answer = await askWoddyAgent(workspaceId, { ...latest.current.base, message: question, history: history.current.slice(-6) }, controller.signal);
      if (answer.answer.trim()) history.current.push({ role: "user", text: question }, { role: "assistant", text: answer.answer.trim().slice(0, 3000) });
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, state: "answered", answer } : turn));
      if (answer.draft) latest.current.onDraft?.(answer.draft.text);
    } catch (error) {
      if (controller.signal.aborted) return;
      const paused = error instanceof WoddyAskError && error.paused;
      setTurns((current) => current.map((turn) => turn.id === id ? { ...turn, state: paused ? "paused" : "failed", error: error instanceof Error ? error.message : undefined } : turn));
    } finally { if (pending.current === controller) pending.current = null; }
  }, [workspaceId]);
  const dismiss = useCallback((id: string) => setTurns((current) => current.filter((turn) => turn.id !== id)), []);
  return { turns, ask, dismiss, asking: turns.some((turn) => turn.state === "asking") };
}

export function WoddyPrivateReplies({ workspaceId, turns, onDismiss, draftPlaced = false }: { workspaceId: string; turns: PrivateTurn[]; onDismiss: (id: string) => void; draftPlaced?: boolean }) {
  const t = useT();
  return <>{turns.map((turn) => <article key={turn.id} className={styles.private} aria-label={t("Woddy's private reply")} aria-busy={turn.state === "asking"}>
    <header className={styles.privateHeader}>
      <Woddy decorative pose={turn.state === "asking" ? "thinking" : turn.state === "failed" ? "oops" : "idle"} size={24} />
      <strong>Woddy</strong><span>{t("Only you see this")}</span>
      <span><IconButton aria-label={t("Dismiss")} size="compact" variant="quiet" isDisabled={turn.state === "asking"} onPress={() => onDismiss(turn.id)}><X size={14} /></IconButton></span>
    </header>
    <p className={styles.question}>{turn.question}</p>
    {turn.state === "asking" ? <Spinner label={t("Woddy is typing…")} /> : null}
    {turn.state === "answered" && turn.answer ? <WoddyAnswerView workspaceId={workspaceId} answer={turn.answer} draftPlaced={draftPlaced} /> : null}
    {turn.state === "paused" ? <AiPauseNotice message={turn.error ?? t("AI credits are used up. Ask your admin to top up.")} /> : null}
    {turn.state === "failed" ? <InlineNotice tone="error" message={turn.error ? translateKnown(t, turn.error) : t("Woddy could not reply. Please try again.")} /> : null}
  </article>)}</>;
}
