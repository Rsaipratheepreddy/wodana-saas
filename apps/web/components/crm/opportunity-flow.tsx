"use client";

import { useState } from "react";
import { Button, ControlledModalDialog, FileUploader, FormDialog, RadioSet, SelectField, Switch, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { MissingRequirement } from "@/lib/crm/client";
import { attachPaymentProof, FURNITURE_PATHS, missingFrom, PROOF_KINDS, type FurniturePath, type OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import { groupRequirements, type NowStep } from "@/lib/crm/now-step";
import { useStepText } from "./opportunity-now";
import styles from "./opportunity-flow.module.css";

/** A refused move: the first thing the column needs, with its action, and how many more. */
export function StageBlockedSheet({ stageName, items, onAction, onClose }: { stageName: string; items: MissingRequirement[]; onAction: (step: NowStep) => void; onClose: () => void }) {
  const t = useT();
  const text = useStepText();
  const [first, ...rest] = groupRequirements(items);
  const [expanded, setExpanded] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("To move to {stage}", { stage: stageName })} onOpenChange={(open) => { if (!open) onClose(); }}>
    {first ? <div className={styles.blocked}>
      <p className={styles.need}><span>{text(first)}</span><Button size="compact" variant="primary" onPress={() => { onClose(); onAction(first); }}>{text(first, "short")}</Button></p>
      {rest.length ? <button type="button" className={styles.moreToggle} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{t("and {count} more", { count: rest.length })}</button> : null}
      {expanded ? <ul className={styles.rest}>{rest.map((step) => <li key={step.id}><span>{text(step)}</span>
        <Button size="compact" variant="quiet" onPress={() => { onClose(); onAction(step); }}>{text(step, "short")}</Button></li>)}</ul> : null}
    </div> : null}
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
