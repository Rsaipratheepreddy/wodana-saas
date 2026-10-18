"use client";

import { useEffect, useState } from "react";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** §0.3 P3: the firm's commission types (Setup → Commissions); the kit's three until the firm names its own. */
export type CommissionType = { code: string; label: string };
export type CommissionTypes = { types: CommissionType[]; version: string; fromKit: boolean };
export const KIT_COMMISSION_TYPES: CommissionType[] = [{ code: "sales", label: "Sales" }, { code: "designer", label: "Designer fee" }, { code: "referral", label: "Referral" }];
/** The kit's own names, translated; a firm's own names show as it wrote them. */
export const KIT_COMMISSION_LABELS: Record<string, MessageKey> = { sales: tKey("Sales"), designer: tKey("Designer fee"), referral: tKey("Referral") };

const url = (workspaceId: string) => `/api/workspace/setup/commission-types?workspaceId=${encodeURIComponent(workspaceId)}`;

export async function loadCommissionTypes(workspaceId: string): Promise<CommissionTypes> {
  const response = await fetch(url(workspaceId), { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !Array.isArray(data.types)) throw new Error(typeof data?.message === "string" ? data.message : "Could not load.");
  return data as CommissionTypes;
}

export async function saveCommissionTypes(workspaceId: string, version: string, types: Array<{ code?: string; label: string }>): Promise<CommissionTypes> {
  const response = await fetch(url(workspaceId), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ version, types }) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !Array.isArray(data.types)) throw new Error(typeof data?.message === "string" ? data.message : "Could not save.");
  return data as CommissionTypes;
}

/** The firm's list for a form (the kit's until it answers; the kit's if it can't be read). */
export function useCommissionTypes(workspaceId: string) {
  const [types, setTypes] = useState<CommissionType[]>(KIT_COMMISSION_TYPES);
  useEffect(() => {
    let live = true;
    if (workspaceId) loadCommissionTypes(workspaceId).then((next) => { if (live) setTypes(next.types); }).catch(() => undefined);
    return () => { live = false; };
  }, [workspaceId]);
  return types;
}
