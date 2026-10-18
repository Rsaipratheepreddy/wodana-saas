"use client";

import type { ReactNode } from "react";
import { Button, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { DocumentLetterhead } from "@/lib/brand/letterhead";
import { useDocumentTitle } from "@/lib/document-title";
import { useWorkspaceIdentity } from "../workspace/workspace-identity";
import { LetterheadFooter, LetterheadHeader } from "./document-letterhead";
import styles from "./print-document.module.css";

/** A CSS string literal ("Page ") from any text. */
const cssText = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/**
 * The printed page itself for every document printed from the browser (one theme with the server-made PDFs): A4
 * with even margins and "Page x of y" in the page margin at the inline end, in the reader's language and direction
 * (browsers that don't print page-margin boxes leave it out; the sheet's own footer always prints).
 */
export function PrintPageRules() {
  const t = useT();
  const { direction } = useDesignSystem();
  const [before, after = ""] = t("Page {page} of {pages}").split("{page}");
  const [middle, tail = ""] = after.split("{pages}");
  const pageNumber = [cssText(before), "counter(page)", cssText(middle), "counter(pages)", cssText(tail)].join(" ");
  // The page number sits at the inline end of the page's foot ("Powered by Wodana" is in the sheet's own footer).
  const numberBox = direction === "rtl" ? "@bottom-left" : "@bottom-right";
  return <style>{`@page { size: A4; margin: 16mm 14mm 18mm; ${numberBox} { content: ${pageNumber}; font-size: 8pt; color: var(--wd-color-text-tertiary); } }`}</style>;
}

export type DocumentFact = { label: string; value: ReactNode };
export type DocumentParty = { label: string; name: string; lines?: Array<string | null | undefined> };

/**
 * A client- or supplier-facing document on its own page, to print or save as PDF: the issuing business's
 * letterhead (else the brand), the document's name, number, state and dates at the inline end, the parties, the
 * content, the business's footer and "Powered by Wodana". `fileName` names the saved PDF ("PO-0012 Supplier").
 */
export function PrintDocument({ kind, number, state, facts = [], parties = [], aside, letterhead, brand, fileName, label, actions, preview = false, children }: {
  /** The document's name: "Purchase order", "Tax invoice". */
  kind: string;
  number?: string | null;
  /** A state chip or word beside the number. */
  state?: ReactNode;
  facts?: DocumentFact[];
  parties?: DocumentParty[];
  /** Beside the heading: a scan code. */
  aside?: ReactNode;
  letterhead?: DocumentLetterhead | null;
  /** The brand to print without a letterhead; the workspace's own name and logo by default. */
  brand?: { name: string; logoUrl?: string | null };
  fileName: Array<string | null | undefined>;
  /** The article's accessible name (defaults to the kind and number). */
  label?: string;
  /** More buttons beside "Print or save as PDF". */
  actions?: ReactNode;
  /** A preview inside another page (Setup): no print button, the page keeps its own title. */
  preview?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const identity = useWorkspaceIdentity();
  const shown = brand ?? identity ?? { name: "" };
  useDocumentTitle(preview ? null : fileName);
  const Root = preview ? "div" : "main";
  return <Root className={styles.page} data-preview={preview || undefined}>
    {preview ? null : <PrintPageRules />}
    {preview ? null : <div className={styles.toolbar}>{actions}<Button variant="primary" onPress={() => window.print()}>{t("Print or save as PDF")}</Button></div>}
    <article className={styles.sheet} aria-label={label ?? [kind, number].filter(Boolean).join(" ")}>
      <header className={styles.header}>
        <div className={styles.issuer}>
          <LetterheadHeader letterhead={letterhead} fallback={<div className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the business's own logo, printed as uploaded */}
            {shown.logoUrl ? <img alt="" className={styles.logo} src={shown.logoUrl} /> : null}
            <strong dir="auto">{shown.name}</strong>
          </div>} />
        </div>
        <div className={styles.heading}>
          <h1 className={styles.kind}>{kind}</h1>
          {number ? <p className={styles.number}><bdi>{number}</bdi>{state ? <span className={styles.state}>{state}</span> : null}</p> : state}
          {facts.length ? <dl className={styles.facts}>{facts.filter((fact) => fact.value !== null && fact.value !== undefined && fact.value !== "").map((fact) =>
            <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : null}
        </div>
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </header>
      {parties.length ? <dl className={styles.parties} data-count={parties.length}>{parties.map((party) => <div key={party.label}>
        <dt>{party.label}</dt>
        <dd><strong dir="auto">{party.name || "—"}</strong>{(party.lines ?? []).filter(Boolean).map((line) => <span dir="auto" key={line}>{line}</span>)}</dd>
      </div>)}</dl> : null}
      <div className={styles.content}>{children}</div>
      <footer className={styles.footer}>
        <LetterheadFooter letterhead={letterhead} />
        <p className={styles.powered}>{t("Powered by Wodana")}</p>
      </footer>
    </article>
  </Root>;
}

/** The totals under a document's lines, at the inline end; the emphasised row (the total, the balance) stands out. */
export function DocumentTotals({ rows, label }: { label: string; rows: Array<{ key: string; label: string; value: string; emphasis?: boolean }> }) {
  return <dl aria-label={label} className={styles.totals}>{rows.map((row) => <div data-emphasis={row.emphasis || undefined} key={row.key}>
    <dt>{row.label}</dt><dd><bdi>{row.value}</bdi></dd>
  </div>)}</dl>;
}

/** Signature lines for whoever signs a printed document. */
export function DocumentSignatures({ boxes }: { boxes: Array<{ label: string; name?: string | null }> }) {
  return <div className={styles.signatures}>{boxes.map((box) => <div key={box.label}><span aria-hidden="true" className={styles.signLine} />
    <strong>{box.label}</strong>{box.name ? <span dir="auto">{box.name}</span> : null}</div>)}</div>;
}

/**
 * Money and dates for a printed document in the workspace's locale: amounts from exact decimal strings (Intl
 * formats a string without binary rounding) with the currency's own decimals; calendar dates as that day.
 */
export function useDocumentFormat() {
  const { locale, timeZone } = useDesignSystem();
  const safe = (build: () => string, fallback: string) => { try { return build(); } catch { return fallback; } };
  return {
    money: (value: string | null | undefined, currency: string) => (value === null || value === undefined || value === "" ? ""
      : safe(() => new Intl.NumberFormat(locale, { style: "currency", currency }).format(String(value) as unknown as number), `${currency} ${value}`)),
    date: (value: string | null | undefined) => {
      if (!value) return "";
      const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
      return safe(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: day ? "UTC" : timeZone }).format(new Date(day ? `${value}T00:00:00Z` : value)), value);
    },
    quantity: (value: string | null | undefined, unit?: string | null) => {
      if (value === null || value === undefined || value === "") return "";
      const trimmed = value.includes(".") ? value.replace(/\.?0+$/, "") : value;
      return `${safe(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(trimmed as unknown as number), trimmed)} ${unit ?? ""}`.trim();
    },
  };
}
