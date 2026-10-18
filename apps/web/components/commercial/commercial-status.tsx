"use client";
import type { ReactNode } from "react";
import { Badge, type StatusTone } from "@/design-system";

const DONE = new Set(["issued", "internal_approved", "accepted", "verified", "resolved"]);
const ATTENTION = new Set(["changes_requested", "proof_submitted"]);

/** The tone a commercial record's state shows in: done states read as success, ones waiting on a person as attention. */
export function commercialStatusTone(status: string): StatusTone {
  return DONE.has(status) ? "success" : ATTENTION.has(status) ? "warning" : "neutral";
}

/** A quotation, request or payment state as the shared chip, with its written label. */
export function CommercialStatus({ status, tone, children }: { status: string; tone?: StatusTone; children: ReactNode }) {
  return <Badge tone={tone ?? commercialStatusTone(status)} data-status={status}>{children}</Badge>;
}
