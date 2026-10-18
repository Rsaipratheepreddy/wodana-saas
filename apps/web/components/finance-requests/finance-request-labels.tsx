"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import type { FileKind, InvoiceKind, MaterialLocation, RequestKind, RequestStatus } from "@/lib/finance-requests/types";
import styles from "./finance-requests.module.css";

type Tone = "neutral" | "info" | "warning" | "success" | "danger";
const TONES: Record<RequestStatus, Tone> = { new: "info", in_progress: "neutral", needs_info: "warning", done: "success", rejected: "danger" };

export function useStatusLabels(): Record<RequestStatus, string> {
  const t = useT();
  return { new: t("New"), in_progress: t("In progress"), needs_info: t("Needs info"), done: t("Done"), rejected: t("Rejected") };
}

export function useKindLabels(): Record<RequestKind, string> {
  const t = useT();
  return { invoice: t("Invoice"), refund: t("Refund"), payable: t("Payable") };
}

export function useInvoiceKindLabels(): Record<InvoiceKind, string> {
  const t = useT();
  return { standard: t("Client invoice"), progress: t("Progress invoice"), web_order: t("Web order") };
}

export function useLocationLabels(): Record<MaterialLocation, string> {
  const t = useT();
  return { factory: t("Factory"), office: t("Office"), project: t("Project") };
}

export function useFileKindLabels(): Record<FileKind, string> {
  const t = useT();
  return { quote: t("Quote or BOQ"), tax_invoice: t("Supplier tax invoice"), proof: t("Proof"), other: t("Other") };
}

/** Where a request stands: one word, its tone reinforcing it. */
export function RequestStatusLabel({ status }: { status: RequestStatus }) {
  const labels = useStatusLabels();
  return <span className={styles.status} data-tone={TONES[status]}>{labels[status]}</span>;
}
