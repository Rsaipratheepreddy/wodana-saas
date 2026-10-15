"use client";

import { useState } from "react";
import { Badge, Button, FormDialog, InlineNotice, TextAreaField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { BoqAction, BoqState, BoqStateEvent, BoqStatus } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;
const COMMANDS: Record<BoqAction, string> = { verify: "verify_boq", qs_approve: "qs_approve_boq", return: "return_boq", lock: "lock_boq" };
const TONES: Record<BoqStatus, "neutral" | "info" | "success" | "warning"> = { draft: "neutral", technical_verified: "info", qs_approved: "success", locked: "success" };

/**
 * PLM-167 / PLM-168 / PLM-169: where the project BOQ stands (draft, verified by the technical team, approved by the QS as
 * BOQ R-n, locked), the one step open to this person, the revisions the QS approved and the history. Lines held for a
 * price the client hasn't approved are named here too.
 */
export function ProjectBoqState({ boq, currency, run }: { boq: BoqState; currency: string; run: Run }) {
  const t = useT();
  const format = useProjectFormat();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<BoqAction | null>(null);
  const status: Record<BoqStatus, string> = { draft: t("Draft"), technical_verified: t("Verified by the technical team"), qs_approved: t("Approved by the QS"), locked: t("Locked") };
  const action: Record<BoqAction, string> = { verify: t("Verify"), qs_approve: t("QS approve"), return: t("Return to draft"), lock: t("Lock") };
  const act = async (next: BoqAction) => {
    if (next === "return") { setReason(""); setReturning(true); return; }
    setBusy(next);
    await run(COMMANDS[next]);
    setBusy(null);
  };
  const facts = [
    boq.verifiedAt ? t("Verified by {name} on {date}", { name: boq.verifiedByName ?? "", date: format.when(boq.verifiedAt) }) : "",
    boq.approvedAt && boq.status !== "draft" ? t("Approved by {name} on {date}", { name: boq.approvedByName ?? "", date: format.when(boq.approvedAt) }) : "",
    boq.lockedAt ? t("Locked by {name} on {date}", { name: boq.lockedByName ?? "", date: format.when(boq.lockedAt) }) : "",
    boq.status === "draft" && boq.returnedAt ? t("Returned by {name}: {reason}", { name: boq.returnedByName ?? "", reason: boq.returnReason }) : "",
  ].filter(Boolean).join(" · ");
  const describe = (entry: BoqStateEvent) => {
    const detail = entry.detail as Record<string, string | null>;
    switch (entry.kind) {
      case "drafted": return t("Draft BOQ created");
      case "verified": return t("Verified by the technical team");
      case "qs_approved": return t("Approved by the QS as {revision}", { revision: String(detail.revision ?? "") });
      case "returned": return t("Returned to draft: {reason}", { reason: String(detail.reason ?? "") });
      case "locked": return t("Locked");
      default: return t("Changed by {variation}", { variation: String(detail.by ?? "") });
    }
  };
  return <section className={styles.draft} aria-label={t("BOQ status")} data-tour="project-boq-state">
    <div className={styles.scopeToolbar}>
      <span className={styles.toolbarActions}>
        <Badge tone={TONES[boq.status]}>{status[boq.status]}</Badge>
        {boq.label ? <strong>{t("BOQ {revision}", { revision: boq.label })}</strong> : null}
        {boq.label && !boq.current && boq.status !== "draft" ? <span className={styles.muted}>{t("Changed since {revision}", { revision: boq.label })}</span> : null}
      </span>
      {boq.actions.length ? <div className={styles.toolbarActions}>
        {boq.actions.map((next) => <Button key={next} size="compact" variant={next === "return" ? "quiet" : next === "lock" ? "secondary" : "primary"} isLoading={busy === next}
          onPress={() => void act(next)}>{action[next]}</Button>)}
      </div> : null}
    </div>
    {facts ? <p className={styles.muted}>{facts}</p> : null}
    {boq.priceHolds.length ? <InlineNotice tone="error" message={boq.priceHolds.length === 1 ? t("1 item waits for the client's approved price: {reasons}", { reasons: boq.priceHolds[0].reason })
      : t("{count} items wait for the client's approved price: {reasons}", { count: boq.priceHolds.length, reasons: boq.priceHolds.slice(0, 3).map((hold) => hold.reason).join("; ") })} /> : null}
    {boq.revisions.length ? <ul className={styles.history} aria-label={t("Approved revisions")}>
      {boq.revisions.map((revision) => <li key={revision.id}>
        <span>{t("BOQ {revision}", { revision: revision.label })} · {revision.lines === 1 ? t("1 item") : t("{count} items", { count: revision.lines })}{revision.total !== null ? ` · ${format.money(revision.total, currency)}` : ""}</span>
        <small>{t("Approved by {name} on {date}", { name: revision.approvedByName, date: format.when(revision.approvedAt) })}{revision.note ? ` · ${revision.note}` : ""}</small>
      </li>)}
    </ul> : null}
    {boq.history.length ? <ol className={styles.history} aria-label={t("BOQ history")}>
      {boq.history.slice(0, 6).map((entry) => <li key={entry.id}><span>{describe(entry)}</span><small>{[entry.byName, format.when(entry.at)].filter(Boolean).join(" · ")}</small></li>)}
    </ol> : null}
    {returning ? <FormDialog size="md" title={t("Return to draft")} onClose={() => setReturning(false)} submitLabel={t("Return to draft")} isDirty={Boolean(reason.trim())}
      isSubmitDisabled={!reason.trim()} onSubmit={async () => { await run("return_boq", { reason: reason.trim() }, { inDialog: true }); setReturning(false); }}>
      <TextAreaField label={t("Why it goes back to draft")} isRequired value={reason} onChange={setReason} />
    </FormDialog> : null}
  </section>;
}
