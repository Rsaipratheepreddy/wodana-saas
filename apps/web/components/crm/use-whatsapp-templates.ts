"use client";
import { useCallback, useEffect, useState } from "react";
import type { StoredTemplate } from "@/lib/crm/whatsapp-templates";
type TemplateResult = {
  items: StoredTemplate[];
  unavailable: Array<{ name: string; reason: string }>;
  approvedCount: number;
  truncated?: boolean;
};
export function useWhatsAppTemplates(
  workspaceId: string,
  connectionId: string | null,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data?: TemplateResult;
    failure?: string;
  }>();
  const key = `${workspaceId}/${connectionId}/${revision}`;
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!connectionId) return;
    const controller = new AbortController();
    void fetch("/api/workspace/crm/whatsapp-templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, connectionId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.message ?? "Templates could not be loaded.");
        if (!controller.signal.aborted) setState({ key, data: payload });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ key, failure: error.message });
      });
    return () => controller.abort();
  }, [workspaceId, connectionId, key]);
  const current = state?.key === key ? state : undefined;
  return {
    data: current?.data,
    failure: current?.failure,
    loading: Boolean(connectionId && !current),
    refresh,
  };
}
