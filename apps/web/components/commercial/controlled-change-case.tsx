"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Form, SelectField, TextInput } from "@/design-system";
import type { ChangeDisposition, ChangeRequest, CommercialState } from "@/lib/commercial/types";
import { changeKinds } from "@/lib/commercial/change-cases";
import styles from "./controlled-change-case.module.css";

const actions: { value: ChangeDisposition["action"]; label: string }[] = [
  { value: "cancel", label: "Cancel" },
  { value: "hold_and_replan", label: "Hold and replan" },
  { value: "return_or_credit", label: "Return or credit" },
  { value: "retain_as_stock", label: "Retain as stock" },
  { value: "rework", label: "Rework" },
  { value: "complete_as_client_owned", label: "Complete as client-owned" },
];
type DispositionDraft = Omit<ChangeDisposition, "action"> & { action: ChangeDisposition["action"] | "" };

export function ControlledChangeCase({ request, state, busy, run }: {
  request: ChangeRequest;
  state: CommercialState;
  busy: boolean;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
}) {
  const control = request.control;
  if (!control) return null;
  return <ChangeCaseBody key={`${request.id}:${control.impact?.assessedAt ?? "unassessed"}`} request={request} state={state} busy={busy} run={run} />;
}

function ChangeCaseBody({ request, state, busy, run }: {
  request: ChangeRequest;
  state: CommercialState;
  busy: boolean;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
}) {
  const control = request.control!;
  const impact = control.impact;
  const [dispositions, setDispositions] = useState<DispositionDraft[]>(control.dispositions);
  const [financialDirection, setFinancialDirection] = useState<"addition" | "deduction">("addition");
  useEffect(() => setDispositions(control.dispositions), [control.dispositions]);
  const quoteLinks = control.quoteIds.map((id) => state.data.quotes.find((quote) => quote.id === id)).filter((quote) => Boolean(quote));
  const locked = ["resolved", "declined", "withdrawn"].includes(request.status);
  const workingQuote = state.data.quotes.some((quote) => ["draft", "internal_review", "internal_approved"].includes(quote.status));
  const dispositionComplete = (impact?.targets ?? []).every((target) =>
    dispositions.some((item) => item.targetKind === target.kind && item.targetId === target.id && item.action && item.note.trim()),
  );
  function update(target: NonNullable<typeof impact>["targets"][number], change: Partial<DispositionDraft>) {
    setDispositions((current) => {
      const rest = current.filter((item) => !(item.targetKind === target.kind && item.targetId === target.id));
      const previous = current.find((item) => item.targetKind === target.kind && item.targetId === target.id);
      return [...rest, { targetKind: target.kind, targetId: target.id, action: previous?.action ?? "", note: previous?.note ?? "", ...change }];
    });
  }
  return <section className={styles.case} aria-label="Change case control">
    <div className={styles.meta}>
      <span>Type <strong>{changeKinds.find((kind) => kind.value === control.kind)?.label ?? control.kind}</strong></span>
      <span>Contract items <strong>{control.sourceLineIds.length || "New work"}</strong></span>
      <span>Client documents <strong>{control.quoteIds.length || "Not prepared"}</strong></span>
    </div>
    {!impact && !locked && state.canEdit && <Button size="compact" isDisabled={busy}
      onPress={() => void run("assess_change_case", { requestId: request.id })}>Assess impact</Button>}
    {impact && <>
      <p className={styles.muted}>{impact.targets.length ? `${impact.targets.length} affected delivery record${impact.targets.length === 1 ? "" : "s"}` : "No delivery records affected yet"}
        {impact.hasReportedOrCompletedWork ? " · Reported or completed work needs explicit treatment" : ""}
        {impact.bookingCount ? ` · ${impact.bookingCount} project booking${impact.bookingCount === 1 ? "" : "s"} to review` : ""}</p>
      {impact.targets.length > 0 && <Form className={styles.targets} onSubmit={(event) => event.preventDefault()}>{impact.targets.map((target) => {
        const value = dispositions.find((item) => item.targetKind === target.kind && item.targetId === target.id);
        return <div className={styles.target} key={`${target.kind}:${target.id}`}>
          <div><strong>{target.title}</strong><small>{target.kind.replaceAll("_", " ")} · {target.status}</small></div>
          <SelectField label="Decision" placeholder="Choose a decision" items={actions.map((action) => ({ id: action.value, label: action.label }))}
            isDisabled={!state.canEdit || locked || Boolean(control.quoteIds.length)} selectedKey={value?.action || null}
            onSelectionChange={(key) => update(target, { action: String(key) as ChangeDisposition["action"] })} />
          <TextInput label="Reason / next action" isDisabled={!state.canEdit || locked || Boolean(control.quoteIds.length)}
            value={value?.note ?? ""} onChange={(note) => update(target, { note })} />
        </div>;
      })}</Form>}
      {!locked && state.canEdit && !control.quoteIds.length && <div className={styles.actions}>
        {impact.targets.length > 0 && <Button size="compact" isDisabled={busy || !dispositionComplete}
          onPress={() => void run("set_change_dispositions", { requestId: request.id, dispositions })}>Save impact decisions</Button>}
        {control.kind === "price_correction" && <SelectField label="Price effect" items={[{ id: "addition", label: "Additional charge" }, { id: "deduction", label: "Credit" }]}
          selectedKey={financialDirection} onSelectionChange={(key) => setFinancialDirection(String(key) as "addition" | "deduction")} />}
        <Button size="compact" variant="primary" isDisabled={busy || workingQuote ||
          impact.targets.length > 0 && control.dispositions.length !== impact.targets.length}
          onPress={() => void run("prepare_change_variations", { requestId: request.id,
            ...(control.kind === "price_correction" ? { financialDirection } : {}) })}>Prepare client document{control.kind === "replacement" ? "s" : ""}</Button>
      </div>}
      {workingQuote && !control.quoteIds.length && <p className={styles.muted}>Finish the existing draft quotation before preparing a change document.</p>}
    </>}
    {quoteLinks.length > 0 && <div className={styles.links}>
      {quoteLinks.map((quote) => quote && <Link key={quote.id} href={`/workspace/pre-projects/cases/${state.caseId}/quotations?quote=${quote.id}`}>
        {quote.direction === "deduction" ? "Credit" : "Addition"} · V{quote.number} · {quote.status.replaceAll("_", " ")} →
      </Link>)}
    </div>}
  </section>;
}
