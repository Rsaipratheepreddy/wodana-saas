"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One live event stream per workspace per tab (`/api/workspace/events`, server-sent events from Business Core).
 * A `change` names the scopes that changed ("workspace", "notifications", "sales", "projects", "project:<id>",
 * "conversations", "conversation:<id>", "purchasing", "factory", "approvals"); a screen listening to one of
 * them re-reads its own rows. Without the stream (an older core, no Redis, a test) screens keep polling.
 */
type Listener = { scopes: ReadonlySet<string>; fire: () => void };
type Channel = { source: EventSource | null; listeners: Set<Listener>; live: boolean; watchers: Set<(live: boolean) => void>; retry?: number };

const channels = new Map<string, Channel>();
const RETRY_MS = 30_000;

function connect(workspaceId: string, channel: Channel) {
  if (typeof EventSource === "undefined" || channel.source) return;
  const source = new EventSource(`/api/workspace/events?workspaceId=${encodeURIComponent(workspaceId)}`);
  channel.source = source;
  const setLive = (live: boolean) => { if (channel.live !== live) { channel.live = live; channel.watchers.forEach((watch) => watch(live)); } };
  source.addEventListener("open", () => setLive(true));
  source.addEventListener("change", (event) => {
    let scopes: string[] = [];
    try { scopes = (JSON.parse((event as MessageEvent<string>).data) as { scopes?: string[] }).scopes ?? []; } catch { return; }
    for (const listener of channel.listeners) if (scopes.some((scope) => listener.scopes.has(scope))) listener.fire();
  });
  source.addEventListener("error", () => {
    setLive(false);
    // The browser retries a dropped stream itself; a refused one (signed out, no access) is retried later.
    if (source.readyState === EventSource.CLOSED) {
      channel.source = null;
      if (channel.listeners.size) channel.retry = window.setTimeout(() => connect(workspaceId, channel), RETRY_MS);
    }
  });
}

function channelFor(workspaceId: string) {
  let channel = channels.get(workspaceId);
  if (!channel) { channel = { source: null, listeners: new Set(), live: false, watchers: new Set() }; channels.set(workspaceId, channel); }
  return channel;
}

function release(workspaceId: string, channel: Channel) {
  if (channel.listeners.size) return;
  window.clearTimeout(channel.retry);
  channel.source?.close();
  channels.delete(workspaceId);
}

/**
 * Calls `refetch` (at most once a second) when one of `scopes` changes. Returns whether the stream is live, so
 * a screen can slow its polling to a 60-second fallback.
 */
export function useLiveInvalidate(workspaceId: string, scopes: readonly string[], refetch: () => void, debounceMs = 1_000) {
  const latest = useRef(refetch);
  useEffect(() => { latest.current = refetch; }, [refetch]);
  const [live, setLive] = useState(false);
  const key = scopes.join("|");
  useEffect(() => {
    if (!workspaceId || typeof EventSource === "undefined") return;
    const channel = channelFor(workspaceId);
    let timer: number | undefined;
    const listener: Listener = { scopes: new Set(key.split("|").filter(Boolean)), fire: () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (!document.hidden) latest.current(); }, debounceMs); } };
    const watch = (value: boolean) => setLive(value);
    channel.listeners.add(listener);
    channel.watchers.add(watch);
    connect(workspaceId, channel);
    queueMicrotask(() => setLive(channel.live));
    return () => {
      window.clearTimeout(timer);
      channel.listeners.delete(listener);
      channel.watchers.delete(watch);
      release(workspaceId, channel);
    };
  }, [workspaceId, key, debounceMs]);
  return live;
}

/** The polling interval: the screen's own while the stream is down, a 60-second fallback while it is live. */
export const pollEvery = (live: boolean, fallbackMs: number) => (live ? Math.max(fallbackMs, 60_000) : fallbackMs);
