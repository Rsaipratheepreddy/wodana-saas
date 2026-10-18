"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, EmptyState, IconButton, InlineNotice, SelectField, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { catalogApi } from "@/lib/workspace/catalog-v2";
import styles from "./catalog-page.module.css";

export type PriceRow = { id: string; priceBookId: string; method: string; status: string; version: number; price: string | null; rate?: string | null; cost?: string | null; markupPercent?: string | null; minimumCharge?: string | null; labour?: string | null; marginPercent?: string | null; currency: string };
type Book = { id: string; name: string; currency: string; status: string; version: number };
type Draft = { method: string; price: string; rate: string; minimumCharge: string; cost: string; markupPercent: string; labour: string; marginPercent: string; tiers: Array<{ fromQuantity: string; price: string }> };

const blank = (method = "fixed"): Draft => ({ method, price: "", rate: "", minimumCharge: "", cost: "", markupPercent: "", labour: "", marginPercent: "", tiers: [{ fromQuantity: "1", price: "" }] });
const number = (value: string) => value.replace(/[^\d.]/g, "");

/** Prices of one item across price lists: set, QS review, go live. */
export function CatalogPrices({ workspaceId, catalogId, itemId, itemType, unitCode, prices, canManage, canReview, currency, locale, onChanged }: {
  workspaceId: string; catalogId: string; itemId: string; itemType: string; unitCode: string; prices: PriceRow[];
  canManage: boolean; canReview: boolean; currency: string; locale?: string; onChanged: () => void;
}) {
  const t = useT();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const loadBooks = useCallback(() => catalogApi<Book[]>(workspaceId, `${catalogId}/price-books`).then(setBooks).catch(() => setBooks([])), [workspaceId, catalogId]);
  useEffect(() => { void loadBooks(); }, [loadBooks]);

  const methods = [
    { id: "fixed", label: t("Fixed price") }, { id: "per_measure", label: `${t("Rate per")} ${unitCode}` },
    { id: "cost_plus", label: t("Cost + markup") }, { id: "tiered", label: t("Quantity tiers") },
    ...(itemType === "assembly" ? [{ id: "assembly_rollup", label: t("Sum of components") }] : []),
  ];
  const methodLabel = (id: string) => methods.find((method) => method.id === id)?.label ?? id.replace(/_/g, " ");
  const money = (value: string | null | undefined, code: string) => {
    if (!value) return "";
    try { return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(Number(value)); } catch { return `${code} ${value}`; }
  };
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage(null);
    try { await work(); setMessage({ tone: "success", text: success }); onChanged(); }
    catch (reason) { setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "" }); }
    finally { setBusy(false); }
  };

  if (!books) return <Skeleton lines={3} />;
  if (!books.length) {
    return <EmptyState illustration={null} title={t("No price list yet")} description={t("Create a price list to price items in this catalog.")}
      action={canManage ? <Button isLoading={busy} onPress={() => void run(async () => { await catalogApi(workspaceId, `${catalogId}/price-books`, { body: { name: t("Standard prices"), currency } }); await loadBooks(); }, t("Price list created."))} variant="primary">{t("Create price list")}</Button> : null} />;
  }

  const open = (bookId: string, current?: PriceRow) => {
    setEditing(bookId); setMessage(null);
    setDraft(current ? { ...blank(current.method), price: current.price ? String(Number(current.price)) : "", rate: current.rate ? String(Number(current.rate)) : "", cost: current.cost ? String(Number(current.cost)) : "", markupPercent: current.markupPercent ? String(Number(current.markupPercent)) : "", minimumCharge: current.minimumCharge ? String(Number(current.minimumCharge)) : "", labour: current.labour ? String(Number(current.labour)) : "", marginPercent: current.marginPercent ? String(Number(current.marginPercent)) : "" } : blank());
  };
  const save = (bookId: string) => run(async () => {
    const body: Record<string, unknown> = { method: draft.method };
    for (const key of ["price", "rate", "minimumCharge", "cost", "markupPercent", "labour", "marginPercent"] as const) if (draft[key]) body[key] = draft[key];
    if (draft.method === "tiered") body.tiers = draft.tiers.filter((tier) => tier.fromQuantity && tier.price);
    await catalogApi(workspaceId, `price-books/${bookId}/items/${itemId}`, { method: "PUT", body });
    setEditing(null);
  }, t("Saved as a draft. It needs a review before it goes live."));
  const field = (key: keyof Omit<Draft, "method" | "tiers">, label: string, suffix?: string) =>
    <TextInput inputType="text" isRequired label={label} onChange={(value) => setDraft((current) => ({ ...current, [key]: number(value) }))} suffix={suffix} value={draft[key]} />;

  return <div className={styles.prices}>
    {books.map((book) => {
      const current = prices.find((price) => price.priceBookId === book.id);
      return <section className={styles.priceBook} key={book.id} aria-label={book.name}>
        <header><strong>{book.name}</strong><small>{book.currency}{book.status !== "active" ? ` · ${book.status}` : ""}</small></header>
        {editing === book.id ? <div className={styles.form}>
          <SelectField items={methods} label={t("How it is priced")} onSelectionChange={(key) => setDraft((current) => ({ ...current, method: String(key) }))} selectedKey={draft.method} />
          {draft.method === "fixed" ? field("price", t("Price"), `${book.currency} / ${unitCode}`) : null}
          {draft.method === "per_measure" ? <>{field("rate", t("Rate"), `${book.currency} / ${unitCode}`)}<TextInput label={t("Minimum charge")} onChange={(value) => setDraft((current) => ({ ...current, minimumCharge: number(value) }))} suffix={book.currency} value={draft.minimumCharge} /></> : null}
          {draft.method === "cost_plus" ? <>{field("cost", t("Cost"), book.currency)}{field("markupPercent", t("Markup"), "%")}</> : null}
          {draft.method === "assembly_rollup" ? <><TextInput label={t("Labour")} onChange={(value) => setDraft((current) => ({ ...current, labour: number(value) }))} suffix={book.currency} value={draft.labour} /><TextInput label={t("Margin")} onChange={(value) => setDraft((current) => ({ ...current, marginPercent: number(value) }))} suffix="%" value={draft.marginPercent} /></> : null}
          {draft.method === "tiered" ? <div className={styles.tiers}>
            {draft.tiers.map((tier, index) => <div className={styles.tierRow} key={index}>
              <TextInput isRequired label={`${t("From quantity")} (${unitCode})`} onChange={(value) => setDraft((current) => ({ ...current, tiers: current.tiers.map((row, at) => at === index ? { ...row, fromQuantity: number(value) } : row) }))} value={tier.fromQuantity} />
              <TextInput isRequired label={t("Price")} onChange={(value) => setDraft((current) => ({ ...current, tiers: current.tiers.map((row, at) => at === index ? { ...row, price: number(value) } : row) }))} suffix={book.currency} value={tier.price} />
              {draft.tiers.length > 1 ? <IconButton aria-label={t("Remove tier")} onPress={() => setDraft((current) => ({ ...current, tiers: current.tiers.filter((_, at) => at !== index) }))}><Trash2 aria-hidden="true" size={15} /></IconButton> : null}
            </div>)}
            <Button onPress={() => setDraft((current) => ({ ...current, tiers: [...current.tiers, { fromQuantity: "", price: "" }] }))} size="compact" variant="quiet"><Plus aria-hidden="true" size={14} />{t("Add tier")}</Button>
          </div> : null}
          <div className={styles.actions}><Button onPress={() => setEditing(null)}>{t("Cancel")}</Button><Button isLoading={busy} onPress={() => void save(book.id)} variant="primary">{t("Save price")}</Button></div>
        </div> : current ? <div className={styles.priceLine}>
          <span dir="ltr" className={styles.priceValue}>{current.method === "tiered" ? methodLabel("tiered") : money(current.price ?? current.rate ?? null, current.currency) || methodLabel(current.method)}</span>
          <small>{methodLabel(current.method)}</small>
          <Badge tone={current.status === "active" ? "success" : current.status === "reviewed" ? "info" : "neutral"}>{current.status === "active" ? t("Live") : current.status === "reviewed" ? t("Reviewed") : t("Draft")}</Badge>
          <span className={styles.priceActions}>
            {current.status === "draft" && canReview ? <Button isLoading={busy} onPress={() => void run(() => catalogApi(workspaceId, `prices/${current.id}/review`, { body: { version: current.version, decision: "reviewed" } }), t("Reviewed."))} size="compact">{t("Mark reviewed")}</Button> : null}
            {current.status === "reviewed" && canManage ? <Button isLoading={busy} onPress={() => void run(() => catalogApi(workspaceId, `prices/${current.id}/review`, { body: { version: current.version, decision: "active" } }), t("The price is live."))} size="compact" variant="primary">{t("Go live")}</Button> : null}
            {canManage ? <Button onPress={() => open(book.id, current)} size="compact" variant="quiet">{t("Change")}</Button> : null}
          </span>
        </div> : <div className={styles.priceLine}><span className={styles.muted}>{t("Price unavailable")}</span>{canManage ? <Button onPress={() => open(book.id)} size="compact" variant="quiet"><Plus aria-hidden="true" size={14} />{t("Set price")}</Button> : null}</div>}
      </section>;
    })}
    {message ? <InlineNotice message={message.text} tone={message.tone} /> : null}
  </div>;
}
