"use client";

import { useEffect, useState } from "react";
import { InlineNotice, SelectField, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { caseRequest } from "@/lib/pre-project/content";
import { SideSection } from "@/components/record/record-layout";
import { FactList } from "@/components/record/record-parts";

export type ClientCallFrequency = "weekly" | "fortnightly" | "monthly" | "off";
export type ClientCallsView = {
  caseId: string; frequency: ClientCallFrequency; started: boolean; startedFrom: string | null; version: number; ownerName: string | null; hasOwner: boolean;
  next: { activityId: string; startsAt: string } | null;
};

export const FREQUENCY_LABEL: Record<ClientCallFrequency, MessageKey> = { weekly: tKey("Weekly"), fortnightly: tKey("Every two weeks"), monthly: tKey("Monthly"), off: tKey("Off") };

/**
 * PLM-046: the Account Manager's recurring client update call. Booked weekly by default from the design approval (or
 * the accepted estimate without design); here it is changed per job, or turned off when the client declines.
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
  const change = async (frequency: ClientCallFrequency) => {
    if (frequency === view.frequency) return;
    setSaving(true); setError("");
    try { setView(await caseRequest<ClientCallsView>(workspaceId, caseId, "client-calls", "PUT", { frequency, version: view.version })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setSaving(false); }
  };
  const when = view.next ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(view.next.startsAt)) : null;
  return <SideSection title={t("Client update calls")}>
    <SelectField label={t("How often")} isDisabled={saving} selectedKey={view.frequency} onSelectionChange={(key) => void change(String(key ?? "off") as ClientCallFrequency)}
      items={(Object.keys(FREQUENCY_LABEL) as ClientCallFrequency[]).map((id) => ({ id, label: t(FREQUENCY_LABEL[id]) }))} />
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <FactList facts={[when ? { label: t("Next call"), value: when } : null, view.ownerName && view.frequency !== "off" ? { label: t("With"), value: view.ownerName } : null]} />
  </SideSection>;
}
