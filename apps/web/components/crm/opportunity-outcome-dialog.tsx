"use client";

import { useEffect, useState } from "react";
import { today } from "@internationalized/date";
import { DateField, FormDialog, FormNotSaved, RadioSet, SelectField, TextInput, useDesignSystem, type SaveProblem } from "@/design-system";
import { CrmRequestError, crmRequest } from "@/lib/crm/client";
import { UNRESOLVED_ENQUIRY_TYPE_ID, type LeadOptions } from "@/lib/crm/lead-options";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";

type Outcome = "proceed" | "needs_time" | "lost";

/**
 * §0.3 P0 (guide G): the intro's outcome, in one dialog. Going ahead names what with (one of the firm's enquiry types)
 * and the client's target date; needs time books the follow-up; lost closes it with the reason.
 */
export function OpportunityOutcomeDialog({ workspaceId, opportunityId, enquiryType, freshVersion, onClose, onSaved }: {
  workspaceId: string; opportunityId: string; enquiryType: string | null;
  freshVersion: () => Promise<number>; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const t = useT();
  const { timeZone } = useDesignSystem();
  const [types, setTypes] = useState<Array<{ id: string; label: string }> | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("proceed");
  const [scope, setScope] = useState("");
  const [targetCompletion, setTargetCompletion] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<SaveProblem[]>([]);
  const [error, setError] = useState("");
  const first = today(timeZone);

  useEffect(() => {
    const controller = new AbortController();
    crmRequest<LeadOptions>(workspaceId, "lead-options", "GET", undefined, controller.signal).then((options) => {
      const choices = options.enquiryTypes.filter((type) => type.id !== UNRESOLVED_ENQUIRY_TYPE_ID);
      setTypes(choices);
      // The enquiry's own type comes first; the flow view names it by its label.
      setScope((current) => current || choices.find((type) => type.id === enquiryType || type.label === enquiryType)?.id || "");
    }).catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [workspaceId, enquiryType]);

  const problem = (key: string) => {
    const found = problems.find((item) => item.key === key);
    return found ? { isInvalid: true, errorMessage: translateKnown(t, found.label) } : {};
  };
  const save = async () => {
    setProblems([]); setError("");
    const body = outcome === "proceed" ? { outcome, scope, targetCompletion } : outcome === "needs_time" ? { outcome, followUpOn } : { outcome, reason: reason.trim() };
    try {
      await crmRequest(workspaceId, `opportunities/${opportunityId}/outcome`, "POST", { version: await freshVersion(), ...body });
    } catch (cause) {
      if (cause instanceof CrmRequestError && cause.missing.length) { setProblems(cause.missing.map((item) => ({ key: item.key, label: item.label }))); throw new FormNotSaved(); }
      throw cause;
    }
    await onSaved();
  };
  const dateValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? first.set({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) }) : null;

  return <FormDialog size="md" title={t("Record the intro outcome")} onClose={onClose} onSubmit={save} submitLabel={t("Save")} error={error || undefined}
    problems={problems.map((item) => ({ ...item, text: translateKnown(t, item.label) }))}
    isDirty={Boolean(scope || targetCompletion || followUpOn || reason.trim())}>
    <RadioSet label={t("Outcome")} isRequired value={outcome} onChange={(value) => setOutcome(value as Outcome)} items={[
      { id: "proceed", label: t("Going ahead") },
      { id: "needs_time", label: t("Needs time to think") },
      { id: "lost", label: t("Lost") },
    ]} />
    {outcome === "proceed" ? <>
      <SelectField label={t("Going ahead with")} isRequired placeholder={t("Choose")} items={types ?? []} isDisabled={!types}
        selectedKey={scope || null} onSelectionChange={(key) => setScope(String(key ?? ""))} name="scope" {...problem("scope")} />
      <DateField label={t("Target completion")} isRequired minValue={first} value={dateValue(targetCompletion)}
        onChange={(date) => setTargetCompletion(date?.toString() ?? "")} name="targetCompletion" {...problem("targetCompletion")} />
    </> : null}
    {outcome === "needs_time" ? <DateField label={t("Follow-up date")} isRequired minValue={first} value={dateValue(followUpOn)}
      onChange={(date) => setFollowUpOn(date?.toString() ?? "")} name="followUpOn" {...problem("followUpOn")} /> : null}
    {outcome === "lost" ? <TextInput label={t("Reason")} isRequired maxLength={160} value={reason} onChange={setReason} name="reason" {...problem("reason")} /> : null}
  </FormDialog>;
}
