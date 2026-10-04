"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronRight, CircleDashed, Paperclip } from "lucide-react";
import { Avatar, Button, ControlledModalDialog, FileUploader, FormDialog, RadioSet, SelectField, Switch, TextAreaField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { MessageKey } from "@/lib/i18n/keys";
import type { MissingRequirement } from "@/lib/crm/client";
import {
  attachPaymentProof, FURNITURE_PATHS, missingFrom, PROOF_KINDS, proofHref, requirementAction,
  type FurniturePath, type OpportunityFlowView, type RequirementTarget,
} from "@/lib/crm/opportunity-flow";
import styles from "./opportunity-flow.module.css";

function shortDate(value: string | null | undefined, locale: string, timeZone: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone }).format(new Date(value));
}

/** Each thing a column still needs: a plain label and the one action that resolves it. */
export function RequirementRows({ items, onAction, primaryKey }: { items: MissingRequirement[]; onAction: (target: RequirementTarget, key: string) => void; /** Its action is already the card's primary button. */ primaryKey?: string }) {
  const t = useT();
  return <ul className={styles.requirements} aria-label={t("Still needed")}>{items.map((item) => {
    const action = requirementAction(item.key);
    return <li key={item.key}>
      <CircleDashed aria-hidden="true" size={15} className={styles.requirementIcon} />
      <span className={styles.requirementLabel}>{t(item.label as MessageKey)}</span>
      {item.key === primaryKey ? <span /> : <Button size="compact" variant="quiet" onPress={() => onAction(action.target, item.key)}>{t(action.label)}<ChevronRight aria-hidden="true" size={13} /></Button>}
    </li>;
  })}</ul>;
}

/** A refused move: what the target column needs, each with its action. One dismiss. */
export function StageBlockedDialog({ stageName, items, onAction, onClose }: { stageName: string; items: MissingRequirement[]; onAction: (target: RequirementTarget, key: string) => void; onClose: () => void }) {
  const t = useT();
  return <ControlledModalDialog isOpen size="md" title={t("Can't move to {stage} yet", { stage: stageName })} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<Button variant="primary" onPress={onClose}>{t("Got it")}</Button>}>
    <RequirementRows items={items} onAction={(target, key) => { onClose(); onAction(target, key); }} />
  </ControlledModalDialog>;
}

/** PLM-122: the proof of payment (receipt, card slip, transfer, cash sheet or photo). Attaching it wins the deal. */
export function PaymentProofDialog({ workspaceId, opportunityId, loadVersion, onClose, onWon, onBlocked }: {
  workspaceId: string; opportunityId: string; loadVersion: () => Promise<number>; onClose: () => void; onWon: () => Promise<void> | void; onBlocked: (items: MissingRequirement[]) => void;
}) {
  const t = useT();
  const [kind, setKind] = useState("receipt");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  return <FormDialog title={t("Attach payment proof")} submitLabel={t("Attach and mark Won")} isDirty={Boolean(file || note.trim())} isSubmitDisabled={!file} onClose={onClose}
    onSubmit={async () => {
      if (!file) throw new Error(t("Choose the proof file."));
      try {
        await attachPaymentProof(workspaceId, opportunityId, { version: await loadVersion(), kind, note, file });
      } catch (error) {
        const missing = missingFrom(error);
        if (missing.length) { onClose(); onBlocked(missing); return; }
        throw error;
      }
      onClose();
      await onWon();
    }}>
    <SelectField isRequired label={t("Proof")} selectedKey={kind} onSelectionChange={(key) => setKind(String(key))} items={PROOF_KINDS.map((item) => ({ id: item.id, label: t(item.label) }))} />
    <FileUploader accept="image/*,application/pdf" label={file ? file.name : t("Choose the proof file")} multiple={false} onFiles={(files) => setFile(files[0] ?? null)} />
    <TextAreaField label={t("Note")} value={note} onChange={setNote} maxLength={1000} placeholder={t("Reference, amount or method")} />
  </FormDialog>;
}

/** PLM-121: how a furniture sale is fulfilled (A–E), and the facts some paths need. */
export function FurniturePathDialog({ flow, onClose, onSave }: { flow: NonNullable<OpportunityFlowView["furniture"]>; onClose: () => void; onSave: (input: { furniturePath: FurniturePath; feasibilityConfirmed?: boolean; materialsChange?: boolean }) => Promise<void> }) {
  const t = useT();
  const [path, setPath] = useState<FurniturePath | null>(flow.path);
  const [feasible, setFeasible] = useState(Boolean(flow.feasibility));
  const [materials, setMaterials] = useState(flow.materialsChange);
  const dirty = path !== flow.path || feasible !== Boolean(flow.feasibility) || materials !== flow.materialsChange;
  return <FormDialog title={t("Furniture sub-path")} submitLabel={t("Save")} size="lg" isDirty={dirty} isSubmitDisabled={!path} onClose={onClose} closeOnSuccess
    onSubmit={async () => { if (path) await onSave({ furniturePath: path, ...(path === "bespoke" ? { feasibilityConfirmed: feasible } : {}), ...(path === "core_collection_factory" ? { materialsChange: materials } : {}) }); }}>
    <div className={styles.pathPicker}>
      <RadioSet aria-label={t("Furniture sub-path")} label={null} value={path ?? ""} onChange={(value) => setPath(value as FurniturePath)} items={FURNITURE_PATHS.map((item) => ({
        id: item.id,
        label: <span className={styles.pathTitle}><b className={styles.pathLetter}>{item.letter}</b>{t(item.label)}<small className={styles.pathLead}>{t(item.lead)}</small></span>,
        description: t(item.description),
      }))} />
    </div>
    {path === "bespoke" ? <Switch isSelected={feasible} onChange={setFeasible}>{t("Feasibility confirmed by Factory/Technical")}</Switch> : null}
    {path === "core_collection_factory" ? <Switch isSelected={materials} onChange={setMaterials}>{t("Materials change (Creative Director approves)")}</Switch> : null}
  </FormDialog>;
}

/**
 * The opportunity's "Next step": a status rail (blocked or ready, steps done, the follow-up date), the step line,
 * the one primary action with its owner, what is still needed, and the facts already recorded.
 */
export function NextStepCard({ workspaceId, opportunityId, flow, status, ownerName, followUp, onAction, onAdvance, advancing, extra }: {
  workspaceId: string; opportunityId: string; flow: OpportunityFlowView; status: string; ownerName: string | null; followUp: string | null;
  onAction: (target: RequirementTarget, key: string) => void; onAdvance: () => void; advancing: boolean; extra?: ReactNode;
}) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const open = status === "open";
  const blocked = open && flow.missing.length > 0;
  const tone = !open ? (status === "won" ? "success" : "neutral") : blocked ? "attention" : "success";
  const firstMissing = flow.missing[0];
  const primary = !open || !flow.next ? null
    : firstMissing ? { label: t(requirementAction(firstMissing.key).label), press: () => onAction(requirementAction(firstMissing.key).target, firstMissing.key) }
    : { label: flow.next.step === "won" ? t("Mark Won") : t("Move to {stage}", { stage: flow.next.name }), press: onAdvance };
  const facts: Array<{ key: string; label: string }> = [];
  const pathChoice = FURNITURE_PATHS.find((item) => item.id === flow.furniture?.path);
  if (pathChoice) facts.push({ key: "path", label: `${pathChoice.letter} · ${t(pathChoice.label)}` });
  if (flow.furniture?.feasibility) facts.push({ key: "feasibility", label: t("Feasibility confirmed · {date}", { date: shortDate(flow.furniture.feasibility.at, locale, timeZone) }) });
  if (flow.clientApproval) facts.push({ key: "approval", label: t("Client approved · {date}", { date: shortDate(flow.clientApproval.at, locale, timeZone) }) });
  const proof = flow.proofs[0];
  return <section className={styles.card} data-tone={tone} aria-label={t("Next step")}>
    <div className={styles.rail}>
      <strong>{t("{done} of {total} done", { done: flow.done, total: flow.total })}</strong>
      {open && followUp ? <small>{t("Follow-up {date}", { date: shortDate(followUp, locale, timeZone) })}</small> : null}
    </div>
    <div className={styles.cardBody}>
      <ol className={styles.steps} aria-label={t("Pipeline steps")}>{flow.steps.map((step) => <li key={step.stageId} data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
        <span aria-hidden="true" className={styles.stepMark}>{step.state === "done" ? <Check size={11} strokeWidth={3} /> : null}</span>
        {step.name}{step.optional ? <small>{t("optional")}</small> : null}
      </li>)}</ol>
      {open && flow.next ? <div className={styles.nextLine}>
        <p><small>{t("Next step")}</small><strong>{flow.next.name}</strong>{flow.negotiationOptional && flow.next.step === "won" ? <span className={styles.muted}>{t("Negotiation is optional")}</span> : null}</p>
        <span className={styles.nextActions}>
          {ownerName ? <span className={styles.owner} title={ownerName}><Avatar name={ownerName} size="sm" /></span> : null}
          {primary ? <Button size="compact" variant="primary" isLoading={advancing} onPress={primary.press}>{primary.label}</Button> : null}
        </span>
      </div> : null}
      {blocked ? <RequirementRows items={flow.missing} onAction={onAction} primaryKey={firstMissing?.key} /> : null}
      {facts.length || proof ? <ul className={styles.facts} aria-label={t("Recorded")}>
        {facts.map((fact) => <li key={fact.key}><Check aria-hidden="true" size={12} />{fact.label}</li>)}
        {proof ? <li><Paperclip aria-hidden="true" size={12} /><a href={proofHref(workspaceId, opportunityId, proof.id)} target="_blank" rel="noopener noreferrer">{t("Payment proof attached · {date}", { date: shortDate(proof.recordedAt, locale, timeZone) })}</a></li> : null}
      </ul> : null}
      {extra}
    </div>
  </section>;
}
