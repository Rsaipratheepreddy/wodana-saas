"use client";

import { useState } from "react";
import { ExternalLink, ImageIcon } from "lucide-react";
import { Badge, Button, Card, InlineNotice, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import type { PortalAlternative, PortalChoice, PortalDesignChoices, PortalPresentation } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import home from "../portal-home.module.css";
import styles from "../../pre-project/design-decisions.module.css";

/**
 * The client's design choices (plan §6.7a): pick one of the presented concepts or ask for changes, and confirm
 * (or decline) each material and design choice the team recorded. Every answer is kept with the client's name.
 */
export function DesignChoices({ caseId, choices, api, format, onChanged }: { caseId: string; choices: PortalDesignChoices; api: PortalApi; format: PortalFormat; onChanged: () => Promise<void> | void }) {
  const t = useT();
  const open = choices.presentations.filter((item) => item.canDecide);
  // A declined choice with alternatives to pick from waits for the client too (R2).
  const pending = (item: PortalChoice) => item.canDecide || Boolean(item.alternatives?.some((alternative) => alternative.canChoose));
  const waiting = choices.choices.filter(pending);
  const settled = choices.choices.filter((item) => !pending(item));
  if (!choices.presentations.length && !choices.choices.length) return null;
  return <div className={styles.section}>
    {open.map((round) => <PresentationCard key={round.id} round={round} caseId={caseId} api={api} onChanged={onChanged} />)}
    {choices.choices.length ? <Card title={t("Your choices")} chip={choices.locked ? <Badge tone="success">{t("Signed off")}</Badge> : waiting.length ? <Badge tone="info">{t("{count} to confirm", { count: waiting.length })}</Badge> : undefined}>
      <ul className={styles.checks}>{[...waiting, ...settled].map((choice) => <ChoiceRow key={choice.versionId} choice={choice} caseId={caseId} api={api} format={format} onChanged={onChanged} />)}</ul>
    </Card> : null}
  </div>;
}

function PresentationCard({ round, caseId, api, onChanged }: { round: PortalPresentation; caseId: string; api: PortalApi; onChanged: () => Promise<void> | void }) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  const [changes, setChanges] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const send = async (input: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "presentation_choice", caseId, presentationId: round.id, version: round.version, ...input }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not send.")); }
    finally { setBusy(false); }
  };
  return <Card title={round.round > 1 ? t("{stage} · revision {number}", { stage: round.label, number: round.round - 1 }) : round.label} chip={<Badge tone="info">{t("Choose one")}</Badge>}
    footer={<div className={styles.bar}><span className={styles.spacer} />
      {changes ? <>
        <Button size="compact" variant="quiet" onPress={() => setChanges(false)}>{t("Back")}</Button>
        <Button size="compact" variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={() => void send({ decision: "changes", note: note.trim() })}>{t("Send")}</Button>
      </> : <>
        <Button size="compact" variant="quiet" onPress={() => setChanges(true)}>{t("Ask for changes")}</Button>
        <Button size="compact" variant="primary" isLoading={busy} isDisabled={!picked} onPress={() => void send({ decision: "choose", optionId: picked })}>{t("Choose this one")}</Button>
      </>}
    </div>}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {changes ? <TextAreaField autoFocus isRequired label={t("What would you like changed?")} maxLength={2000} value={note} onChange={setNote} />
      : <ul className={styles.cards} role="radiogroup" aria-label={t("Options")}>{round.options.map((option) => <li key={option.id}>
        <button type="button" role="radio" aria-checked={picked === option.id} className={styles.option} data-chosen={picked === option.id || undefined} onClick={() => setPicked(option.id)}>
          <span className={styles.thumb} aria-hidden="true">{option.versionId && option.hasPreview
            // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
            ? <img alt="" src={api.file("design", option.versionId, true)} /> : option.linkUrl ? <ExternalLink size={20} data-directional="true" /> : <ImageIcon size={20} />}</span>
          <span className={styles.optionTitle}>{option.title}</span>
          {option.note ? <span className={styles.muted}>{option.note}</span> : null}
        </button>
        {option.linkUrl ? <a className={styles.link} href={option.linkUrl} rel="noreferrer" target="_blank">{t("Open link")}<ExternalLink aria-hidden="true" size={12} data-directional="true" /></a> : null}
      </li>)}</ul>}
  </Card>;
}

function ChoiceRow({ choice, caseId, api, format, onChanged }: { choice: PortalChoice; caseId: string; api: PortalApi; format: PortalFormat; onChanged: () => Promise<void> | void }) {
  const t = useT();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const send = async (decision: "confirm" | "decline") => {
    setBusy(true); setError("");
    try { await api.command(id, { action: "ledger_decision", caseId, entryId: choice.entryId, versionId: choice.versionId, decision, note: note.trim() }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not send.")); }
    finally { setBusy(false); }
  };
  const details = [choice.specification, choice.room, choice.quantity ? `${format.number(choice.quantity)} ${choice.unit}`.trim() : "", choice.unitPrice && choice.currency ? format.money(choice.unitPrice, choice.currency) : ""].filter(Boolean).join(" · ");
  return <li data-ok={choice.status === "confirmed" || undefined}>
    <span className={styles.cell}>
      <span className={styles.inline}><strong>{choice.title}</strong>{choice.changed ? <Badge tone="warning">{t("Changed")}</Badge> : null}</span>
      {details ? <small>{details}</small> : null}
      {choice.status === "confirmed" && choice.confirmedAt ? <small>{t("Confirmed by {name} on {date}", { name: choice.confirmedByName ?? "", date: format.date(choice.confirmedAt) })}</small> : null}
      {declining ? <TextAreaField autoFocus isRequired label={t("What would you like instead?")} maxLength={2000} value={note} onChange={setNote} /> : null}
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {choice.alternatives?.length ? <Alternatives alternatives={choice.alternatives} caseId={caseId} api={api} format={format} onChanged={onChanged} /> : null}
    </span>
    {choice.canDecide ? <span className={styles.inline}>
      {declining ? <>
        <Button size="compact" variant="quiet" onPress={() => setDeclining(false)}>{t("Back")}</Button>
        <Button size="compact" variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={() => void send("decline")}>{t("Send")}</Button>
      </> : <>
        <Button size="compact" variant="quiet" onPress={() => setDeclining(true)}>{t("Not this")}</Button>
        <Button size="compact" variant="primary" isLoading={busy} onPress={() => void send("confirm")}>{t("Confirm")}</Button>
      </>}
    </span> : <Badge tone={choice.status === "confirmed" ? "success" : choice.status === "declined" ? "danger" : "neutral"}>{choice.status === "confirmed" ? t("Confirmed") : choice.status === "declined" ? t("Declined") : t("Replaced")}</Badge>}
  </li>;
}

/**
 * R2: after the client turned a choice down, up to three alternatives from the firm's catalogue (in stock first, then
 * within the budget, then ones used on past jobs). Picking one records it as the client's confirmed choice.
 */
function Alternatives({ alternatives, caseId, api, format, onChanged }: { alternatives: PortalAlternative[]; caseId: string; api: PortalApi; format: PortalFormat; onChanged: () => Promise<void> | void }) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [id] = useState(commandId);
  const choose = async (alternative: PortalAlternative) => {
    setBusy(alternative.id); setError("");
    try { await api.command(id, { action: "ledger_alternative", caseId, alternativeId: alternative.id }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not send.")); }
    finally { setBusy(null); }
  };
  return <span className={styles.cell}>
    <small>{t("Alternatives you could choose instead")}</small>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <ul className={home.alternatives}>{alternatives.map((alternative) => <li className={home.alternative} key={alternative.id}>
      <strong dir="auto">{alternative.title}</strong>
      {alternative.unitPrice && alternative.currency ? <small><bdi dir="ltr">{format.money(alternative.unitPrice, alternative.currency)}</bdi>{alternative.unit ? ` / ${alternative.unit}` : ""}
        {alternative.lineTotal ? <> · <bdi dir="ltr">{format.money(alternative.lineTotal, alternative.currency)}</bdi></> : null}</small> : null}
      <span className={styles.inline}>
        {alternative.inStock ? <Badge tone="success">{t("In stock")}</Badge> : null}
        {alternative.inBudget ? <Badge tone="info">{t("Within budget")}</Badge> : null}
        {alternative.fromPastJobs ? <Badge>{t("Used before")}</Badge> : null}
      </span>
      {alternative.canChoose ? <Button size="compact" variant="primary" isLoading={busy === alternative.id} isDisabled={Boolean(busy)} onPress={() => void choose(alternative)}>{t("Choose this")}</Button> : null}
    </li>)}</ul>
  </span>;
}
