"use client";

import { useEffect, useMemo, useState } from "react";
import { financeRequestsApi } from "@/lib/finance-requests/client";
import type { RequestOrigin } from "@/lib/finance-requests/types";
import { RequestForm } from "./request-form";

const access = new Map<string, Promise<boolean>>();

/** Whether this person may ask Finance for something (once per workspace and page load). */
export function useCanRaiseFinanceRequest(workspaceId: string) {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    if (!access.has(workspaceId)) access.set(workspaceId, financeRequestsApi(workspaceId).settings().then(() => true, () => false));
    void access.get(workspaceId)!.then((value) => { if (live) setCan(value); });
    return () => { live = false; };
  }, [workspaceId]);
  return can;
}

/** "Request from Finance" on a client, deal or project: the form with that record filled in. */
export function RaiseFinanceRequest({ workspaceId, origin, onClose }: { workspaceId: string; origin: RequestOrigin; onClose: () => void }) {
  const api = useMemo(() => financeRequestsApi(workspaceId), [workspaceId]);
  return <RequestForm api={api} origin={origin} onClose={onClose} onSaved={() => undefined} />;
}
