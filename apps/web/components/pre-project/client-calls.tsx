"use client";

import { useEffect, useState } from "react";
import { InlineNotice, SelectField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { caseRequest } from "@/lib/pre-project/content";
import { SideSection } from "@/components/record/record-layout";
import { FactList } from "@/components/record/record-parts";

export type ClientCallFrequency = "weekly" | "fortnightly" | "monthly" | "off";
/** A call with the Account Manager, or a progress update posted to the client portal instead. */
export type ClientUpdateMode = "call" | "portal";
export type ClientCallsView = {
  caseId: string; frequency: ClientCallFrequency; mode: ClientUpdateMode; started: boolean; startedFrom: string | null; version: number; ownerName: string | null; hasOwner: boolean;
  /** The booked call (its start), or the reminder to post an update (due by the end of `on`). */
  next: { activityId: string; startsAt: string; on: string | null } | null;
};

export const FREQUENCY_LABEL: Record<ClientCallFrequency, MessageKey> = { weekly: tKey("Weekly"), fortnightly: tKey("Every two weeks"), monthly: tKey("Monthly"), off: tKey("Off") };
const MODE_LABEL: Record<ClientUpdateMode, MessageKey> = { call: tKey("Call"), portal: tKey("Portal update") };

/**
 * PLM-046: the Account Manager's recurring client update. A call booked weekly by default from the design approval (or
 * the accepted estimate without design); here it is changed per job: a progress update in the client portal instead,
 * how often, or off when the client declines.
 */
export function ClientCallsSection({ workspaceId, caseId }: { workspaceId: string; caseId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [view, setView] = useState<ClientCallsView | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    caseRequest<ClientCallsView>(workspaceId, caseId, "client-calls").then((next) => { if (live) setView(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [workspaceId, caseId]);
  // Nothing to offer without an Account Manager to call with (or for someone who can't read it).
  if (!view || (!view.started && !view.hasOwner)) return null;
  const change = async (frequency: ClientCallFrequency, mode: ClientUpdateMode) => {
    if (frequency === view.frequency && mode === view.mode) return;
    setSaving(true); setError("");
    try { setView(await caseRequest<ClientCallsView>(workspaceId, caseId, "client-calls", "PUT", { frequency, mode, version: view.version })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setSaving(false); }
  };
  const portal = view.mode === "portal";
  // A call at its time; an update by its day (shown as a calendar day, whatever the zone).
  const when = !view.next ? null : portal && view.next.on
    ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${view.next.on}T12:00:00Z`))
    : new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(view.next.startsAt));
  const on = view.frequency !== "off";
  return <SideSection title={t("Client updates")}>
    <SelectField label={t("Update by")} isDisabled={saving} selectedKey={view.mode} onSelectionChange={(key) => void change(view.frequency, String(key ?? "call") as ClientUpdateMode)}
      items={(Object.keys(MODE_LABEL) as ClientUpdateMode[]).map((id) => ({ id, label: t(MODE_LABEL[id]) }))} />
    <SelectField label={t("How often")} isDisabled={saving} selectedKey={view.frequency} onSelectionChange={(key) => void change(String(key ?? "off") as ClientCallFrequency, view.mode)}
      items={(Object.keys(FREQUENCY_LABEL) as ClientCallFrequency[]).map((id) => ({ id, label: t(FREQUENCY_LABEL[id]) }))} />
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <FactList facts={[when ? { label: portal ? t("Next update due") : t("Next call"), value: when } : null,
      view.ownerName && on ? { label: portal ? t("Account Manager") : t("With"), value: view.ownerName } : null]} />
  </SideSection>;
}
