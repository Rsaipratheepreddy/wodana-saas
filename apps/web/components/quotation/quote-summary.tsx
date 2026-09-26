"use client";

import { useState } from "react";
import { Percent } from "lucide-react";
import { Button, IconButton, SegmentedControl, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi } from "@/lib/quotation/client";
import { money, plain } from "@/lib/quotation/format";
import type { BuilderState } from "@/lib/quotation/types";
import { PaymentsPanel } from "./quote-flow";
import styles from "./quote-builder.module.css";

type Target = { scope: "area" | "trade" | "quote"; target: string; name: string };

/** The quote's totals, top to bottom in the order they're worked out, with the quote discount and tax. */
export function QuoteSummary({ state, api, onState, onError, discountFor, onDiscountFor, totalComments }: {
  state: BuilderState; api: ReturnType<typeof quoteApi>; onState: (state: BuilderState) => void; onError: (message: string) => void;
  discountFor: Target | null; onDiscountFor: (target: Target | null) => void; totalComments?: React.ReactNode;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const { currency, decimals } = state.quote;
  const { pricing } = state;
  const m = (value: string | null) => money(value, currency, decimals, locale);
  const quoteDiscount = state.discounts.find((item) => item.scope === "quote");
  const floor = state.settings.marginFloorPercent;
  const belowFloor = pricing.margin !== null && floor !== null && Number(pricing.margin) < Number(floor);
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
        <div className={styles.muted} data-alert={belowFloor || undefined}><dt>{t("Margin")}</dt><dd>{pricing.margin === null ? "—" : `${plain(pricing.margin, locale, 1)}%`}</dd></div>
      </> : null}
    </dl>
    <PaymentsPanel state={state} api={api} onState={onState} onError={onError} />
    {state.checks.length && state.quote.status === "draft" ? <section className={styles.checks} aria-label={t("To fix before sending")}>
      <h3>{t("To fix before sending")}<small>{state.checks.length}</small></h3>
      <ul>{state.checks.map((check, index) => <li key={`${check.code}-${check.lineId ?? index}`} data-tone={check.tone}>{t(check.code as never, check.values)}</li>)}</ul>
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
  const [rate, setRate] = useState(state.quote.taxRate);
  const save = async () => {
    const next = rate.replace(/[^\d.]/g, "") || "0";
    if (Number(next) === Number(state.quote.taxRate)) return;
    try { onState(await api.tax(next)); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); setRate(state.quote.taxRate); }
  };
  return <div>
    <dt className={styles.withAction}>{t("Tax")}
      <input className={styles.taxInput} aria-label={t("Tax %")} inputMode="decimal" disabled={!state.canEdit} value={rate} onChange={(event) => setRate(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />%
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
  return <form className={styles.discountForm} onSubmit={(event) => { event.preventDefault(); void run(value || "0"); }}>
    <h3>{t("Discount on {name}", { name: target.name })}</h3>
    <SegmentedControl label={t("Discount type")} value={kind} onChange={(next) => setKind(next as "percent" | "amount")} options={[{ id: "percent", label: "%" }, { id: "amount", label: state.quote.currency }]} />
    <TextInput label={kind === "percent" ? t("Percent") : t("Amount")} inputMode="decimal" value={value} onChange={(next) => setValue(next.replace(/[^\d.]/g, ""))}
      description={kind === "percent" && approvalAt ? t("Above {percent}% needs approval.", { percent: approvalAt }) : undefined} />
    <TextInput label={t("Reason · optional")} value={reason} onChange={setReason} />
    <div className={styles.formActions}>
      {current ? <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void run("0")}>{t("Remove")}</Button> : null}
      <span className={styles.spacer} />
      <Button size="compact" isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button>
      <Button size="compact" type="submit" variant="primary" isLoading={busy} isDisabled={!value}>{t("Save")}</Button>
    </div>
  </form>;
}
