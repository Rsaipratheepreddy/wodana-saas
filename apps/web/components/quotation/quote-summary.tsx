"use client";

import { useState } from "react";
import Link from "next/link";
import { Percent, Sparkles } from "lucide-react";
import { Button, Form, IconButton, MoneyField, PercentageInput, SegmentedControl, submitOnModEnter, TextInput, useDesignSystem, VisuallyHidden } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import { money, plain } from "@/lib/quotation/format";
import type { BuilderState } from "@/lib/quotation/types";
import styles from "./quote-builder.module.css";

/** Checks the assistant can put right by adding lines. */
const AI_FIXABLE = new Set(["{name} is included but no line covers it", "{name} has approved designs but no items"]);

type Target = { scope: "area" | "trade" | "quote"; target: string; name: string };

/** The quote's totals, top to bottom in the order they're worked out, with the quote discount and tax. */
export function QuoteSummary({ state, api, onState, onError, discountFor, onDiscountFor, totalComments, onFocusLine, onFix, onPayments, requirementHref }: {
  state: BuilderState; api: ReturnType<typeof quoteApi>; onState: (state: BuilderState) => void; onError: (message: string) => void;
  discountFor: Target | null; onDiscountFor: (target: Target | null) => void; totalComments?: React.ReactNode;
  /** A check about one line: show that line. */
  onFocusLine?: (lineId: string) => void;
  /** A check the assistant can fix: ask it. */
  onFix?: (request: string) => void;
  /** The payments check: open the payment milestones. */
  onPayments?: () => void;
  /** A check about undecided requirements: where the first one to decide is. */
  requirementHref?: (requirementId: string) => string;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const { currency, decimals } = state.quote;
  const { pricing } = state;
  const m = (value: string | null) => money(value, currency, decimals, locale);
  const quoteDiscount = state.discounts.find((item) => item.scope === "quote");
  const floor = state.settings.marginFloorPercent;
  // A charged line without a cost (none entered, or zero) leaves the margin unknown: never a false 100%.
  const costMissing = pricing.cost === null || pricing.lines.some((line) => line.included && Number(line.gross) > 0 && !(Number(line.cost ?? 0) > 0));
  const belowFloor = !costMissing && pricing.margin !== null && floor !== null && Number(pricing.margin) < Number(floor);
  return <aside className={styles.summary} aria-label={t("Totals")}>
    <dl>
      <div><dt>{t("Subtotal")}</dt><dd>{m(pricing.subtotal)}</dd></div>
      {Number(pricing.discounts.line) ? <div><dt>{t("Line discounts")}</dt><dd>−{m(pricing.discounts.line)}</dd></div> : null}
      {Number(pricing.discounts.section) ? <div><dt>{t("Area and trade discounts")}</dt><dd>−{m(pricing.discounts.section)}</dd></div> : null}
      <div>
        <dt className={styles.withAction}>{quoteDiscount ? t("Discount {value}", { value: quoteDiscount.kind === "percent" ? `${plain(quoteDiscount.value, locale)}%` : "" }) : t("Discount")}
          {state.canEdit ? <IconButton aria-label={t("Discount on the whole quote")} size="compact" variant="quiet" onPress={() => onDiscountFor({ scope: "quote", target: "", name: t("the whole quote") })}><Percent aria-hidden="true" size={13} /></IconButton> : null}</dt>
        <dd>{Number(pricing.discounts.quote) ? `−${m(pricing.discounts.quote)}` : "—"}</dd>
      </div>
      <div><dt>{state.settings.pricesIncludeTax ? t("Net of tax") : t("Net")}</dt><dd>{m(pricing.net)}</dd></div>
      {state.taxCodes.length ? pricing.taxes.map((tax) => <div key={tax.rate}><dt>{t("Tax {rate}%", { rate: plain(tax.rate, locale) })}</dt><dd>{m(tax.tax)}</dd></div>)
        : <QuoteTax state={state} api={api} onState={onState} onError={onError} value={m(pricing.tax)} />}
      <div className={styles.grand}><dt className={styles.withAction}>{t("Total")}{totalComments}</dt><dd>{m(pricing.total)}</dd></div>
      {Number(pricing.optionalTotal) ? <div className={styles.muted}><dt>{t("Optional extras")}</dt><dd>+{m(pricing.optionalTotal)}</dd></div> : null}
      {state.canViewCosts ? <>
        <div className={styles.muted}><dt>{t("Cost")}</dt><dd>{pricing.cost === null ? t("Some costs missing") : m(pricing.cost)}</dd></div>
        <div className={styles.muted} data-alert={belowFloor || undefined}><dt>{t("Margin")}</dt><dd>{costMissing ? t("Cost missing") : pricing.margin === null ? "—" : `${plain(pricing.margin, locale, 1)}%`}</dd></div>
      </> : null}
    </dl>
    {state.checks.length && state.quote.status === "draft" ? <section className={styles.checks} aria-label={t("To fix before sending")}>
      <h3>{t("To fix before sending")}<small>{state.checks.length}</small></h3>
      <ul>{state.checks.map((check, index) => {
        const text = t(check.code as never, check.values);
        return <li key={`${check.code}-${check.lineId ?? index}`} data-tone={check.tone}>
          {check.lineId && onFocusLine ? <button type="button" className={styles.checkLink} onClick={() => onFocusLine(check.lineId!)}>{text}</button>
            : check.requirementId && requirementHref ? <Link className={styles.checkLink} href={requirementHref(check.requirementId)}>{text}</Link> : <span>{text}</span>}
          {check.code === "Add the payment milestones" && onPayments ? <button type="button" className={styles.fixLink} onClick={onPayments}>{t("Open payments")}</button>
            : !check.lineId && onFix && AI_FIXABLE.has(check.code) ? <button type="button" className={styles.fixLink} onClick={() => onFix(text)}><Sparkles aria-hidden="true" size={12} />{t("Fix with AI")}</button> : null}
        </li>;
      })}</ul>
    </section> : null}
    {belowFloor ? <p className={styles.alert} role="status">{t("Margin is below the {floor}% floor.", { floor: plain(floor!, locale) })}</p> : null}
    {discountFor ? <DiscountForm key={`${discountFor.scope}-${discountFor.target}`} target={discountFor} state={state} onClose={() => onDiscountFor(null)}
      onSave={async (input) => {
        try { onState(await api.discount({ scope: discountFor.scope, target: discountFor.target, ...input })); onDiscountFor(null); }
        catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
      }} /> : null}
  </aside>;
}

function QuoteTax({ state, api, onState, onError, value }: { state: BuilderState; api: ReturnType<typeof quoteApi>; onState: (state: BuilderState) => void; onError: (message: string) => void; value: string }) {
  const t = useT();
  const [rate, setRate] = useState(Number(state.quote.taxRate));
  // The rate saves when the field is left (or on Enter); a cleared field puts the saved rate back.
  const save = async (next: number) => {
    if (!Number.isFinite(next)) { setRate(Number(state.quote.taxRate)); return; }
    setRate(next);
    if (next === Number(state.quote.taxRate)) return;
    try { onState(await api.tax(String(next))); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); setRate(Number(state.quote.taxRate)); }
  };
  return <div>
    <dt className={styles.withAction}>{t("Tax")}
      <span className={styles.taxInput}><PercentageInput label={<VisuallyHidden>{t("Tax %")}</VisuallyHidden>} isDisabled={!state.canEdit} formatOptions={{ maximumFractionDigits: 4 }}
        value={rate} onChange={(next) => void save(next)} /></span>
    </dt>
    <dd>{value}</dd>
  </div>;
}

function DiscountForm({ target, state, onClose, onSave }: { target: Target; state: BuilderState; onClose: () => void; onSave: (input: { kind: "percent" | "amount"; value: string; reason: string }) => Promise<void> }) {
  const t = useT();
  const current = state.discounts.find((item) => item.scope === target.scope && item.target === target.target);
  const [kind, setKind] = useState<"percent" | "amount">(current?.kind ?? "percent");
  const [value, setValue] = useState(current?.value ?? "");
  const [reason, setReason] = useState(current?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const run = async (next: string) => { setBusy(true); await onSave({ kind, value: next, reason }); setBusy(false); };
  const approvalAt = state.settings.discountApprovalPercent;
  return <Form className={styles.discountForm} fieldMarkers="optional" onSubmit={(event) => { event.preventDefault(); void run(value || "0"); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } else submitOnModEnter(event, event.currentTarget); }}>
    <h3>{t("Discount on {name}", { name: target.name })}</h3>
    <SegmentedControl label={t("Discount type")} value={kind} onChange={(next) => { setKind(next as "percent" | "amount"); setValue(""); }} options={[{ id: "percent", label: "%" }, { id: "amount", label: state.quote.currency }]} />
    {kind === "percent"
      ? <PercentageInput isRequired label={t("Percent")} formatOptions={{ maximumFractionDigits: 2 }} value={value === "" ? Number.NaN : Number(value)} onChange={(next) => setValue(Number.isFinite(next) ? String(next) : "")}
          description={approvalAt ? t("Above {percent}% needs approval.", { percent: approvalAt }) : undefined} />
      : <MoneyField isRequired label={t("Amount")} currency={state.quote.currency} value={value} onChange={setValue} />}
    <TextInput label={t("Reason")} maxLength={300} value={reason} onChange={setReason} />
    <div className={styles.formActions}>
      {current ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void run("0")}>{t("Remove")}</Button> : null}
      <span className={styles.spacer} />
      <Button size="compact" isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button>
      <Button size="compact" type="submit" variant="primary" isLoading={busy} isDisabled={!value}>{t("Save")}</Button>
    </div>
  </Form>;
}
