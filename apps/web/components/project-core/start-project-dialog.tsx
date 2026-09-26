"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert } from "lucide-react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, InlineNotice, SelectField, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { StartState } from "@/lib/project-core/types";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

/** Where each start rule is satisfied, in the planning record. */
const FIX: Record<string, string> = { accepted: "quotations", agreement: "contracts", payment: "payment-plan", approval: "execution-release" };

/**
 * Start the project from the accepted quotation: what the firm's start rules still need, then the
 * name, route, project manager and dates. The scope is sealed when it starts.
 */
export function StartProjectDialog({ workspaceId, caseId, onClose }: { workspaceId: string; caseId: string; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const format = useProjectFormat();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [state, setState] = useState<StartState | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [route, setRoute] = useState<string | null>(null);
  const [lead, setLead] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [promiseDate, setPromiseDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.startState(caseId).then((next) => {
      if (!alive) return;
      setState(next); setName(next.suggested.name); setLead(next.suggested.lead);
      setRoute(next.templates.find((item) => item.isDefault)?.id ?? next.templates[0]?.id ?? null);
    }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [api, caseId]);

  const labels: Record<string, string> = {
    accepted: t("Client accepted the quotation"), agreement: t("Agreement signed"), payment: t("Payment before the start verified"), approval: t("Deal approved"),
  };
  const start = async () => {
    if (!state?.quote || !lead) return;
    setBusy(true); setError("");
    try {
      const started = await api.start(caseId, { quoteId: state.quote.id, templateId: route ?? undefined, name: name.trim(), leadMembershipId: lead, startDate, promiseDate });
      router.push(`/workspace/projects/${started.projectId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not start the project.")); setBusy(false); }
  };
  const datesValid = !startDate || !promiseDate || promiseDate >= startDate;

  return <ControlledModalDialog isOpen size="md" title={t("Start project")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions">
      <Button onPress={onClose}>{t("Cancel")}</Button>
      {state?.project ? <Link className="wd-button" data-variant="primary" href={`/workspace/projects/${state.project.id}`}>{t("Open project")}</Link>
        : <Button variant="primary" isLoading={busy} isDisabled={!state?.canStart || !lead || !name.trim() || !datesValid} onPress={() => void start()}>{t("Start project")}</Button>}
    </div>}>
    {!state && !error ? <Skeleton lines={5} /> : null}
    {state ? <div className={styles.dialogBody}>
      {state.project ? <InlineNotice tone="info" message={t("This project has already started as {reference}.", { reference: state.project.reference })} />
        : !state.quote ? <InlineNotice tone="info" message={t("A project starts from an accepted quotation.")} />
        : <>
          <p className={styles.quoteLine}>
            <strong>{t("Q-{number}", { number: state.quote.number })}</strong> {state.quote.title}
            <span>{format.money(state.quote.total, state.quote.currency)}</span>
          </p>
          <ul className={styles.checklist} aria-label={t("Before the project starts")}>
            {state.checks.map((check) => <li key={check.key} data-ok={check.ok || undefined}>
              {check.ok ? <Check aria-hidden="true" size={15} /> : <CircleAlert aria-hidden="true" size={15} />}
              <span>{labels[check.key]}</span>
              {check.ok ? null : <Link href={`/workspace/pre-projects/cases/${caseId}/${FIX[check.key]}`}>{t("Open")}</Link>}
            </li>)}
          </ul>
          {state.canManage ? <>
            <TextInput label={t("Project name")} value={name} onChange={setName} isRequired />
            {state.templates.length > 1 ? <SelectField label={t("Route")} selectedKey={route} onSelectionChange={(key) => setRoute(String(key))}
              items={state.templates.map((item) => ({ id: item.id, label: item.name }))} /> : null}
            <SelectField label={t("Project manager")} isRequired placeholder={t("Choose someone")} selectedKey={lead} onSelectionChange={(key) => setLead(String(key))}
              items={state.members.map((member) => ({ id: member.membershipId, label: member.name }))} />
            <div className={styles.pair}>
              <DateField label={t("Start date")} value={startDate ? parseDate(startDate) : null} onChange={(value) => setStartDate(value ? value.toString() : null)} />
              <DateField label={t("Handover date")} value={promiseDate ? parseDate(promiseDate) : null} onChange={(value) => setPromiseDate(value ? value.toString() : null)}
                errorMessage={datesValid ? undefined : t("The handover date can't be before the start date.")} isInvalid={!datesValid} />
            </div>
          </> : <InlineNotice tone="info" message={t("Ask a project manager to start this project.")} />}
        </>}
    </div> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
  </ControlledModalDialog>;
}
