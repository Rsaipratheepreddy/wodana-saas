"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Form, SelectField, TextInput } from "@/design-system";
import type { ChangeDisposition, ChangeRequest, CommercialState } from "@/lib/commercial/types";
import { changeKinds } from "@/lib/commercial/change-cases";
import { statusLabel } from "@/lib/commercial/client";
import { tKey } from "@/lib/i18n/keys";
import styles from "./controlled-change-case.module.css";

const actions: { value: ChangeDisposition["action"]; label: string }[] = [
  { value: "cancel", label: tKey("Cancel") },
  { value: "hold_and_replan", label: tKey("Hold and replan") },
  { value: "return_or_credit", label: tKey("Return or credit") },
  { value: "retain_as_stock", label: tKey("Retain as stock") },
  { value: "rework", label: tKey("Rework") },
  { value: "complete_as_client_owned", label: tKey("Complete as client-owned") },
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
  const t = useT();
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
  return <section className={styles.case} aria-label={t("Change case control")}>
    <div className={styles.meta}>
      <span>{t("Type")}{" "}<strong>{t((changeKinds.find((kind) => kind.value === control.kind)?.label ?? control.kind) as never)}</strong></span>
      <span>{t("Contract items")}{" "}<strong>{control.sourceLineIds.length || t("New work")}</strong></span>
      <span>{t("Client documents")}{" "}<strong>{control.quoteIds.length || t("Not prepared")}</strong></span>
    </div>
    {!impact && !locked && state.canEdit && <Button size="compact" isDisabled={busy}
      onPress={() => void run("assess_change_case", { requestId: request.id })}>{t("Assess impact")}</Button>}
    {impact && <>
      <p className={styles.muted}>{impact.targets.length === 1 ? t("1 affected delivery record") : impact.targets.length ? t("{count} affected delivery records", { count: impact.targets.length }) : t("No delivery records affected yet")}
        {impact.hasReportedOrCompletedWork ? ` · ${t("Reported or completed work needs explicit treatment")}` : ""}
        {impact.bookingCount ? ` · ${impact.bookingCount === 1 ? t("1 project booking to review") : t("{count} project bookings to review", { count: impact.bookingCount })}` : ""}</p>
      {impact.targets.length > 0 && <Form className={styles.targets} fieldMarkers="none" onSubmit={(event) => event.preventDefault()}>{impact.targets.map((target) => {
        const value = dispositions.find((item) => item.targetKind === target.kind && item.targetId === target.id);
        return <div className={styles.target} key={`${target.kind}:${target.id}`}>
          <div><strong>{target.title}</strong><small>{target.kind.replaceAll("_", " ")} · {target.status}</small></div>
          <SelectField label={t("Decision")} placeholder={t("Choose a decision")} items={actions.map((action) => ({ id: action.value, label: t(action.label as never) }))}
            isDisabled={!state.canEdit || locked || Boolean(control.quoteIds.length)} selectedKey={value?.action || null}
            onSelectionChange={(key) => update(target, { action: String(key) as ChangeDisposition["action"] })} />
          <TextInput label={t("Reason / next action")} isDisabled={!state.canEdit || locked || Boolean(control.quoteIds.length)}
            value={value?.note ?? ""} onChange={(note) => update(target, { note })} />
        </div>;
      })}</Form>}
      {!locked && state.canEdit && !control.quoteIds.length && <div className={styles.actions}>
        {impact.targets.length > 0 && <Button size="compact" isDisabled={busy || !dispositionComplete}
          onPress={() => void run("set_change_dispositions", { requestId: request.id, dispositions })}>{t("Save impact decisions")}</Button>}
        {control.kind === "price_correction" && <SelectField label={t("Price effect")} items={[{ id: "addition", label: t("Additional charge") }, { id: "deduction", label: t("Credit") }]}
          selectedKey={financialDirection} onSelectionChange={(key) => setFinancialDirection(String(key) as "addition" | "deduction")} />}
        <Button size="compact" variant="primary" isDisabled={busy || workingQuote ||
          impact.targets.length > 0 && control.dispositions.length !== impact.targets.length}
          onPress={() => void run("prepare_change_variations", { requestId: request.id,
            ...(control.kind === "price_correction" ? { financialDirection } : {}) })}>{control.kind === "replacement" ? t("Prepare client documents") : t("Prepare client document")}</Button>
      </div>}
      {workingQuote && !control.quoteIds.length && <p className={styles.muted}>{t("Finish the existing draft quotation before preparing a change document.")}</p>}
    </>}
    {quoteLinks.length > 0 && <div className={styles.links}>
      {quoteLinks.map((quote) => quote && <Link key={quote.id} href={`/workspace/pre-projects/cases/${state.caseId}/quotations?quote=${quote.id}`}>
        {quote.direction === "deduction" ? t("Credit") : t("Addition")} · V{quote.number} · {statusLabel[quote.status] ? t(statusLabel[quote.status] as never) : quote.status.replaceAll("_", " ")} →
      </Link>)}
    </div>}
  </section>;
}
