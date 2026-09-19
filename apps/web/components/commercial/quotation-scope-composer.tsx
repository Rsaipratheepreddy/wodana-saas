"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import { commercialPath, jsonRequest } from "@/lib/commercial/client";
import { selectableProposalIds, type QuotationComposerState, type QuotationProposalRun } from "@/lib/commercial/quotation-composer";
import { Button, Callout, Skeleton } from "@/design-system";
import styles from "./quotation-scope-composer.module.css";

type Props = {
  workspaceId: string;
  caseId: string;
  quoteId: string;
  revision: number;
  lineCount: number;
  dirty: boolean;
  compact?: boolean;
  onApplied: () => Promise<unknown>;
};

export function QuotationScopeComposer({ workspaceId, caseId, quoteId, revision, lineCount, dirty, compact = false, onApplied }: Props) {
  const [state, setState] = useState<QuotationComposerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scopeHref = `/workspace/pre-projects/cases/${caseId}/definition`;

  const refresh = useCallback(async () => {
    const next = await jsonRequest<QuotationComposerState>(`${commercialPath(workspaceId, `cases/${caseId}/quotation-composer`)}&quoteId=${quoteId}`);
    setState(next);
  }, [workspaceId, caseId, quoteId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh().catch((failure) => {
      if (active) setError(failure instanceof Error ? failure.message : "Could not load the confirmed scope.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  async function addConfirmedScope() {
    if (!state || dirty || !state.definition) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const prepared = await jsonRequest<{ run: QuotationProposalRun }>(commercialPath(workspaceId, `cases/${caseId}/quotation-proposals`), "POST", {
        requestId: crypto.randomUUID(), quoteId, revision: state.revision, mode: "scope",
      });
      const selectedItemIds = selectableProposalIds(prepared.run);
      if (!selectedItemIds.length) {
        setNotice("Everything in the confirmed scope is already in this quotation.");
        await refresh();
        return;
      }
      const result = await jsonRequest<{ addedItemIds: string[]; skippedDuplicateItemIds: string[] }>(commercialPath(workspaceId, `cases/${caseId}/quotation-proposals/${prepared.run.id}/apply`), "POST", {
        requestId: crypto.randomUUID(), revision, selectedItemIds,
      });
      await onApplied();
      await refresh();
      setNotice(`${result.addedItemIds.length} confirmed scope item${result.addedItemIds.length === 1 ? "" : "s"} added. Review quantities and any missing prices in the sheet below.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The confirmed scope could not be added.");
    } finally { setBusy(false); }
  }

  // The currently deployed business-core predates the scope-composer coverage,
  // comparison and readiness fields. Keep legacy quotations usable while the
  // services are upgraded independently.
  const uncovered = state?.coverage?.uncovered ?? [];
  const blockers = state?.readiness?.blockers ?? [];
  const warnings = state?.readiness?.warnings ?? [];
  const comparison = state?.comparison?.details ?? { added: [], removed: [], changed: [] };
  const missing = uncovered.length;
  const needsScopeReview = Boolean(
    missing ||
      blockers.length ||
      warnings.length ||
      comparison.changed.length ||
      comparison.added.length ||
      comparison.removed.length,
  );
  if (compact) return <div className={styles.compact} aria-label="Confirmed scope connection">
    {loading ? <span>Checking scope…</span> : error ? <><span className={styles.compactError}>Scope unavailable</span><Button size="compact" variant="quiet" onPress={() => { setLoading(true); setError(""); refresh().finally(() => setLoading(false)); }}><RefreshCw size={13}/>Retry</Button></> : state?.definition ? missing ? <><span>{missing} scope {missing === 1 ? "item" : "items"} not quoted</span><Button variant="quiet" size="compact" onPress={() => void addConfirmedScope()} isDisabled={busy || dirty || state.revision !== revision} isLoading={busy}>Add scope</Button></> : <span className={styles.complete}><CheckCircle2 size={15}/>Scope covered</span> : <Link className={styles.scopeLink} href={scopeHref}>Confirm scope <ArrowRight size={14}/></Link>}
    {notice ? <span className={styles.compactNotice}>{notice}</span> : null}
  </div>;
  return <section className={styles.composer} aria-label="Build from confirmed scope" data-empty={lineCount === 0 || undefined}>
    <div className={styles.heading}>
      <div><strong>{lineCount ? "Confirmed scope connection" : "Start with the confirmed scope"}</strong><span>{state?.definition ? `Client-confirmed version ${state.definition.number}` : "Requirements → quotation → project"}</span></div>
      {loading ? null : state?.definition ? missing ? <Button variant="primary" size="compact" onPress={() => void addConfirmedScope()} isDisabled={busy || dirty || state.revision !== revision} isLoading={busy}>Add {missing} missing {missing === 1 ? "item" : "items"}<ArrowRight size={14}/></Button> : <span className={styles.complete}><CheckCircle2 size={15}/>Scope covered</span> : <Link className={styles.scopeLink} href={scopeHref}>Confirm scope <ArrowRight size={14}/></Link>}
    </div>
    {loading ? <Skeleton lines={1}/> : null}
    {error ? <Callout title="Confirmed scope unavailable" tone="danger">{error} <Button size="compact" variant="quiet" onPress={() => { setLoading(true); setError(""); refresh().finally(() => setLoading(false)); }}><RefreshCw size={13}/>Retry</Button></Callout> : null}
    {notice ? <Callout title="Quotation updated" tone="success">{notice}</Callout> : null}
    {state?.definition ? <>
      {dirty && missing ? <p className={styles.muted}>Save the current sheet edits before adding the remaining scope.</p> : null}
      {(missing || comparison.changed.length || comparison.added.length || comparison.removed.length || blockers.length) ? <details className={styles.diff}>
        <summary>Review scope connection</summary>
        {missing ? <div><strong>Not yet quoted</strong><ul>{uncovered.map((item) => <li key={item.id}>{item.roomName ? `${item.roomName} · ` : ""}{item.title}</li>)}</ul></div> : null}
        {blockers.length ? <div><strong>Resolve before review</strong><ul>{blockers.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></div> : null}
        {comparison.changed.length ? <div><strong>Changed since the previous quotation</strong><ul>{comparison.changed.map((item) => <li key={item.id}>{item.room} · {item.title} · {item.changes.join(", ")}</li>)}</ul></div> : null}
      </details> : null}
    </> : null}
  </section>;
}
