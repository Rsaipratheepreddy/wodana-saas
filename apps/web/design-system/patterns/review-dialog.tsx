"use client";

import { BadgeCheck, FileText, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import { FactTiles, type FactTile } from "../components/price-tag";
import { FormDialog } from "../components/form-kit";
import { IconButton } from "../components/actions";
import { RadioSet, TextAreaField } from "../components/forms";
import { CheckList, type CheckItem } from "./record-summary";

export type ReviewFact = { label: string; value: ReactNode; icon?: ReactNode; detail?: ReactNode; tone?: FactTile["tone"] };
/** A file behind the decision (a proof, a bill, a drawing): where it opens, and its small picture when it has one. */
export type ReviewFile = { id: string; name: string; href: string; previewHref?: string | null };

/** The files a decision rests on, each opening in a new tab; says so plainly when nothing was attached. Removable while the decision is being written. */
export function ReviewFiles({ files, label, onRemove, empty }: { files: ReviewFile[]; label?: string; onRemove?: (id: string) => void; empty?: ReactNode }) {
  const t = useT();
  return <section className="wd-review-files" aria-label={label ?? t("Attached files")}>
    <span className="wd-review-files-label">{label ?? t("Attached files")}</span>
    {files.length ? <ul>
      {files.map((file) => <li key={file.id}>
        {onRemove ? <span className="wd-review-files-remove"><IconButton aria-label={t("Remove {name}", { name: file.name })} size="compact" variant="quiet" onPress={() => onRemove(file.id)}><X aria-hidden="true" size={14} /></IconButton></span> : null}
        <a href={file.href} target="_blank" rel="noreferrer" aria-label={t("Open {name}", { name: file.name })}>
          {/* Private, authenticated previews stay on the same-origin file endpoint. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="wd-review-files-thumb">{file.previewHref ? <img src={file.previewHref} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /> : <FileText aria-hidden="true" size={20} />}</span>
          <span className="wd-review-files-name" dir="auto">{file.name}</span>
        </a>
      </li>)}
    </ul> : empty === undefined ? <span className="wd-review-files-none">{t("No file attached")}</span> : empty}
  </section>;
}

/**
 * §0.3 P0: every verify, approve or sign-off opens this review, never a one-click button. It shows what is being
 * confirmed (the facts, an evidence preview, the checklist read from the records); the person confirms there, or
 * sends it back with a reason when the step allows it. Nothing here is decided until the dialog's action.
 */
export function ReviewDialog({ title, description, icon, facts = [], files, evidence, checks, confirmLabel, confirmNeedsNote = false, returnLabel, rejectLabel, blocked, onConfirm, onReturn, onReject, onClose }: {
  title: string; description?: string;
  /** The dialog's icon; a review shows a checked badge unless the module names a better one. */
  icon?: ReactNode;
  facts?: ReviewFact[];
  /** The files the decision rests on; an empty list says nothing was attached. Leave out when the step has none. */
  files?: ReviewFile[];
  /** A preview of the document or proof under review. */
  evidence?: ReactNode;
  /** What the records say, each done or not; a check not done blocks confirming. */
  checks?: { label: string; items: CheckItem[] };
  confirmLabel: string;
  /** Confirming needs the reason too (a module that asks why something is approved). */
  confirmNeedsNote?: boolean;
  /** Present when the step can be sent back: its label ("Send back", "Return"), and the reason is required. */
  returnLabel?: string;
  /** Why it can't be confirmed yet (shown instead of confirming). */
  blocked?: string;
  onConfirm: (note: string) => Promise<void> | void;
  onReturn?: (reason: string) => Promise<void> | void;
  /** Present when the step can be refused outright; the reason is required. */
  rejectLabel?: string;
  onReject?: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useT();
  const [decision, setDecision] = useState<"confirm" | "return" | "reject">("confirm");
  const [note, setNote] = useState("");
  const returning = (decision === "return" && Boolean(onReturn)) || (decision === "reject" && Boolean(onReject));
  const unchecked = Boolean(checks?.items.some((item) => !item.done));
  return <FormDialog size="md" title={title} description={description} icon={icon ?? <BadgeCheck />} onClose={onClose}
    submitLabel={decision === "reject" && onReject ? rejectLabel ?? t("Reject") : returning ? returnLabel ?? t("Send back") : confirmLabel}
    isSubmitDisabled={returning || confirmNeedsNote ? !note.trim() || (!returning && (Boolean(blocked) || unchecked)) : Boolean(blocked) || unchecked}
    error={!returning && blocked ? blocked : undefined}
    onSubmit={() => decision === "reject" && onReject ? onReject(note.trim()) : returning ? onReturn!(note.trim()) : onConfirm(note.trim())}>
    {facts.length ? <FactTiles label={t("Details")} items={facts.map((fact) => ({ id: fact.label, ...fact }))} /> : null}
    {files ? <ReviewFiles files={files} /> : null}
    {evidence}
    {checks ? <CheckList label={checks.label} items={checks.items} /> : null}
    {onReturn || onReject ? <RadioSet isRequired label={t("Decision")} value={decision} onChange={(value) => setDecision(value as "confirm" | "return" | "reject")} items={[
      { id: "confirm", label: confirmLabel },
      ...(onReturn ? [{ id: "return", label: returnLabel ?? t("Send back") }] : []),
      ...(onReject ? [{ id: "reject", label: rejectLabel ?? t("Reject") }] : []),
    ]} /> : null}
    <TextAreaField isRequired={returning || confirmNeedsNote} label={decision === "reject" ? t("Why it is refused") : returning ? t("What needs to change") : confirmNeedsNote ? t("Why it's approved") : t("Note")} value={note} onChange={setNote} maxLength={1000} />
  </FormDialog>;
}
