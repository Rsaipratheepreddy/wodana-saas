"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import { useDesignSystem } from "./provider";

/** "Asia/Dubai" → "Dubai", "America/Argentina/Buenos_Aires" → "Buenos Aires": a zone as people name it. */
export function timeZoneCity(timeZone: string): string {
  return (timeZone.split("/").at(-1) ?? timeZone).replaceAll("_", " ");
}

const subscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The workspace's time zone as a readable name ("Dubai time"), only when this browser is in a
 * different zone; null when they match, so the common case shows nothing. Never a raw IANA id.
 */
export function useWorkspaceZoneLabel(): string | null {
  const t = useT();
  const { timeZone } = useDesignSystem();
  const local = useSyncExternalStore(subscribe, browserZone, () => null);
  if (!local || !timeZone || sameZone(local, timeZone)) return null;
  return t("{city} time", { city: timeZoneCity(timeZone) });
}

/** Aliases such as Asia/Calcutta and Asia/Kolkata name the same zone. */
function sameZone(a: string, b: string) {
  return a === b || canonical(a) === canonical(b);
}

function canonical(zone: string) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone; } catch { return zone; }
}
