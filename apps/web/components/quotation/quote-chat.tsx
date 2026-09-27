"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, ArrowUp, Check, ListChecks, Minus, PencilLine, Plus, RotateCcw, Ruler, Sparkles, Undo2, Wrench, X } from "lucide-react";
import { Badge, Button, Checkbox, IconButton, Skeleton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import { plain } from "@/lib/quotation/format";
import type { AiChange, AiProposal, BuilderLine, BuilderState, LineOp } from "@/lib/quotation/types";
import { AiAssistanceSetting } from "@/components/workspace/ai-assistance-setting";
import styles from "./quote-chat.module.css";

type Api = ReturnType<typeof quoteApi>;
type Turn = {
  id: string;
  role: "estimator" | "assistant";
  text: string;
  proposal?: AiProposal;
  picked?: Set<string>;
  state: "thinking" | "ready" | "applied" | "discarded" | "failed";
  applied?: number;
  undo?: LineOp[] | null;
  undone?: boolean;
};

/**
 * The quote assistant, like a coding assistant beside the file: say what the quote needs in your own
 * words ("kitchen: base cabinets 4.5 m, quartz worktop, 6 LED spots"), and it answers with the changes
 * it would make — added, changed, moved or removed lines — to tick and apply, or discard. Nothing
 * changes until you apply, and the last applied set can be undone. Prices always come from the catalog.
 */
/** What the rest of the builder can ask of the assistant: a draft, or a request in words. */
export type AssistantCommands = { draft: () => void; ask: (request: string) => void };

export function QuoteChat({ state, api, workspaceId, onApply, contextLine, onClearContext, onFocusLine, inputRef, commandsRef }: {
  state: BuilderState; api: Api; workspaceId: string;
  /** Sends the operations and returns the ids of the lines they touch (for the highlight). */
  onApply: (ops: LineOp[]) => void;
  contextLine: BuilderLine | null; onClearContext: () => void;
  onFocusLine: (lineId: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  commandsRef?: React.RefObject<AssistantCommands | null>;
}) {
  const t = useT();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (turns.length) scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [turns]);
  const assistant = state.assistant;

  const update = (id: string, patch: Partial<Turn>) => setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  const history = () => turns.filter((turn) => turn.state !== "thinking" && turn.state !== "failed").slice(-8)
    .map((turn) => ({ role: turn.role, text: turn.role === "assistant" ? describe(turn) : turn.text }));

  const ask = async (request: string, kind: "draft" | "edit") => {
    if (busy) return;
    const question = { id: crypto.randomUUID(), role: "estimator" as const, text: request, state: "ready" as const };
    const answer: Turn = { id: crypto.randomUUID(), role: "assistant", text: "", state: "thinking" };
    const earlier = history();
    setTurns((current) => [...current, question, answer]);
    setText(""); setBusy(true);
    try {
      const proposal = kind === "draft" ? await api.aiDraft() : await api.aiEdit(request, { history: earlier, focusLineIds: contextLine ? [contextLine.id] : [] });
      update(answer.id, { state: "ready", text: proposal.summary, proposal, picked: new Set(proposal.changes.map((change) => change.key)) });
    } catch (cause) {
      update(answer.id, { state: "failed", text: cause instanceof Error ? cause.message : t("The assistant didn't answer. Try again, or carry on by hand.") });
    } finally { setBusy(false); }
  };
  const send = () => { const request = text.trim(); if (request) void ask(request, "edit"); };

  const apply = (turn: Turn) => {
    if (!turn.proposal || !turn.picked?.size) return;
    const chosen = turn.proposal.changes.filter((change) => turn.picked!.has(change.key));
    const ops = proposalOps(chosen);
    onApply(ops);
    update(turn.id, { state: "applied", applied: chosen.length, undo: undoOps(ops, chosen, state.lines) });
  };
  const undo = (turn: Turn) => {
    if (!turn.undo?.length) return;
    onApply(turn.undo);
    update(turn.id, { undone: true });
  };

  const available = !assistant || assistant.available;
  useEffect(() => {
    if (!commandsRef) return;
    commandsRef.current = available ? { draft: () => void ask(t("Draft the quote from Planning"), "draft"), ask: (request) => void ask(request, "edit") } : null;
  });
  if (!available) return <div className={styles.off}>
    <Sparkles aria-hidden="true" size={22} />
    <strong>{assistant!.reason === "not_set_up" ? t("The assistant isn't set up yet") : assistant!.reason === "off" ? t("AI assistance is off") : t("You don't have the assistant")}</strong>
    <p>{assistant!.reason === "not_set_up" ? t("Your Wodana administrator connects the AI model; then it can be turned on in Settings.")
      : assistant!.reason === "off" ? t("An admin turns it on for the workspace. It only ever suggests; nothing changes until someone applies it.")
        : t("Ask an admin for AI assistance in your role.")}</p>
    {assistant!.canTurnOn ? <AiAssistanceSetting bare canManage workspaceId={workspaceId} /> : null}
  </div>;

  const starters = [
    { id: "draft", icon: Sparkles, label: t("Draft from Planning"), run: () => void ask(t("Draft the quote from Planning"), "draft"), primary: !state.lines.length },
    { id: "services", icon: Wrench, label: t("Add the site services"), run: () => void ask(t("Add the site services this work needs — protection, demolition, debris disposal and final cleaning — in the areas where they apply."), "edit") },
    { id: "measure", icon: Ruler, label: t("Fill quantities from the measurements"), run: () => void ask(t("Use the site measurements to set quantities or formulas on the lines that have none."), "edit") },
    { id: "missing", icon: ListChecks, label: t("What's missing?"), run: () => void ask(t("Compare the quote with the requirements and approved designs, and add what's missing."), "edit") },
  ];

  return <div className={styles.chat}>
    <div ref={scroller} className={styles.thread} aria-live="polite">
      {!turns.length ? <div className={styles.starters}>
        <p className={styles.hello}><Sparkles aria-hidden="true" size={16} />{t("Describe the work; I'll turn it into lines from your catalog.")}</p>
        {starters.map((starter) => <button key={starter.id} type="button" className={styles.starter} data-primary={starter.primary || undefined} disabled={busy} onClick={starter.run}>
          <starter.icon aria-hidden="true" size={15} /><span>{starter.label}</span><ArrowRight aria-hidden="true" data-directional="true" size={14} />
        </button>)}
      </div> : null}
      {turns.map((turn) => turn.role === "estimator"
        ? <div key={turn.id} className={styles.ask}>{turn.text}</div>
        : <AnswerView key={turn.id} turn={turn} state={state} onPick={(picked) => update(turn.id, { picked })} onApply={() => apply(turn)}
          onDiscard={() => update(turn.id, { state: "discarded" })} onUndo={() => undo(turn)} onFocusLine={onFocusLine} />)}
    </div>
    <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); send(); }}>
      {contextLine ? <span className={styles.context}>
        <span>{t("About: {name}", { name: contextLine.title || t("Untitled line") })}</span>
        <button type="button" aria-label={t("Stop pointing at this line")} onClick={onClearContext}><X aria-hidden="true" size={12} /></button>
      </span> : null}
      <textarea ref={inputRef} aria-label={t("Ask the assistant")} rows={2} maxLength={1000} value={text} disabled={busy}
        placeholder={contextLine ? t("Change this line — e.g. “make it 3.2 m” or “use walnut veneer”") : t("e.g. “Kitchen: base cabinets 4.5 m, quartz worktop, 6 LED spots”")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} />
      <div className={styles.composerFoot}>
        {turns.length && !busy ? <button type="button" className={styles.reset} onClick={() => setTurns([])}><RotateCcw aria-hidden="true" size={12} />{t("New chat")}</button> : <small>{t("Prices come from your catalog")}</small>}
        <IconButton type="submit" aria-label={t("Send")} size="compact" variant="primary" isDisabled={!text.trim() || busy} isLoading={busy}><ArrowUp aria-hidden="true" size={15} /></IconButton>
      </div>
    </form>
  </div>;
}

function AnswerView({ turn, state, onPick, onApply, onDiscard, onUndo, onFocusLine }: {
  turn: Turn; state: BuilderState; onPick: (picked: Set<string>) => void; onApply: () => void; onDiscard: () => void; onUndo: () => void; onFocusLine: (lineId: string) => void;
}) {
  const t = useT();
  if (turn.state === "thinking") return <div className={styles.answer} aria-busy="true"><span className={styles.thinking}><Sparkles aria-hidden="true" size={14} />{t("Working it out…")}</span><Skeleton lines={3} /></div>;
  if (turn.state === "failed") return <div className={styles.answer} data-failed><p>{turn.text}</p></div>;
  const proposal = turn.proposal!;
  const picked = turn.picked ?? new Set<string>();
  const all = proposal.changes.length > 0 && picked.size === proposal.changes.length;
  return <div className={styles.answer}>
    {turn.text ? <p>{turn.text}</p> : null}
    {proposal.changes.length ? <section className={styles.changes} data-state={turn.state} aria-label={t("Suggested changes")}>
      <header>
        <strong>{proposal.changes.length === 1 ? t("1 change") : t("{count} changes", { count: proposal.changes.length })}</strong>
        {turn.state === "ready" ? <button type="button" onClick={() => onPick(all ? new Set() : new Set(proposal.changes.map((change) => change.key)))}>{all ? t("Select none") : t("Select all")}</button> : null}
      </header>
      <ul>{proposal.changes.map((change) => <li key={change.key} data-action={change.action}>
        {turn.state === "ready" ? <Checkbox aria-label={t("Include this change")} isSelected={picked.has(change.key)}
          onChange={(on) => { const next = new Set(picked); if (on) next.add(change.key); else next.delete(change.key); onPick(next); }} /> : null}
        <ChangeRow change={change} state={state} onFocusLine={onFocusLine} />
      </li>)}</ul>
      {turn.state === "ready" ? <footer>
        <Button size="compact" variant="quiet" onPress={onDiscard}>{t("Discard")}</Button>
        <Button size="compact" variant="primary" isDisabled={!picked.size} onPress={onApply}>{picked.size === 1 ? t("Apply 1 change") : t("Apply {count} changes", { count: picked.size })}</Button>
      </footer> : <footer>
        <span className={styles.done}>{turn.state === "applied" ? <><Check aria-hidden="true" size={14} />{turn.undone ? t("Undone") : turn.applied === 1 ? t("Applied 1 change") : t("Applied {count} changes", { count: turn.applied ?? 0 })}</> : t("Discarded")}</span>
        {turn.state === "applied" && turn.undo?.length && !turn.undone ? <Button size="compact" variant="quiet" onPress={onUndo}><Undo2 aria-hidden="true" size={14} />{t("Undo")}</Button> : null}
      </footer>}
    </section> : null}
  </div>;
}

function ChangeRow({ change, state, onFocusLine }: { change: AiChange; state: BuilderState; onFocusLine: (lineId: string) => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const area = (id: string | null | undefined) => (id ? state.areas.find((item) => item.id === id)?.name : null) ?? t("General");
  const name = change.catalogName ?? change.fields.title ?? change.lineTitle ?? "";
  const quantity = change.fields.quantity ? `${plain(change.fields.quantity, locale)} ${change.fields.unit ?? ""}`.trim() : change.fields.formula ? `ƒ ${change.fields.formula}` : "";
  const Icon = change.action === "add" ? Plus : change.action === "remove" ? Minus : change.action === "move" ? ArrowRight : PencilLine;
  return <span className={styles.change}>
    <Icon aria-hidden="true" size={14} className={styles.changeIcon} />
    <span className={styles.changeText}>
      <span>
        {change.lineId ? <button type="button" className={styles.lineLink} onClick={() => onFocusLine(change.lineId!)}>{name}</button> : <strong>{name}</strong>}
        {change.action === "add" || change.action === "move" || change.fields.areaId !== undefined ? <> · {area(change.fields.areaId)}</> : null}
        {quantity ? <> · {quantity}</> : null}
        {change.action === "add" && !change.priced ? <> <Badge tone="warning">{t("No price yet")}</Badge></> : null}
      </span>
      {change.unknownArea ? <small>{t("“{area}” isn't an area of this project yet; it goes to General.", { area: change.unknownArea })}</small> : null}
      {change.why ? <small>{change.why}</small> : null}
    </span>
  </span>;
}

/** The changes the estimator ticked, as builder operations. New lines get fresh ids; existing ones carry their version. */
export function proposalOps(changes: AiChange[]): LineOp[] {
  return changes.map((change): LineOp => {
    const fields = Object.fromEntries(Object.entries(change.fields).filter(([, value]) => value !== undefined));
    if (change.action === "add") {
      const id = crypto.randomUUID();
      return change.catalogItemId ? { op: "catalog", itemId: change.catalogItemId, line: { id, ...fields } } : { op: "upsert", line: { id, ...fields } };
    }
    if (change.action === "remove") return { op: "delete", id: change.lineId!, version: change.lineVersion! };
    return { op: "upsert", line: { id: change.lineId!, version: change.lineVersion!, ...fields } };
  });
}

/** The assistant's answer as words the model can read back in the next turn. */
function describe(turn: Turn) {
  const changes = turn.proposal?.changes ?? [];
  const done = turn.state === "applied" && !turn.undone ? "applied" : turn.state === "discarded" || turn.undone ? "not applied" : "proposed";
  return `${turn.text} (${changes.length} change${changes.length === 1 ? "" : "s"} ${done}: ${changes.slice(0, 12).map((change) =>
    `${change.action} ${change.catalogName ?? change.fields.title ?? change.lineTitle ?? ""}`).join("; ")})`.slice(0, 600);
}

/**
 * How to take an applied set back: new lines are deleted, changed lines get their earlier values, and
 * removed lines come back as they were (a catalog line is re-added from the catalog).
 */
export function undoOps(ops: LineOp[], changes: AiChange[], before: BuilderLine[]): LineOp[] {
  const undo: LineOp[] = [];
  ops.forEach((op, index) => {
    const change = changes[index];
    if (change.action === "add") {
      const id = op.op === "catalog" || op.op === "upsert" ? op.line.id : null;
      if (id) undo.push({ op: "delete", id, version: 0 });
      return;
    }
    const line = before.find((item) => item.id === change.lineId);
    if (!line) return;
    if (change.action === "remove") {
      const fields = { title: line.title, description: line.description, unit: line.unit, quantity: line.quantity, rate: line.rate, areaId: line.areaId, workPackageId: line.workPackageId,
        kind: line.kind, formula: line.formula, length: line.length, width: line.width, height: line.height, count: line.count, note: line.note, optional: line.optional };
      const id = crypto.randomUUID();
      undo.push(line.catalogItemId ? { op: "catalog", itemId: line.catalogItemId, line: { id, ...fields } } : { op: "upsert", line: { id, ...fields } });
      return;
    }
    const previous = Object.fromEntries(Object.keys(change.fields).map((key) => [key, (line as Record<string, unknown>)[key] ?? null]));
    undo.push({ op: "upsert", line: { id: line.id, ...previous } });
  });
  return undo;
}
