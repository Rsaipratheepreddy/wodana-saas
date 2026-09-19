"use client";

import { AlertTriangle, Check, FileSearch, Pencil, X } from "lucide-react";
import { Button } from "../components/actions";
import { TextAreaField } from "../components/forms";
import { Badge, Callout } from "../components/status";
import { Surface } from "../primitives/layout";

export type AiEvidenceItem = { label: string; value: string; source: string };
export type AiDiffItem = { field: string; label: string; before: string; after: string };

export function AiSuggestionReview({
  title,
  suggestion,
  editedSuggestion,
  evidence,
  proposedDiff,
  uncertainty,
  provenance,
  status,
  busy,
  onEdit,
  onDecision,
}: {
  title: string;
  suggestion: string;
  editedSuggestion: string;
  evidence: AiEvidenceItem[];
  proposedDiff: AiDiffItem[];
  uncertainty: string[];
  provenance: { mode?: string; provider?: string; model?: string; generatedAt?: string };
  status: "pending" | "accepted" | "edited" | "rejected";
  busy?: boolean;
  onEdit: (value: string) => void;
  onDecision: (action: "accepted" | "edited" | "rejected") => void;
}) {
  const changed = editedSuggestion.trim() !== suggestion.trim();
  const reviewed = status !== "pending";
  return <Surface as="section" className="wd-ai-suggestion" aria-label={title} tone="raised">
    <header><span><FileSearch aria-hidden="true" size={18} /><strong>{title}</strong></span><Badge tone={status === "rejected" ? "danger" : reviewed ? "success" : "info"}>{status === "pending" ? "Needs staff review" : status === "edited" ? "Accepted with edit" : status}</Badge></header>
    <TextAreaField
      description="Edit the wording if useful. This review records your choice but does not change the source record."
      isDisabled={reviewed || busy}
      label="Suggestion"
      maxLength={12_000}
      onChange={onEdit}
      value={editedSuggestion}
    />
    <div className="wd-ai-review-grid">
      <section><h4>Evidence used</h4><dl>{evidence.map((item) => <div key={`${item.source}/${item.label}`}><dt>{item.label}</dt><dd>{item.value}<small>{item.source}</small></dd></div>)}</dl></section>
      <section><h4>Proposed changes</h4>{proposedDiff.length ? <dl>{proposedDiff.map((item) => <div key={item.field}><dt>{item.label}</dt><dd><s>{item.before}</s><span aria-hidden="true">→</span><strong>{item.after}</strong></dd></div>)}</dl> : <p>No record-field changes are proposed.</p>}</section>
    </div>
    {uncertainty.length ? <Callout title="Uncertainty" tone="warning"><ul>{uncertainty.map((item) => <li key={item}>{item}</li>)}</ul></Callout> : null}
    <footer>
      <small>{[provenance.mode === "ai" ? "AI generated" : "Rules generated", provenance.provider, provenance.model].filter(Boolean).join(" · ")}</small>
      {!reviewed ? <div className="wd-ai-review-actions">
        <Button isDisabled={busy} onPress={() => onDecision("rejected")} size="compact" variant="quiet"><X aria-hidden="true" size={14} />Reject</Button>
        <Button isDisabled={busy || !changed} onPress={() => onDecision("edited")} size="compact"><Pencil aria-hidden="true" size={14} />Accept edit</Button>
        <Button isDisabled={busy || changed} onPress={() => onDecision("accepted")} size="compact" variant="primary"><Check aria-hidden="true" size={14} />Accept suggestion</Button>
      </div> : <span className="wd-ai-reviewed-note"><AlertTriangle aria-hidden="true" size={13} />Review recorded. No source record was changed.</span>}
    </footer>
  </Surface>;
}
