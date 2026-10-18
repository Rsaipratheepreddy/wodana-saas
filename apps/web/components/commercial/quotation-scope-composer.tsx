"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
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
  const t = useT();
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
      if (active) setError(failure instanceof Error ? failure.message : t("Could not load the confirmed scope."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, t]);

  async function addConfirmedScope() {
    if (!state || dirty || !state.definition) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const prepared = await jsonRequest<{ run: QuotationProposalRun }>(commercialPath(workspaceId, `cases/${caseId}/quotation-proposals`), "POST", {
        requestId: crypto.randomUUID(), quoteId, revision: state.revision, mode: "scope",
      });
      const selectedItemIds = selectableProposalIds(prepared.run);
      if (!selectedItemIds.length) {
        setNotice(t("Everything in the confirmed scope is already in this quotation."));
        await refresh();
        return;
      }
      const result = await jsonRequest<{ addedItemIds: string[]; skippedDuplicateItemIds: string[] }>(commercialPath(workspaceId, `cases/${caseId}/quotation-proposals/${prepared.run.id}/apply`), "POST", {
        requestId: crypto.randomUUID(), revision, selectedItemIds,
      });
      await onApplied();
      await refresh();
      setNotice(t(result.addedItemIds.length === 1 ? "{count} confirmed scope item added. Review quantities and any missing prices in the sheet below." : "{count} confirmed scope items added. Review quantities and any missing prices in the sheet below.", { count: result.addedItemIds.length }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("The confirmed scope could not be added."));
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
  if (compact) return <div className={styles.compact} aria-label={t("Confirmed scope connection")}>
    {loading ? <span>{t("Checking scope…")}</span> : error ? <><span className={styles.compactError}>{t("Scope unavailable")}</span><Button size="compact" variant="quiet" onPress={() => { setLoading(true); setError(""); refresh().finally(() => setLoading(false)); }}><RefreshCw size={13}/>{t("Retry")}</Button></> : state?.definition ? missing ? <><span>{t(missing === 1 ? "{count} scope item not quoted" : "{count} scope items not quoted", { count: missing })}</span><Button variant="quiet" size="compact" onPress={() => void addConfirmedScope()} isDisabled={busy || dirty || state.revision !== revision} isLoading={busy}>{t("Add scope")}</Button></> : <span className={styles.complete}><CheckCircle2 size={15}/>{t("Scope covered")}</span> : <Link className={styles.scopeLink} href={scopeHref}>{t("Confirm scope")}{" "}<ArrowRight size={14}/></Link>}
    {notice ? <span className={styles.compactNotice}>{notice}</span> : null}
  </div>;
  return <section className={styles.composer} aria-label={t("Build from confirmed scope")} data-empty={lineCount === 0 || undefined}>
    <div className={styles.heading}>
      <div><strong>{t(lineCount ? "Confirmed scope connection" : "Start with the confirmed scope")}</strong><span>{state?.definition ? t("Client-confirmed version {number}", { number: state.definition.number }) : t("Requirements → quotation → project")}</span></div>
      {loading ? null : state?.definition ? missing ? <Button variant="primary" size="compact" onPress={() => void addConfirmedScope()} isDisabled={busy || dirty || state.revision !== revision} isLoading={busy}>{t(missing === 1 ? "Add {count} missing item" : "Add {count} missing items", { count: missing })}<ArrowRight size={14}/></Button> : <span className={styles.complete}><CheckCircle2 size={15}/>{t("Scope covered")}</span> : <Link className={styles.scopeLink} href={scopeHref}>{t("Confirm scope")}{" "}<ArrowRight size={14}/></Link>}
    </div>
    {loading ? <Skeleton lines={1}/> : null}
    {error ? <Callout title={t("Confirmed scope unavailable")} tone="danger">{translateKnown(t, error)} <Button size="compact" variant="quiet" onPress={() => { setLoading(true); setError(""); refresh().finally(() => setLoading(false)); }}><RefreshCw size={13}/>{t("Retry")}</Button></Callout> : null}
    {notice ? <Callout title={t("Quotation updated")} tone="success">{notice}</Callout> : null}
    {state?.definition ? <>
      {dirty && missing ? <p className={styles.muted}>{t("Save the current sheet edits before adding the remaining scope.")}</p> : null}
      {(missing || comparison.changed.length || comparison.added.length || comparison.removed.length || blockers.length) ? <section className={styles.diff}>
        <h3>{t("Review scope connection")}</h3>
        {missing ? <div><strong>{t("Not yet quoted")}</strong><ul>{uncovered.map((item) => <li key={item.id}>{item.roomName ? `${item.roomName} · ` : ""}{item.title}</li>)}</ul></div> : null}
        {blockers.length ? <div><strong>{t("Resolve before review")}</strong><ul>{blockers.map((issue) => <li key={issue.code}>{translateKnown(t, issue.message)}</li>)}</ul></div> : null}
        {comparison.changed.length ? <div><strong>{t("Changed since the previous quotation")}</strong><ul>{comparison.changed.map((item) => <li key={item.id}>{item.room} · {item.title} · {item.changes.join(", ")}</li>)}</ul></div> : null}
      </section> : null}
    </> : null}
  </section>;
}
