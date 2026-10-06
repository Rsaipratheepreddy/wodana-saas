"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { DocumentLetterhead } from "@/lib/brand/letterhead";
import styles from "./document-letterhead.module.css";

/** The licence, tax number, address and contact lines a business prints under its name. */
export function useLetterheadLines(letterhead: DocumentLetterhead | null | undefined) {
  const t = useT();
  if (!letterhead) return [];
  return [
    [letterhead.licenceNumber ? `${t("Licence")} ${letterhead.licenceNumber}` : "", letterhead.taxNumber ? `${letterhead.taxLabel ?? t("Tax number")} ${letterhead.taxNumber}` : ""].filter(Boolean).join(" · "),
    letterhead.address ?? "",
    [letterhead.phone, letterhead.email].filter(Boolean).join(" · "),
  ].filter(Boolean);
}

/**
 * The top of a client- or supplier-facing document (PLM-112): the issuing business's letterhead image, or its
 * logo, legal name and details; without a business, the workspace brand (`fallback`).
 */
export function LetterheadHeader({ letterhead, fallback }: { letterhead?: DocumentLetterhead | null; fallback?: ReactNode }) {
  const lines = useLetterheadLines(letterhead);
  if (!letterhead) return <>{fallback ?? null}</>;
  return <div className={styles.letterhead} data-letterhead="">
    {letterhead.headerUrl
      // eslint-disable-next-line @next/next/no-img-element -- the business's own letterhead, printed as uploaded
      ? <img alt={letterhead.legalName} className={styles.header} src={letterhead.headerUrl} />
      : <>
        {/* eslint-disable-next-line @next/next/no-img-element -- the business's own logo */}
        {letterhead.logoUrl ? <img alt="" className={styles.logo} src={letterhead.logoUrl} /> : null}
        <strong className={styles.name} dir="auto">{letterhead.legalName}</strong>
        {lines.map((line) => <span className={styles.line} dir="auto" key={line}>{line}</span>)}
      </>}
  </div>;
}

/** The foot of a document: the letterhead's footer text, when the business has one. */
export function LetterheadFooter({ letterhead }: { letterhead?: DocumentLetterhead | null }) {
  if (!letterhead?.footer) return null;
  return <footer className={styles.footer} dir="auto">{letterhead.footer}</footer>;
}
