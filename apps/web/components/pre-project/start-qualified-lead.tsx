"use client";
import { useEffect, useState } from "react";
import { Button, Callout, DesignSystemProvider, FormDialog, SelectField, useWorkingCalendar } from "@/design-system";
import { CrmDateTimeField } from "@/components/crm/crm-date-time-field";
import { zonedToUtc } from "@/lib/crm/zoned-time";
import type { PreProjectListItem } from "@/lib/pre-project/types";
import styles from "./start-qualified-lead.module.css";
import { useT } from "@/lib/i18n/i18n-provider";

/** Starts planning from a qualified lead: who manages it and when the next follow-up is (next working day, 10:00, by default). */
export function StartQualifiedLead({ workspaceId, lead, onClose, onStarted }: { workspaceId: string; lead: PreProjectListItem; onClose: () => void; onStarted: (id: string) => void }) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    {portalContainer ? <StartDialog workspaceId={workspaceId} lead={lead} onClose={onClose} onStarted={onStarted} /> : null}
  </DesignSystemProvider>;
}

function StartDialog({ workspaceId, lead, onClose, onStarted }: { workspaceId: string; lead: PreProjectListItem; onClose: () => void; onStarted: (id: string) => void }) {
  const t = useT();
  const calendar = useWorkingCalendar();
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [owner, setOwner] = useState(lead.ownerMembershipId ?? "");
  const [when, setWhen] = useState(() => `${calendar.nextWorkingDayFromToday().toString()}T10:00`);
  const [loading, setLoading] = useState(true), [loadFailure, setLoadFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/pre-projects/start-options?workspaceId=${workspaceId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? t("Lead managers could not be loaded.")); if (!controller.signal.aborted) { setMembers(data.members); setLoading(false); } })
      .catch((error) => { if (!controller.signal.aborted) { setLoadFailure(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [workspaceId, attempt, t]);
  const [date, time] = when.split("T");
  const start = async () => {
    const nextActionAt = date && time ? zonedToUtc(date, time, calendar.timeZone) : null;
    if (!nextActionAt) throw new Error(t("Choose the date and time of the next follow-up."));
    const response = await fetch(`/api/workspace/pre-projects/from-lead?workspaceId=${workspaceId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: lead.leadId, version: lead.leadVersion, ownerMembershipId: owner, nextActionAt }), signal: AbortSignal.timeout(20_000) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message ?? t("Planning could not be started.")), { status: response.status });
    if (!result.id) throw new Error(t("The planning could not be confirmed. Refresh the table before retrying."));
    onStarted(result.id);
  };
  return <FormDialog title={t("Start planning")} description={`${lead.customerName} · ${lead.title}`} onClose={onClose} submitLabel={t("Start planning")}
    isSubmitDisabled={loading || !members.some((member) => member.id === owner) || !date || !time} errorTitle={t("Could not start planning")} onSubmit={start}>
    {loadFailure ? <Callout title={t("Could not start planning")} tone="warning">{loadFailure}<Button size="compact" isDisabled={loading} onPress={() => { setLoading(true); setLoadFailure(""); setAttempt((n) => n + 1); }}>{t("Retry")}</Button></Callout> : null}
    {loading ? <p role="status">{t("Loading lead managers…")}</p> : <>
      {!members.length && !loadFailure ? <p>{t("No active lead managers. Ask an administrator to add a workspace member.")}</p> : null}
      <SelectField label={t("Lead manager")} isRequired selectedKey={members.some((member) => member.id === owner) ? owner : null} onSelectionChange={(key) => setOwner(String(key ?? ""))} items={members.map((member) => ({ id: member.id, label: member.name }))} />
      <CrmDateTimeField label={t("Next follow-up")} isRequired value={when} onChange={setWhen} />
    </>}
  </FormDialog>;
}
