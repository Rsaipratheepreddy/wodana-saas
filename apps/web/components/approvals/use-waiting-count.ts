"use client";

import { useEffect, useState } from "react";
import { approvalsApi } from "@/lib/approvals/approvals";
import { useLiveInvalidate } from "@/lib/workspace/live-events";

/** Refreshes the count everywhere it's shown (after a decision in the list, say). */
export const APPROVALS_CHANGED = "wodana:approvals-changed";
/** The live-event scopes that can change what waits for someone. */
export const WAITING_SCOPES = ["approvals", "notifications"] as const;
const REFRESH_MS = 60_000;

type Entry = { count: number | null; listeners: Set<(count: number | null) => void>; timer: ReturnType<typeof setInterval> | null; loading: boolean };
const entries = new Map<string, Entry>();

async function refresh(workspaceId: string) {
  const entry = entries.get(workspaceId);
  if (!entry || entry.loading || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
  entry.loading = true;
  try { entry.count = (await approvalsApi(workspaceId).count()).count; }
  catch { /* Keep the last count: a badge never shows an error. */ }
  finally { entry.loading = false; }
  for (const listener of entry.listeners) listener(entry.count);
}

/**
 * How many things wait for this person (the Home tab and the sidebar badge). One shared poll per
 * workspace, every minute while the page is visible, and at once when a decision is made.
 */
export function useWaitingCount(workspaceId: string) {
  const [count, setCount] = useState<number | null>(() => entries.get(workspaceId)?.count ?? null);
  // Every hand-off tells its approvers (a notice) and every decision its submitter: either refreshes the count.
  useLiveInvalidate(workspaceId, WAITING_SCOPES, () => void refresh(workspaceId), 1_500);
  useEffect(() => {
    if (!workspaceId) return;
    let entry = entries.get(workspaceId);
    if (!entry) { entry = { count: null, listeners: new Set(), timer: null, loading: false }; entries.set(workspaceId, entry); }
    entry.listeners.add(setCount);
    if (!entry.timer) {
      entry.timer = setInterval(() => void refresh(workspaceId), REFRESH_MS);
      void refresh(workspaceId);
    }
    const onChange = () => void refresh(workspaceId);
    window.addEventListener(APPROVALS_CHANGED, onChange);
    document.addEventListener("visibilitychange", onChange);
    const current = entry;
    return () => {
      current.listeners.delete(setCount);
      window.removeEventListener(APPROVALS_CHANGED, onChange);
      document.removeEventListener("visibilitychange", onChange);
      if (!current.listeners.size && current.timer) { clearInterval(current.timer); current.timer = null; }
    };
  }, [workspaceId]);
  return count;
}
