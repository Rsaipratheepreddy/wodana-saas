"use client";

import type { CSSProperties, ReactNode } from "react";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { documentVariables, styleById } from "@/lib/quotation/document-styles";
import { groupLines, money, plain } from "@/lib/quotation/format";
import type { BuilderLine, BuilderState } from "@/lib/quotation/types";
import styles from "./quote-document.module.css";

/**
 * The client document for a quote, in its chosen style: cover, letter, summary, items (grouped by area
 * or trade), payments, terms and acceptance. Everything priced comes from the quote itself; only the
 * look and the words are the document's. One sheet per section; long sections run onto more pages in print.
 */
export function QuoteDocumentView({ state, coverUrl, imageOf }: { state: BuilderState; coverUrl: string | null; imageOf?: (line: BuilderLine) => string | null }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const doc = state.document;
  const style = styleById(doc.style);
  const { currency, decimals } = state.quote;
  const m = (value: string | number | null) => money(value, currency, decimals, locale);
  const date = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const validUntil = state.quote.validUntil ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${state.quote.validUntil}T00:00:00Z`)) : null;
  const revision = state.family.findIndex((item) => item.id === state.quote.id) + 1 || 1;
  const reference = `Q-${state.quote.number} · R${revision}`;
  const title = doc.title || t("Interior proposal");
  const amountOf = new Map(state.pricing.lines.map((line) => [line.id, Number(line.gross) - Number(line.lineDiscount)]));
  const groups = groupLines(state.lines, doc.itemsView, state.areas, state.workPackages, { general: t("General"), noTrade: t("Other work") }).filter((group) => group.lines.length);
  const sections = doc.itemsView === "trade" ? state.pricing.trades : state.pricing.areas;
  const nameOf = (key: string) => (doc.itemsView === "trade" ? state.workPackages.find((trade) => trade.id === key)?.name ?? t("Other work") : state.areas.find((area) => area.id === key)?.name ?? t("General"));
  const sum = (lines: BuilderLine[]) => lines.filter((line) => !line.optional).reduce((acc, line) => acc + (amountOf.get(line.id) ?? 0), 0);
  const total = Number(state.pricing.total);

  const Head = ({ children }: { children: ReactNode }) => <header className={styles.pageHead}><span>{state.brand.logo ? <img src={state.brand.logo} alt="" /> : state.brand.name}</span><span>{children}</span><span>{reference}</span></header>;
  const lineRow = (line: BuilderLine, index: number) => <tr key={line.id} data-optional={line.optional || undefined}>
    <td>{index + 1}</td>
    {doc.showImages ? <td className={styles.pictureCell}>{imageOf?.(line) ? <img src={imageOf(line)!} alt="" /> : null}</td> : null}
    <td><strong>{line.title}</strong>{doc.showDescriptions && line.description ? <small>{line.description}</small> : null}{line.optional ? <em>{t("Optional")}</em> : null}{line.kind === "client_supplied" ? <em>{t("Supplied by the client")}</em> : null}</td>
    <td>{plain(line.quantity, locale)} {line.unit}</td>
    {doc.showRates ? <td>{m(line.rate)}</td> : null}
    <td>{m(amountOf.get(line.id) ?? 0)}</td>
  </tr>;
  const table = (lines: BuilderLine[]) => <table className={styles.items} data-table={style.table}>
    <thead><tr><th>#</th>{doc.showImages ? <th><span className={styles.srOnly}>{t("Picture")}</span></th> : null}<th>{t("Item")}</th><th>{t("Qty")}</th>{doc.showRates ? <th>{t("Rate")}</th> : null}<th>{t("Amount")}</th></tr></thead>
    <tbody>{lines.map(lineRow)}</tbody>
  </table>;

  return <div className={styles.document} style={documentVariables(style, state.brand.primaryColor, doc.accent) as CSSProperties} data-style={style.id}>
    {doc.sections.cover ? <section className={styles.page} data-cover={style.cover} aria-label={t("Cover")}>
      {coverUrl ? <div className={styles.coverImage} style={{ backgroundImage: `url("${coverUrl}")` }} role="img" aria-label={t("Cover image")} /> : <div className={styles.coverImage} data-empty />}
      <div className={styles.coverText}>
        <div className={styles.brand}>{state.brand.logo ? <img src={state.brand.logo} alt={state.brand.name} /> : <strong>{state.brand.name}</strong>}</div>
        <div className={styles.coverTitle}>
          <span className={styles.kicker}>{reference}</span>
          <h1>{title}</h1>
          {doc.subtitle ? <p>{doc.subtitle}</p> : null}
        </div>
        <dl className={styles.coverFacts}>
          <div><dt>{t("Prepared for")}</dt><dd>{state.client.name}</dd></div>
          {state.client.project ? <div><dt>{t("Project")}</dt><dd>{state.client.project}</dd></div> : null}
          {state.client.address ? <div><dt>{t("Location")}</dt><dd>{state.client.address}</dd></div> : null}
          <div><dt>{t("Date")}</dt><dd>{date}</dd></div>
        </dl>
      </div>
    </section> : null}

    {doc.sections.intro && doc.intro ? <section className={styles.page} aria-label={t("Introduction")}>
      <Head>{t("Introduction")}</Head>
      <div className={styles.letter}>
        <p className={styles.salutation}>{t("Dear {name},", { name: state.client.name })}</p>
        {doc.intro.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        <p className={styles.signoff}>{t("With kind regards,")}<br /><strong>{state.brand.name}</strong></p>
      </div>
    </section> : null}

    {doc.sections.summary ? <section className={styles.page} aria-label={t("Summary")}>
      <Head>{t("Summary")}</Head>
      <h2>{t("Summary")}</h2>
      <table className={styles.summary}>
        <tbody>{sections.filter((section) => Number(section.gross)).map((section) => <tr key={section.key}><th>{nameOf(section.key)}</th><td>{m(section.net)}</td></tr>)}</tbody>
      </table>
      <Totals state={state} m={m} />
      {validUntil ? <p className={styles.note}>{t("This quotation is valid until {date}.", { date: validUntil })}</p> : null}
    </section> : null}

    {doc.sections.items ? <section className={styles.page} aria-label={t("Items")}>
      <Head>{t("Items")}</Head>
      <h2>{t("Scope and pricing")}</h2>
      {groups.map((group) => <div key={group.key} className={styles.group}>
        <div className={styles.groupHead}><h3>{group.name}</h3><span>{m(sum(group.lines))}</span></div>
        {doc.itemsDetail === "lines" ? group.children ? group.children.map((child) => <div key={child.key} className={styles.subgroup}><h4>{child.name}</h4>{table(child.lines)}</div>) : table(group.lines) : null}
      </div>)}
      <Totals state={state} m={m} />
    </section> : null}

    {doc.sections.payments && state.quote.paymentTerms.length ? <section className={styles.page} aria-label={t("Payments")}>
      <Head>{t("Payments")}</Head>
      <h2>{t("Payment schedule")}</h2>
      <table className={styles.items} data-table={style.table}>
        <thead><tr><th>{t("Milestone")}</th><th>{t("When")}</th><th>%</th><th>{t("Amount")}</th></tr></thead>
        <tbody>{state.quote.paymentTerms.map((term) => <tr key={term.id}><td><strong>{term.title}</strong></td><td>{term.trigger}</td><td>{plain(term.percent, locale, 2)}%</td><td>{m((total * term.percent) / 100)}</td></tr>)}</tbody>
      </table>
    </section> : null}

    {doc.sections.terms && (doc.terms || doc.exclusions) ? <section className={styles.page} aria-label={t("Terms")}>
      <Head>{t("Terms")}</Head>
      {doc.terms ? <><h2>{t("Terms and conditions")}</h2><div className={styles.prose}>{doc.terms.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)}</div></> : null}
      {doc.exclusions ? <><h2>{t("Exclusions")}</h2><div className={styles.prose}>{doc.exclusions.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)}</div></> : null}
    </section> : null}

    {doc.sections.acceptance ? <section className={styles.page} aria-label={t("Acceptance")}>
      <Head>{t("Acceptance")}</Head>
      <h2>{t("Acceptance")}</h2>
      <p className={styles.note}>{t("By signing, you accept this quotation ({reference}) for {amount}, with the payment schedule and terms above.", { reference, amount: m(state.pricing.total) })}</p>
      <div className={styles.signatures}>
        {[t("For the client"), t("For {company}", { company: state.brand.name })].map((label) => <div key={label}>
          <span className={styles.signLine} /><strong>{label}</strong><small>{t("Name, signature and date")}</small>
        </div>)}
      </div>
    </section> : null}
  </div>;
}

function Totals({ state, m }: { state: BuilderState; m: (value: string | number | null) => string }) {
  const t = useT();
  const { pricing } = state;
  const discounts = Number(pricing.discounts.total);
  return <dl className={styles.totals}>
    <div><dt>{t("Subtotal")}</dt><dd>{m(pricing.subtotal)}</dd></div>
    {discounts ? <div><dt>{t("Discount")}</dt><dd>−{m(pricing.discounts.total)}</dd></div> : null}
    {Number(pricing.tax) ? <div><dt>{t("Tax")}</dt><dd>{m(pricing.tax)}</dd></div> : null}
    <div className={styles.grand}><dt>{t("Total")}</dt><dd>{m(pricing.total)}</dd></div>
    {Number(pricing.optionalTotal) ? <div className={styles.optional}><dt>{t("Optional items")}</dt><dd>+{m(pricing.optionalTotal)}</dd></div> : null}
  </dl>;
}
