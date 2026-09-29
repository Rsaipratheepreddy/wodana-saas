import { useEffect, useState } from "react";

export type AiSettings = { enabled: boolean; version: number; available: boolean };
export async function loadAiSettings(workspaceId: string): Promise<AiSettings | null> {
  try {
    const response = await fetch(`/api/workspace/ai-settings?workspaceId=${workspaceId}`);
    return response.ok ? await response.json() as AiSettings : null;
  } catch { return null; }
}

const checked = new Map<string, { at: number; settings: Promise<AiSettings | null> }>();
/** Forget what was learned (after the switch changes here, and between tests). */
export function forgetAiReady() { checked.clear(); }

/**
 * Whether AI can help in this workspace now: switched on by the workspace and set up here. Asked once a minute
 * at most; false until known, so AI buttons appear only when they will work.
 */
export function useAiReady(workspaceId: string | null | undefined) {
  const [ready, setReady] = useState<{ workspaceId: string; ready: boolean } | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    const cached = checked.get(workspaceId);
    const entry = cached && Date.now() - cached.at < 60_000 ? cached : { at: Date.now(), settings: loadAiSettings(workspaceId) };
    checked.set(workspaceId, entry);
    void entry.settings.then((settings) => {
      if (!settings) checked.delete(workspaceId);
      if (live) setReady({ workspaceId, ready: Boolean(settings?.enabled && settings.available) });
    });
    return () => { live = false; };
  }, [workspaceId]);
  return Boolean(workspaceId && ready?.workspaceId === workspaceId && ready.ready);
}
