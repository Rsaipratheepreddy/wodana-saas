"use client";
/* eslint-disable @next/next/no-img-element -- attendance photos come from the authenticated proxy, not static assets. */

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/design-system";
import styles from "./hrms.module.css";

/** A month or a year, stepped back and forth: "‹ September 2026 ›". */
export function PeriodStepper({ label, previousLabel, nextLabel, onPrevious, onNext, canPrevious = true, canNext = true }: {
  label: string; previousLabel: string; nextLabel: string; onPrevious: () => void; onNext: () => void; canPrevious?: boolean; canNext?: boolean;
}) {
  return <div className={styles.stepper} role="group" aria-label={label}>
    <IconButton aria-label={previousLabel} size="compact" isDisabled={!canPrevious} onPress={onPrevious}><ChevronLeft aria-hidden="true" size={16} /></IconButton>
    <span aria-live="polite">{label}</span>
    <IconButton aria-label={nextLabel} size="compact" isDisabled={!canNext} onPress={onNext}><ChevronRight aria-hidden="true" size={16} /></IconButton>
  </div>;
}

/** Label and value pairs of a record. */
export function Facts({ items }: { items: Array<[string, ReactNode] | false | null | undefined> }) {
  return <dl className={styles.facts}>{items.filter((item): item is [string, ReactNode] => Boolean(item)).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

/** An attendance photo, opening full size. */
export function EvidencePhoto({ src, alt, size = "thumb" }: { src: string; alt: string; size?: "thumb" | "large" }) {
  return <a href={src} target="_blank" rel="noreferrer"><img className={size === "thumb" ? styles.thumb : styles.photo} src={src} alt={alt} loading="lazy" /></a>;
}

/** Saves a file the server makes (a CSV export) without leaving the page. */
export function download(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
