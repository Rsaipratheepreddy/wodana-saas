"use client";

import { useState } from "react";
import { AiSuggestionReview, Button, Callout, Woddy, woddyPoseFor, type AiDiffItem, type AiEvidenceItem } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { AiPauseNotice } from "@/components/workspace/ai-pause-notice";
import { useWoddy } from "./woddy-chat";
import styles from "./crm-workbench.module.css";

type Suggestion = {
  id: string;
  /** AI credits used up or today's AI limit reached: the checklist came from the record's rules. */
  paused?: boolean;
  note?: string;
  title: string;
  suggestionText: string;
  editedText: string | null;
  evidence: AiEvidenceItem[];
  proposedDiff: AiDiffItem[];
  uncertainty: string[];
  provenance: { mode?: string; provider?: string; model?: string; generatedAt?: string };
  status: "pending" | "accepted" | "edited" | "rejected";
  version: number;
};

export function WoddyAssist({ workspaceId, leadId }: { workspaceId: string; leadId: string }) {
  const woddy = useWoddy();
  const [result, setResult] = useState<Suggestion | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const review = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/workspace/crm/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, leadId, requestId: crypto.randomUUID() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not review the enquiry.");
      setResult(payload);
      setDraft(payload.suggestionText);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not review the enquiry."); }
    finally { setBusy(false); }
  };

  const decide = async (action: "accepted" | "edited" | "rejected") => {
    if (!result) return;
    setBusy(true); setError("");
    try {
      const updated = await crmRequest<Suggestion>(workspaceId, `ai-suggestions/${result.id}/decision`, "PATCH", {
        requestId: crypto.randomUUID(),
        version: result.version,
        action,
        ...(action === "edited" ? { editedText: draft.trim() } : {}),
        ...(action === "rejected" ? { reason: "Rejected after staff review" } : {}),
      });
      setResult(updated);
      setDraft(updated.editedText ?? updated.suggestionText);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The review decision could not be recorded."); }
    finally { setBusy(false); }
  };

  return <section className={styles.assistant} aria-label="Woddy enquiry assistance">
    <div className={styles.toolbar}><h3><Woddy decorative pose={error ? woddyPoseFor.error : busy ? woddyPoseFor.running : result ? woddyPoseFor.done : woddyPoseFor.empty} size={28} />Woddy</h3><Button size="compact" onPress={woddy?.open}>Chat with Woddy</Button><Button size="compact" isLoading={busy && !result} onPress={() => void review()}>Review enquiry</Button></div>
    {result ? <AiSuggestionReview
      busy={busy}
      editedSuggestion={draft}
      evidence={result.evidence}
      onDecision={(action) => void decide(action)}
      onEdit={setDraft}
      proposedDiff={result.proposedDiff}
      provenance={result.provenance}
      status={result.status}
      suggestion={result.suggestionText}
      title={result.title}
      uncertainty={result.uncertainty}
    /> : <p>A quick evidence-backed review with proposed changes and visible uncertainty. Nothing is applied automatically.</p>}
    {result?.paused && result.note ? <AiPauseNotice message={result.note} /> : null}
    {error ? <Callout title="Woddy review unavailable" tone="danger">{error}</Callout> : null}
  </section>;
}
