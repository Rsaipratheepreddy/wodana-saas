"use client";

import { useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { Badge, Button, Checkbox, IconButton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import { plain } from "@/lib/quotation/format";
import type { AiChange, AiProposal, BuilderState, LineOp } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

type Api = ReturnType<typeof quoteApi>;

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

/**
 * Ask in plain words ("add a false ceiling in the living room, 18 m²", "move the TV unit to the
 * family room"); the assistant proposes changes, and nothing happens until they're ticked and applied.
 */
export function QuoteAssistant({ state, api, onApply, onError, starting }: { state: BuilderState; api: Api; onApply: (ops: LineOp[]) => void; onError: (message: string) => void; starting?: boolean }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"draft" | "edit" | null>(null);
  const [proposal, setProposal] = useState<AiProposal | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const ask = async (kind: "draft" | "edit") => {
    setBusy(kind); onError("");
    try {
      const result = kind === "draft" ? await api.aiDraft() : await api.aiEdit(text.trim());
      setProposal(result); setPicked(new Set(result.changes.map((change) => change.key)));
      if (kind === "edit") setText("");
    } catch (cause) { onError(cause instanceof Error ? cause.message : t("The assistant didn't answer. Try again, or continue by hand.")); }
    finally { setBusy(null); }
  };
  const apply = () => {
    if (!proposal) return;
    onApply(proposalOps(proposal.changes.filter((change) => picked.has(change.key))));
    setProposal(null);
  };
  return <div className={styles.assistant}>
    {starting && !proposal ? <div className={styles.start}>
      <Sparkles aria-hidden="true" size={18} />
      <span><strong>{t("Start from Planning")}</strong><small>{t("A first draft from the requirements, site measurements and approved designs, priced from your catalog.")}</small></span>
      <Button size="compact" variant="primary" isLoading={busy === "draft"} onPress={() => void ask("draft")}>{t("Draft the quote")}</Button>
    </div> : null}
    <form className={styles.ask} onSubmit={(event) => { event.preventDefault(); if (text.trim()) void ask("edit"); }}>
      <Sparkles aria-hidden="true" size={15} />
      <input aria-label={t("Ask the assistant")} placeholder={t("Ask to add or change items — e.g. “add a false ceiling in the living room, 18 m²”")} value={text} maxLength={1000} disabled={Boolean(busy)} onChange={(event) => setText(event.target.value)} />
      <IconButton aria-label={t("Ask")} type="submit" size="compact" variant="primary" isDisabled={!text.trim() || Boolean(busy)} isLoading={busy === "edit"}><ArrowUp aria-hidden="true" size={14} /></IconButton>
    </form>
    {proposal ? <section className={styles.proposal} aria-label={t("Suggested changes")}>
      {proposal.summary ? <p>{proposal.summary}</p> : null}
      {proposal.changes.length ? <ul>{proposal.changes.map((change) => <li key={change.key}>
        <Checkbox isSelected={picked.has(change.key)} onChange={(on) => setPicked((current) => { const next = new Set(current); if (on) next.add(change.key); else next.delete(change.key); return next; })}>
          <ChangeLabel change={change} state={state} />
        </Checkbox>
      </li>)}</ul> : <p className={styles.mutedText}>{t("No changes suggested.")}</p>}
      <div className={styles.formActions}>
        <span className={styles.mutedText}>{t("Prices come from your catalog; lines without one stay unpriced.")}</span>
        <span className={styles.spacer} />
        <Button size="compact" onPress={() => setProposal(null)}>{t("Discard")}</Button>
        <Button size="compact" variant="primary" isDisabled={!picked.size} onPress={apply}>{picked.size === 1 ? t("Apply 1 change") : t("Apply {count} changes", { count: picked.size })}</Button>
      </div>
    </section> : null}
  </div>;
}

function ChangeLabel({ change, state }: { change: AiChange; state: BuilderState }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const area = (id: string | null | undefined) => (id ? state.areas.find((item) => item.id === id)?.name : null) ?? t("General");
  const name = change.catalogName ?? change.fields.title ?? change.lineTitle ?? "";
  const quantity = change.fields.quantity ? `${plain(change.fields.quantity, locale)} ${change.fields.unit ?? ""}`.trim() : change.fields.formula ? `ƒ ${change.fields.formula}` : "";
  return <span className={styles.change}>
    <span>
      <strong>{change.action === "add" ? t("Add") : change.action === "remove" ? t("Remove") : change.action === "move" ? t("Move") : t("Change")}</strong>{" "}{name}
      {change.action === "add" || change.action === "move" || change.fields.areaId !== undefined ? <> · {area(change.fields.areaId)}</> : null}
      {quantity ? <> · {quantity}</> : null}
      {change.action === "add" && !change.priced ? <> <Badge tone="warning">{t("No price yet")}</Badge></> : null}
    </span>
    {change.unknownArea ? <small>{t("“{area}” isn't an area of this project yet; it goes to General.", { area: change.unknownArea })}</small> : null}
    {change.why ? <small>{change.why}</small> : null}
  </span>;
}
